// hechima ラボサイト — 最小デモ（実装順序 [0] の骨格）。
//
// 構成（すべて vendored、外部リソースなし = COEP: require-corp 下で自己完結）:
//   keymap-engine.js（配列エンジン UMD）+ hechima.js（変換セッション層 UMD）を <script> で読み、
//   hechima-worker.js（電文 v0）を Worker として起動して hechima-wasm（Mozc）に接続する。
//
// 候補一覧 UI（実装順序 5）は未実装 — 現状は標準 IME 同様のインライン候補送りのみ。

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
  onProgress: (loaded, total) =>
    setStatus(total > 0 ? `辞書を取得中… ${mb(loaded)} / ${mb(total)} MB` : `辞書を取得中… ${mb(loaded)} MB`),
});
conn
  .init({ wasmJs: "/vendor/hechima-wasm/hechima-wasm.js", dataUrl: "/vendor/hechima-wasm/mozc.data" })
  .then((info) => setStatus(`準備完了 — Mozc 実変換（hechima v${info.version} / 電文 v${info.protocol}）`))
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
});

$<HTMLButtonElement>("clear").addEventListener("click", () => {
  committed = "";
  renderCommitted();
  fep.reset();
  renderComposition([]);
});

// ---- キー捕捉 ----

window.addEventListener("keydown", (e) => {
  if (e.metaKey) return; // OS/ブラウザのショートカットは奪わない
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement) return;
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
