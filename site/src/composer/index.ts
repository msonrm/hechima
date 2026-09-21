// 経路コンポーザ本体の配線（docs/composer.md §2）。
//
// この版で実装したのは **§2.1 寸法 / §2.2 三層モデル / §2.3 テキストの流れ /
// §2.6 配置と隠す操作** まで。マーク（§2.4）と候補の提示（§2.5）はまだ無い
// —— §4.4 の配置比較（案 A / 案 B）を先に回すための一区切りなので、
// 「打ってみて視線がどう動くか」に要るものだけを入れてある。
//
// 三層モデル（§2.2）の受け持ち:
//   1行欄       … ひらがな。**変換しない**（打鍵フィードバックのセーフガード）
//   現在の文     … 変換済み・都度書き換わる（区切りも含め再検討される）
//   確定した文   … 変換済み・書き換えない
//
// 確定操作は持たない（§2.3）。Enter は改行のままで、編集可能な窓が後ろへ滑っていく。

import { Flow, sentenceBreakAt, type Segment } from "./flow";
import { Block } from "./block";
import { applyPlacement, type CaretSource, type Placement } from "./placement";

declare const KeymapEngine: {
  version: string;
  decodeKeymap(json: unknown, opts?: { layout?: string }): unknown;
  InputEngine: new (keymap: unknown) => EngineLike;
  keyEventFromBrowser(tap: Hechima.KeyTap): Hechima.KeyEvent | null;
};

/**
 * InputEngine のうちコンポーザが使う分。`hechima.d.ts` の InputEngineLike に
 * `appendDirectKana` / `replaceDirectKana` を足したもの（かなの持ち主がセッション層では
 * なくエンジンなので、文の切り出しでかなを詰め直すのに要る）。
 */
interface EngineLike extends Hechima.InputEngineLike {
  /** このエンジン自身が合成中か（よみ or ローマ字バッファを保持している） */
  readonly isComposing: boolean;
  appendDirectKana(kana: string): unknown;
  replaceDirectKana(kana: string, replaceCount: number): unknown;
}

export interface ComposerStats {
  /** 打鍵数（配列エンジンが飲んだ分だけ） */
  keys: number;
  /** 隠した回数（ホバーで半透明にした回数。§2.6 / §4.4） */
  hides: number;
  /** 隠していた合計ミリ秒 */
  hideMs: number;
}

export interface ComposerOptions {
  /** 流れた文が着地する先（contenteditable の平文） */
  host: HTMLElement;
  /** 配列（`/vendor/keymaps/<id>.json`）。既定 "romaji" */
  keymap?: string;
  status?(text: string): void;
  onStats?(stats: ComposerStats): void;
}

export interface ComposerHandle {
  setPlacement(mode: Placement): void;
  setHideOnHover(on: boolean): void;
  readonly stats: ComposerStats;
  resetStats(): void;
}

export function mountComposer(opts: ComposerOptions): ComposerHandle {
  const setStatus = opts.status ?? (() => {});
  const host = opts.host;

  const block = new Block();
  document.body.appendChild(block.el);

  let placement: Placement = "center";
  let hideOnHover = true;
  const stats: ComposerStats = { keys: 0, hides: 0, hideMs: 0 };

  // ---- ホスト（流れた文の着地先）とキャレット ----

  const caretSource: CaretSource = {
    caretRect(): DOMRect | null {
      const sel = window.getSelection();
      const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
      if (!range || !host.contains(range.startContainer)) return hostHead();
      const rect = range.getBoundingClientRect();
      // 折り畳んだ Range は 0×0 を返すことがある（空のホスト・テキストノードの端など）。
      // ホストが空ならその左上で足りる。DOM に目印を挿すのは中身があるときだけにする
      if (rect.width || rect.height || rect.top || rect.left) return rect;
      if (!host.firstChild) return hostHead();
      const probe = document.createElement("span");
      probe.textContent = "\u200b";
      const probeRange = range.cloneRange();
      probeRange.collapse(true);
      probeRange.insertNode(probe);
      const measured = probe.getBoundingClientRect();
      probe.remove();
      host.normalize();
      return measured;
    },
  };

  /** キャレットが取れないときの代役: ホスト枠の書き出し位置 */
  function hostHead(): DOMRect {
    const r = host.getBoundingClientRect();
    const line = parseFloat(getComputedStyle(host).lineHeight) || 24;
    return new DOMRect(r.left + 12, r.top + 12, 0, line);
  }

  function insertToHost(text: string): void {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && host.contains(sel.getRangeAt(0).startContainer)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      host.appendChild(document.createTextNode(text));
    }
  }

  // ---- 変換エンジン ----

  const flow = new Flow(insertToHost);
  const worker = new Worker(`/vendor/hechima/hechima-worker.js?t=${Date.now()}`);
  worker.addEventListener("error", (e) =>
    setStatus(`エンジン worker の読み込みに失敗: ${e.message || "スクリプトを取得できません"}`));
  const conn = Hechima.connectWorker(worker, {
    // 候補は出さない（§2.5 は次の一区切り）ので、1 文節 1 件で足りる
    maxCands: 1,
    onProgress: (loaded, total) =>
      setStatus(total > 0
        ? `辞書を取得中… ${mb(loaded)} / ${mb(total)} MB`
        : `辞書を取得中… ${mb(loaded)} MB`),
  });
  conn
    .init({ wasmJs: "/vendor/hechima-wasm/hechima-wasm.js", dataUrl: "/vendor/hechima-wasm/mozc.data" })
    .then((info) => setStatus(`準備完了 — Mozc 実変換（hechima v${info.version}）`))
    .catch((e: Error) => setStatus(`エンジン初期化失敗: ${e.message}`));

  let lastConvertKana: string | null = null;
  function scheduleConvert(kana: string): void {
    // keyup とチョード窓の満了でも pump が走るので、同じかなを二度投げない
    if (!kana || kana === lastConvertKana) return;
    lastConvertKana = kana;
    void conn.convert(kana).then((segs) => {
      if (!segs) return;
      const out: Segment[] = segs.map((s) => ({ key: s.key, value: s.candidates?.[0] ?? s.key }));
      // ★**世代で捨ててはいけない。** 句点の次の 1 字で文が切り出されると、直前に投げた
      // 「句点までのかな」の結果は最新世代ではなくなるが、**それこそが確定した文を埋める
      // 結果**である。どのかなに対する結果かは flow 側が文字列で照合するので、届いた分は
      // すべて渡してよい（古い同一かなの結果が来ても中身が同じなので無害）
      flow.applyConversion(kana, out);
      render();
    }).catch(() => {});
  }

  // ---- 配列エンジン ----

  let engine: EngineLike | null = null;

  async function loadKeymap(id: string): Promise<void> {
    if (typeof KeymapEngine === "undefined") {
      setStatus("配列エンジンが読み込まれていません（この HTML に keymap-engine.js の script タグが要ります）");
      return;
    }
    const res = await fetch(`/vendor/keymaps/${id}.json`);
    if (!res.ok) {
      setStatus(`配列の読み込みに失敗: ${id} (HTTP ${res.status})`);
      return;
    }
    const e = new KeymapEngine.InputEngine(KeymapEngine.decodeKeymap(await res.json()));
    e.onStateChange = () => pump();
    // 配列エンジンは「合成中」の Space / Enter を変換キー・確定キーとして routing する
    // （keymap-engine の routeStandardControlKey）。**コンポーザにはどちらも無い**（§2.3）ので
    // ここで横取りする。戻り値 true = エンジンの既定動作を止める
    e.onHostAction = (action: { type: string }): boolean => {
      if (action.type === "convert") {
        // Space は文字を産むキー（§2.6）。変換キーではないので、そのまま空白を入れる
        e.appendDirectKana("\u3000");
        return true;
      }
      if (action.type === "confirm") {
        // Enter は改行（§2.3）。確定操作ではない。handleEnter() が pump の外で処理する
        return true;
      }
      return false;
    };
    engine = e;
  }
  void loadKeymap(opts.keymap ?? "romaji");

  /**
   * エンジンの状態を読み、文の切り出しと変換要求を出して描画する。
   *
   * **かなの持ち主はエンジン**（composingKana）のままにしてある。ホスト側へ引き取ると
   * エンジンが常に idle 判定になり、chord 配列の合成中 routing が変わってしまうため。
   * 文の切り出しだけは replaceDirectKana で詰め直す。
   */
  function pump(): void {
    if (!engine) return;
    const confirmed = engine.takeConfirmedText();
    if (confirmed) {
      // 英数モードの確定はコンポーザを通さずホストへ（変換の対象ではない）。
      // **inputMode だけでは足りない**: switchToEnglish は confirmComposition() を先に
      // 呼ぶので、モードを切り替えた瞬間だけ「英数モードなのに中身はかな」になる。
      // ASCII かどうかも見て分ける
      if (engine.getState().inputMode === "english" && /^[\x20-\x7e]*$/.test(confirmed)) {
        insertToHost(confirmed);
      } else {
        // 何かの拍子に確定へ落ちたかなは現在の文へ戻す。コンポーザに確定操作は無い（§2.3）
        engine.appendDirectKana(confirmed);
      }
    }

    // 句点の**次の1文字**で、句点までが一気に矩形へ（§2.3）。句点で即座に流さないので、
    // 打った直後に手を止めれば打ったばかりのひらがなが1行欄に残って見える
    let st = engine.getState();
    const p = sentenceBreakAt(st.composingKana);
    if (p >= 0) {
      const head = st.composingKana.slice(0, p + 1);
      engine.replaceDirectKana(st.composingKana.slice(p + 1), st.composingKana.length);
      flow.settle(head);
      lastConvertKana = null;
      st = engine.getState();
    }

    flow.setCurrent(st.composingKana, st.pendingDisplay);
    scheduleConvert(st.composingKana);
    render();
  }

  // ---- 打鍵 ----

  /**
   * コンポーザが飲まないキー。**ホストの編集操作としてそのまま通す。**
   * 案 B はホストのキャレットに追従するので、キャレットを動かせないと比較にならない
   * （keyEventFromBrowser は矢印にも HID コードを返すため、素通しはこちらで決める）。
   */
  const PASS_THROUGH = new Set([
    "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
    "Home", "End", "PageUp", "PageDown", "Tab", "Escape", "Delete", "Insert",
  ]);

  /** Enter は改行（§2.3）。確定操作ではないので、溜まっている分を先にホストへ出して順序を保つ */
  function handleEnter(): void {
    flow.drain();
    engine?.reset();
    lastConvertKana = null;
    insertToHost("\n");
    render();
  }

  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return; // OS/ブラウザのショートカットは奪わない
    if (document.activeElement !== host) return;    // パネルの select / checkbox は素通し
    if (!engine) return;
    if (PASS_THROUGH.has(e.key) || /^F\d+$/.test(e.key)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      handleEnter();
      return;
    }
    const ev = KeymapEngine.keyEventFromBrowser(e);
    if (!ev) return;
    // Backspace は composingKana を持っているエンジンが消す。空なら飲まずにホストへ渡す
    if (e.key === "Backspace" && !engine.isComposing) return;
    e.preventDefault();
    stats.keys++;
    engine.processKey(ev);
    pump();
    opts.onStats?.(stats);
  });

  window.addEventListener("keyup", (e) => {
    if (!engine || document.activeElement !== host) return;
    const ev = KeymapEngine.keyEventFromBrowser(e);
    if (!ev) return;
    engine.processKeyUp(ev); // chord 配列の同時打鍵判定。逐次配列では何も起きない
    pump();
  });

  // ---- 隠す操作（§2.6）: 既定はポインタホバーで半透明化 ----
  //
  // キーを一つも消費せず、閾値も要らず、「重なっているところを見に行く」という動作
  // そのものが隠す操作になっている。ブロックは pointer-events: none なので :hover が
  // 効かない（ホストをクリックできるほうを優先した）。座標で判定する

  let dimmed = false;
  let dimStart = 0;
  window.addEventListener("mousemove", (e) => {
    if (!hideOnHover) return;
    const r = block.el.getBoundingClientRect();
    const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    setDimmed(over);
  });
  document.addEventListener("mouseleave", () => setDimmed(false));

  function setDimmed(on: boolean): void {
    if (on === dimmed) return;
    dimmed = on;
    block.setDimmed(on);
    if (on) {
      dimStart = performance.now();
      stats.hides++;
    } else {
      stats.hideMs += performance.now() - dimStart;
    }
    opts.onStats?.(stats);
  }

  // ---- 描画と配置 ----

  function render(): void {
    block.render(flow.view());
    reposition();
  }

  /** 中身を作り直さずに座標だけ合わせる（スクロール・リサイズ・キャレット移動） */
  function reposition(): void {
    applyPlacement(block.el, placement, caretSource);
  }

  window.addEventListener("resize", reposition);
  window.addEventListener("scroll", reposition, true);
  document.addEventListener("selectionchange", () => {
    if (placement === "caret") reposition();
  });

  render();

  return {
    setPlacement(mode: Placement): void {
      placement = mode;
      block.el.classList.toggle("cmp-caret-mode", mode === "caret");
      render();
    },
    setHideOnHover(on: boolean): void {
      hideOnHover = on;
      if (!on) setDimmed(false);
    },
    stats,
    resetStats(): void {
      stats.keys = 0;
      stats.hides = 0;
      stats.hideMs = 0;
      opts.onStats?.(stats);
    },
  };
}

function mb(n: number): string {
  return (n / 1024 / 1024).toFixed(1);
}
