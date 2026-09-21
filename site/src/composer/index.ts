// 経路コンポーザ（インライン版）の配線（docs/composer.md §2）。
//
// この版で実装したのは **§2.1 全体の形 / §2.2 三層モデル / §2.3 テキストの流れ /
// §2.6 キーの割り当て**（§7 の 4a''）。マーク（§2.4）と候補の提示（§2.5）はまだ無い。
//
// 三層モデル（§2.2）は「場所」ではなく「状態」なので、この版が持つ層は見た目で分かれる:
//   打鍵中の文   … 破線下線。ひらがな。**変換しない**（打鍵フィードバックのセーフガード）
//   未確定の文   … 別の下線。句点で 1 回だけ変換され、以後書き換えない
//   確定した文   … 通常の本文。ホストのもの
//
// キーは四つの役だけ（§2.6）。ここで実装しているのは三つ（マーク走査は 4b）:
//   空白 = Space / 文を区切る = 変換キー・Space 2 連打 / 確定 = Enter

import { Flow, canBreak, endsWithSpace, sentenceBreakAt, type Segment } from "./flow";
import { Inline } from "./inline";

declare const KeymapEngine: {
  version: string;
  decodeKeymap(json: unknown, opts?: { layout?: string }): unknown;
  InputEngine: new (keymap: unknown) => EngineLike;
  keyEventFromBrowser(tap: Hechima.KeyTap): Hechima.KeyEvent | null;
};

/**
 * InputEngine のうちコンポーザが使う分。`hechima.d.ts` の InputEngineLike に
 * かなを足し引きする口を加えたもの（打鍵中のかなの持ち主がエンジンなので、
 * 文の切り出しと Space 2 連打でかなを詰め直すのに要る）。
 */
interface EngineLike extends Hechima.InputEngineLike {
  readonly isComposing: boolean;
  appendDirectKana(kana: string): unknown;
  replaceDirectKana(kana: string, replaceCount: number): unknown;
}

/** 「文を区切る」がどの入口から来たか（§2.6。どちらの道が使われるかを見る） */
export type BreakSource = "punct" | "key" | "double-space";

export interface ComposerStats {
  keys: number;
  /** 区切りの入口ごとの回数 */
  breaks: Record<BreakSource, number>;
  /** Enter が進めた段ごとの回数（§2.3 の表） */
  enters: { settled: number; typing: number; newline: number };
}

export interface ComposerOptions {
  /** 確定した文の着地先（contenteditable の平文）。未確定表示もこの中に描く */
  host: HTMLElement;
  keymap?: string;
  status?(text: string): void;
  onStats?(stats: ComposerStats): void;
}

export interface ComposerHandle {
  readonly stats: ComposerStats;
  resetStats(): void;
}

export function mountComposer(opts: ComposerOptions): ComposerHandle {
  const setStatus = opts.status ?? (() => {});
  const host = opts.host;
  const inline = new Inline(host);
  const flow = new Flow((text) => inline.flush(text));

  const stats: ComposerStats = {
    keys: 0,
    breaks: { punct: 0, key: 0, "double-space": 0 },
    enters: { settled: 0, typing: 0, newline: 0 },
  };
  const bump = (): void => opts.onStats?.(stats);

  // ---- 変換エンジン ----

  const worker = new Worker(`/vendor/hechima/hechima-worker.js?t=${Date.now()}`);
  worker.addEventListener("error", (e) =>
    setStatus(`エンジン worker の読み込みに失敗: ${e.message || "スクリプトを取得できません"}`));
  const conn = Hechima.connectWorker(worker, {
    // 候補は出さない（§2.5 は 4c）ので 1 文節 1 件で足りる
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

  /**
   * 変換は**区切ったときに 1 回だけ**走る（§2.2「ライブ変換を持たない」）。
   * 打鍵のたびには呼ばない —— 打鍵中の文は変換されない層である。
   */
  function convertSettled(kana: string): void {
    void conn.convert(kana).then((segs) => {
      if (!segs) return;
      const out: Segment[] = segs.map((s) => ({ key: s.key, value: s.candidates?.[0] ?? s.key }));
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
    // 配列エンジンは合成中の Space を convert に、Enter を confirm に routing する
    // （keymap-engine の routeStandardControlKey）。**コンポーザにはどちらも無い**ので横取りする
    e.onHostAction = (action: { type: string }): boolean => {
      if (action.type === "convert" || action.type === "insertSpace") {
        handleSpace();
        return true;
      }
      if (action.type === "confirm") {
        handleEnter();
        return true;
      }
      return false;
    };
    engine = e;
  }
  void loadKeymap(opts.keymap ?? "romaji");

  // ---- 三つの役（§2.6） ----

  /**
   * Space。**空白を入れる。変換はしない**（§2.6。Space 本来の意味）。
   * ただし**空白が二つ並んだら 1 つ目を消して「文を区切る」**（壊した反射の受け皿）。
   * 判定は時間ではなく位置で、空白しか無いときは発火しない（Markdown のハード改行）。
   */
  function handleSpace(): void {
    if (!engine) return;
    const kana = engine.getState().composingKana;
    if (endsWithSpace(kana) && canBreak(kana)) {
      engine.replaceDirectKana("", 1); // 1 打目の空白を消す
      breakSentence("double-space");
      return;
    }
    engine.appendDirectKana("　");
  }

  /**
   * 「文を区切る」（§2.3）。句点・変換キー・Space 2 連打の入口が、すべてここへ落ちる。
   * 変換はこのときに 1 回だけ走る。
   */
  function breakSentence(source: BreakSource): boolean {
    if (!engine) return false;
    const kana = engine.getState().composingKana;
    if (!canBreak(kana)) return false; // 空白しか無い / 空
    engine.replaceDirectKana("", kana.length);
    flow.settle(kana);
    convertSettled(kana);
    stats.breaks[source]++;
    bump();
    return true;
  }

  /** Enter。**一段ずつ剥がす**（§2.3 の表） */
  function handleEnter(): void {
    const result = flow.enter();
    if (result === "typing" && engine) {
      // 打鍵中のかなはエンジンが持っているので、こちらも捨てる
      engine.reset();
    }
    if (result === "newline") inline.flush("\n");
    stats.enters[result]++;
    bump();
    render();
  }

  // 貼り付けは平文に剥がす（`contenteditable="true"` を使うので自前で持つ。app.ts と同じ方針。
  // `plaintext-only` にしないのは、未確定表示の span が剥がされる環境があるため）
  host.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain");
    if (text) inline.flush(text);
  });

  // ---- 打鍵 ----

  /**
   * コンポーザが飲まないキー。ホストの編集操作としてそのまま通す。
   * マーク走査（§2.4）が入るまで矢印はここに居る —— 走査先が無いので飲む意味がない。
   */
  const PASS_THROUGH = new Set([
    "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
    "Home", "End", "PageUp", "PageDown", "Tab", "Escape", "Delete", "Insert",
  ]);

  // 「文を区切る」の既定キー（§2.6）。JIS は変換キー、US は右 Alt の単押し。
  // **本来は役として配列側に持たせるもの**で、ここに直書きしているのは 4a'' の仮置きである
  let altTap = false;

  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey) return; // OS/ブラウザのショートカットは奪わない
    if (document.activeElement !== host) return;
    if (!engine) return;

    // 右 Alt の単押し判定: 押している間に他のキーが来たら取り消す
    altTap = e.code === "AltRight" && !e.repeat;
    if (e.code === "AltRight") return;
    if (e.altKey) return;

    if (e.code === "Convert") { // JIS の変換キー
      e.preventDefault();
      breakSentence("key");
      render();
      return;
    }
    if (PASS_THROUGH.has(e.key) || /^F\d+$/.test(e.key)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      handleEnter();
      return;
    }
    const ev = KeymapEngine.keyEventFromBrowser(e);
    if (!ev) return;
    if (e.key === "Backspace" && !engine.isComposing) {
      // エンジンが消すものを持っていない。**未確定の文を抱えているなら飲む** ——
      // ブラウザに任せると未確定表示の span の中身を直接削って、flow の状態と食い違う
      // （次の描画で戻るので壊れはしないが、押しても戻らないように見える）。
      // 確定済み未確定の文への Backspace が何をすべきかは §2 が決めていない。
      // マーク走査（§2.4 = 4b）と一緒に決める
      if (flow.holding) e.preventDefault();
      return;
    }
    e.preventDefault();
    stats.keys++;
    engine.processKey(ev);
    pump();
    bump();
  });

  window.addEventListener("keyup", (e) => {
    if (!engine || document.activeElement !== host) return;
    if (e.code === "AltRight") {
      if (altTap) { // 単押しだった = 「文を区切る」
        altTap = false;
        breakSentence("key");
        render();
      }
      return;
    }
    const ev = KeymapEngine.keyEventFromBrowser(e);
    if (!ev) return;
    engine.processKeyUp(ev); // chord 配列の同時打鍵判定。逐次配列では何も起きない
    pump();
  });

  /**
   * エンジンの状態を読み、句点で切り出して描画する。
   *
   * **かなの持ち主はエンジン**（composingKana）のままにしてある。ホスト側へ引き取ると
   * エンジンが常に idle 判定になり、chord 配列の合成中 routing が変わってしまうため。
   */
  function pump(): void {
    if (!engine) return;
    const confirmed = engine.takeConfirmedText();
    if (confirmed) {
      // 英数モードの確定はコンポーザを通さずホストへ。**inputMode だけでは足りない**:
      // switchToEnglish は confirmComposition() を先に呼ぶので、切り替えた瞬間だけ
      // 「英数モードなのに中身はかな」になる。ASCII かどうかも見て分ける
      if (engine.getState().inputMode === "english" && /^[\x20-\x7e]*$/.test(confirmed)) {
        inline.flush(confirmed);
      } else {
        // 何かの拍子に確定へ落ちたかなは打鍵中の文へ戻す
        engine.appendDirectKana(confirmed);
      }
    }

    // 句点は「区切りの合図」を兼ねている文字なので、変換キーと同じ口へ落とす（§2.3）。
    // 貼り付け等で複数の句点が一度に来ることがあるので回す
    for (;;) {
      const st = engine.getState();
      const p = sentenceBreakAt(st.composingKana);
      if (p < 0) break;
      const head = st.composingKana.slice(0, p + 1);
      const rest = st.composingKana.slice(p + 1);
      engine.replaceDirectKana(rest, st.composingKana.length);
      if (canBreak(head)) {
        flow.settle(head);
        convertSettled(head);
        stats.breaks.punct++;
      }
    }

    const st = engine.getState();
    flow.setCurrent(st.composingKana, st.pendingDisplay);
    render();
  }

  function render(): void {
    inline.render(flow.view());
  }

  render();

  return {
    stats,
    resetStats(): void {
      stats.keys = 0;
      stats.breaks = { punct: 0, key: 0, "double-space": 0 };
      stats.enters = { settled: 0, typing: 0, newline: 0 };
      bump();
    },
  };
}

function mb(n: number): string {
  return (n / 1024 / 1024).toFixed(1);
}
