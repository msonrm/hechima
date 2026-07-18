// hechima ラボサイト — 最小デモ（実装順序 [0] の骨格）。
//
// 構成（すべて vendored、外部リソースなし = COEP: require-corp 下で自己完結）:
//   keymap-engine.js（配列エンジン UMD）+ hechima.js（変換セッション層 UMD）を <script> で読み、
//   hechima-worker.js（電文 v0）を Worker として起動して hechima-wasm（Mozc）に接続する。
//
// 候補一覧 UI（実装順序 5）= 下記の候補ポップアップ（9 件ページング + 数字/クリック選択）。

declare const KeymapEngine: {
  version: string;
  decodeKeymap(json: unknown): unknown;
  InputEngine: new (keymap: unknown) => Hechima.InputEngineLike;
  keyEventFromBrowser(tap: Hechima.KeyTap): Hechima.KeyEvent | null;
};

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つからない`);
  return el as T;
};

const statusEl = $<HTMLSpanElement>("status");
const committedEl = $<HTMLSpanElement>("committed");
const compositionEl = $<HTMLSpanElement>("composition");
const keymapSelect = $<HTMLSelectElement>("keymap");

const setStatus = (text: string) => { statusEl.textContent = text; };
const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

// ---- 変換エンジン（hechima-worker、電文 v0） ----

const worker = new Worker("/vendor/hechima/hechima-worker.js");
const conn = Hechima.connectWorker(worker, {
  // 既定は 9（= ポップアップの 1 ウィンドウ分）だが、それだと 10 件目以降が
  // 存在せずスクロールが起きない。ウィンドウ複数ページ分を取得する
  maxCands: 50,
  onProgress: (loaded, total) =>
    setStatus(total > 0 ? `辞書を取得中… ${mb(loaded)} / ${mb(total)} MB` : `辞書を取得中… ${mb(loaded)} MB`),
});
conn
  .init({ wasmJs: "/vendor/hechima-wasm/hechima-wasm.js", dataUrl: "/vendor/hechima-wasm/mozc.data" })
  .then((info) => {
    const learn = info.features.learn
      ? info.features.persist ? " / 学習オン" : " / 学習オン（この環境では保存されません）"
      : "";
    setStatus(`準備完了 — Mozc 実変換（hechima v${info.version} / 電文 v${info.protocol}${learn}）`);
  })
  .catch((e: Error) => setStatus(`エンジン初期化失敗: ${e.message} — フォールバック変換（カナ/かな巡回）で動作中`));

// ---- セッション（ホスト = このページ。文書はただの文字列） ----

let committed = "";

function renderCommitted(): void {
  committedEl.textContent = committed;
}

function renderComposition(segments: Hechima.SegmentView[]): void {
  compositionEl.replaceChildren(
    ...segments.map((s) => {
      const span = document.createElement("span");
      span.className = `seg-${s.kind}`;
      span.textContent = s.text;
      return span;
    }),
  );
  renderCandidatePopup(segments);
}

// ---- 変換候補ポップアップ（KeyLogicKit CandidatePopup の設計を移植） ----
// 注目文節の直下にアンカーし、下端はみ出しで上にフリップ・右端で水平クランプ。
// 9 件ごとのページング + 数字キー 1-9 / クリックで直接選択。

const popupEl = $<HTMLDivElement>("candidates");
const WINDOW_SIZE = 9;
let winStart = 0; // 現在ページの先頭（候補一覧の絶対 index。選択位置から導出）

function popupVisible(): boolean {
  return !popupEl.hidden;
}

function renderCandidatePopup(segments: Hechima.SegmentView[]): void {
  const focusIdx = segments.findIndex((s) => s.kind === "focus");
  const seg = focusIdx >= 0 ? segments[focusIdx] : undefined;
  const cands = seg?.candidates;
  const idx = seg?.candidateIndex;
  const additional = seg?.additional ?? [];
  if (!seg || !cands || idx === undefined || (cands.length < 2 && additional.length === 0)) {
    popupEl.hidden = true;
    return;
  }

  // ページング: 9 件目からさらに送ると次ページ（10 から始まりハイライトは先頭行）、
  // 戻ると前ページ（ハイライトは末尾行）。ページは選択位置から決まる純関数
  winStart = Math.floor(idx / WINDOW_SIZE) * WINDOW_SIZE;

  const inAdditional = seg.additionalIndex !== undefined;
  const rows: HTMLElement[] = [];

  // 追加候補（↑ で段階展開。通常候補の上に注釈付きで表示 = KeyLogicKit と同配置）
  additional.forEach((a, i) => {
    const row = document.createElement("div");
    row.className = "cand-row" + (inAdditional && i === seg.additionalIndex ? " selected" : "");
    const ann = document.createElement("span");
    ann.className = "cand-ann";
    ann.textContent = a.annotation;
    const label = document.createElement("span");
    label.textContent = a.text;
    row.append(ann, label);
    rows.push(row);
  });
  if (additional.length > 0) {
    const divider = document.createElement("div");
    divider.className = "cand-divider";
    rows.push(divider);
  }

  const visible = cands.slice(winStart, winStart + WINDOW_SIZE);
  visible.forEach((text, i) => {
    const abs = winStart + i;
    const row = document.createElement("div");
    row.className = "cand-row" + (!inAdditional && abs === idx ? " selected" : "");
    const num = document.createElement("span");
    num.className = "cand-num";
    num.textContent = String(i + 1);
    const label = document.createElement("span");
    label.textContent = text;
    row.append(num, label);
    row.addEventListener("mousedown", (ev) => {
      ev.preventDefault(); // フォーカス移動を防ぐ
      fep.selectCandidate(abs);
    });
    rows.push(row);
  });
  popupEl.replaceChildren(...rows);
  if (cands.length > WINDOW_SIZE) {
    const page = Math.floor(idx / WINDOW_SIZE) + 1;
    const pages = Math.ceil(cands.length / WINDOW_SIZE);
    const more = document.createElement("div");
    more.className = "cand-more";
    more.textContent = `${idx + 1} / ${cands.length}（${page}/${pages} ページ）`;
    popupEl.append(more);
  }
  popupEl.hidden = false;

  // 配置: 注目文節スパンの直下（gap 4px）。下端はみ出しで上にフリップ、右端でクランプ
  const GAP = 4;
  const anchorSpan = compositionEl.children[focusIdx] as HTMLElement | undefined;
  const anchor = (anchorSpan ?? compositionEl).getBoundingClientRect();
  const popupW = popupEl.offsetWidth;
  const popupH = popupEl.offsetHeight;
  let x = anchor.left + window.scrollX;
  let y = anchor.bottom + GAP + window.scrollY;
  if (anchor.bottom + GAP + popupH > window.innerHeight) {
    y = anchor.top - popupH - GAP + window.scrollY;
  }
  if (anchor.left + popupW > window.innerWidth) {
    x = window.innerWidth - popupW + window.scrollX;
  }
  popupEl.style.left = `${Math.max(0, x)}px`;
  popupEl.style.top = `${Math.max(0, y)}px`;
}

function deleteLastChar(): void {
  committed = Array.from(committed).slice(0, -1).join("");
  renderCommitted();
}

const fep = Hechima.createFep({
  show: (segments) => renderComposition(segments),
  hide: () => renderComposition([]),
  commit: (text) => {
    renderComposition([]);
    committed += text;
    renderCommitted();
  },
  hostKey: (name) => {
    // 編集キー委譲（薙刀式 U 等の specialAction → 空バッファ時）。
    // 文書は末尾追記のみの単純ホストなので BS だけ実装
    if (name === "Backspace") deleteLastChar();
  },
  ...conn.callbacks(),
});
fep.setActive(true);

// ---- 配列切替（内蔵ローマ字 / keymap-format JSON） ----

async function setKeymap(id: string): Promise<void> {
  if (!id) {
    fep.setEngine(null);
    return;
  }
  const res = await fetch(`/vendor/keymaps/${id}.json`);
  if (!res.ok) {
    setStatus(`配列の読み込みに失敗: ${id} (HTTP ${res.status})`);
    return;
  }
  const engine = new KeymapEngine.InputEngine(KeymapEngine.decodeKeymap(await res.json()));
  engine.onStateChange = () => fep.pumpEngine();
  fep.setEngine(engine, (tap) => KeymapEngine.keyEventFromBrowser(tap));
}

keymapSelect.addEventListener("change", () => {
  void setKeymap(keymapSelect.value);
  keymapSelect.blur(); // フォーカスを外してそのまま打鍵できるように（keydown はページ全体で受ける）
});

$<HTMLButtonElement>("clear").addEventListener("click", () => {
  committed = "";
  renderCommitted();
  fep.reset();
  renderComposition([]);
});

$<HTMLButtonElement>("reset-learning").addEventListener("click", () => {
  // OPFS の保存分を消してから再読み込み（メモリ内の学習は再ロードで消える）
  void conn.clearLearning().finally(() => location.reload());
});

// ---- キー捕捉 ----

window.addEventListener("keydown", (e) => {
  if (e.metaKey) return; // OS/ブラウザのショートカットは奪わない
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement) return;
  // 候補ポップアップ表示中の数字 1-9 = ウィンドウ内の直接選択（標準 IME の作法）。
  // セッションのキー routing には触れず、ホスト側の方針としてここで先取りする
  if (popupVisible() && !e.ctrlKey && !e.altKey && /^[1-9]$/.test(e.key)) {
    if (fep.selectCandidate(winStart + Number(e.key) - 1)) {
      e.preventDefault();
      return;
    }
  }
  if (fep.feed(e)) {
    e.preventDefault();
    return;
  }
  // セッションが飲まなかったキー = ホスト（このページ）の文書操作。
  // 内蔵ローマ字経路は空バッファの BS を消費しない設計（QuuBee ではホスト文書が処理する）
  // なので、hostKey('Backspace') と同じ削除処理へ合流させる
  if (e.key === "Backspace" && !e.ctrlKey && !e.altKey) {
    deleteLastChar();
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => {
  fep.feedUp(e);
});
