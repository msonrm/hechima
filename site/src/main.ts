// hechima ラボサイト — プレーンエディタ（実装順序 [1]: 保存 + undo + カウント）。
//
// 文書モデル: contenteditable の平文運用。中身は「テキストノード + 未確定 span 1 個」だけ。
//   - 未確定（composition）はカーソル位置にインライン挿入（標準 IME の見た目）
//   - 貼り付けはプレーンテキストに剥がす（憲法「プレーンテキスト往復生存」）
//   - 保存は OPFS（非対応環境は localStorage に degrade）へ自動保存
//   - undo/redo は Ctrl+Z / Ctrl+Shift+Z・Ctrl+Y（スナップショット方式。Ctrl+BS の
//     確定アンドゥ = IME 側の取り消しとは別物）
// hechima 側の変更は不要 — cb 契約（show/hide/commit/hostKey/retract/learn/unlearn）で完結。

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
const editorEl = $<HTMLDivElement>("editor");
const countsEl = $<HTMLSpanElement>("counts");
const keymapSelect = $<HTMLSelectElement>("keymap");

let engineStatus = "変換エンジンを準備中…";
let storageLabel = "";
const refreshStatus = () => {
  statusEl.textContent = storageLabel ? `${engineStatus} ・ ${storageLabel}` : engineStatus;
};
const setStatus = (text: string) => { engineStatus = text; refreshStatus(); };
const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

// ---- 変換エンジン（hechima-worker、電文 v0） ----

const worker = new Worker("/vendor/hechima/hechima-worker.js");
const conn = Hechima.connectWorker(worker, {
  // 既定は 9（= ポップアップの 1 ウィンドウ分）だが、それだと 10 件目以降が
  // 存在せずページングが起きない。ウィンドウ複数ページ分を取得する
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

// ---- 文書モデル（contenteditable 平文 + 未確定 span） ----

let compEl: HTMLSpanElement | null = null;

const compositionActive = (): boolean => !!(compEl && compEl.isConnected);

/** 本文（未確定 span を除いたテキスト） */
function docText(): string {
  let out = "";
  const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      compEl && compEl.contains(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out += n.textContent ?? "";
  return out;
}

/** editor 内のキャレット（無ければ末尾）。選択があれば focus 側に潰す */
function caretRange(): Range {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && editorEl.contains(sel.getRangeAt(0).startContainer)) {
    const r = sel.getRangeAt(0).cloneRange();
    r.collapse(false);
    return r;
  }
  const r = document.createRange();
  r.selectNodeContents(editorEl);
  r.collapse(false);
  return r;
}

function selectRange(r: Range): void {
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(r);
}

function setCaretAfter(node: Node): void {
  const r = document.createRange();
  r.setStartAfter(node);
  r.collapse(true);
  selectRange(r);
}

/** キャレット位置（本文の UTF-16 オフセット。未確定 span は挿入位置として数えない） */
function caretOffset(): number {
  const r = caretRange();
  const pre = document.createRange();
  pre.selectNodeContents(editorEl);
  pre.setEnd(r.startContainer, r.startOffset);
  let out = 0;
  const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      compEl && compEl.contains(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = (n.textContent ?? "").length;
    if (pre.comparePoint(n, 0) > 0) break; // キャレットより後ろのノード
    const inPre = pre.comparePoint(n, len) <= 0 ? len
      : (n === r.startContainer ? r.startOffset : 0);
    out += inPre;
    if (n === r.startContainer) break;
  }
  return out;
}

/** 本文オフセット [start, end) を指す Range（未確定 span が無い前提で使う） */
function rangeAt(start: number, end: number): Range | null {
  const r = document.createRange();
  let acc = 0;
  let started = false;
  const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = (n.textContent ?? "").length;
    if (!started && start <= acc + len) {
      r.setStart(n, start - acc);
      started = true;
    }
    if (started && end <= acc + len) {
      r.setEnd(n, Math.max(0, end - acc));
      return r;
    }
    acc += len;
  }
  if (!started && start === acc) {
    r.selectNodeContents(editorEl);
    r.collapse(false);
    return r;
  }
  if (started) {
    r.setEnd(editorEl, editorEl.childNodes.length);
    return r;
  }
  return null;
}

function setCaretByOffset(offset: number): void {
  const r = rangeAt(offset, offset);
  if (r) {
    r.collapse(true);
    selectRange(r);
  }
}

function insertTextAtCaret(text: string): void {
  const r = caretRange();
  r.deleteContents();
  const tn = document.createTextNode(text);
  r.insertNode(tn);
  setCaretAfter(tn);
  editorEl.normalize();
}

/** キャレット直前の n 文字（コードポイント）を削除。成功で true */
function deleteBeforeCaret(nChars: number): boolean {
  const off = caretOffset();
  const before = docText().slice(0, off);
  if (!before) return false;
  const chars = Array.from(before);
  const take = Math.min(nChars, chars.length);
  const units = chars.slice(chars.length - take).join("").length;
  const r = rangeAt(off - units, off);
  if (!r) return false;
  r.deleteContents();
  editorEl.normalize();
  setCaretByOffset(off - units);
  return true;
}

// ---- 保存（OPFS → localStorage に degrade）・undo/redo・カウント ----

const DOC_FILE = "document.txt";
const DOC_LS_KEY = "hechima-doc";
let opfsDoc: { getFileHandle(name: string, o?: { create?: boolean }): Promise<FileSystemFileHandle> } | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function initStorage(): Promise<string> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("hechima", { create: true });
    const fh = await dir.getFileHandle(DOC_FILE, { create: true });
    const text = await (await fh.getFile()).text();
    // createWritable の存在だけ確認（呼んで close すると既存内容が空になるため呼ばない。
    // Safari 旧版などメソッド自体が無い環境は localStorage へ）
    if (typeof (fh as { createWritable?: unknown }).createWritable !== "function") {
      throw new Error("createWritable なし");
    }
    opfsDoc = dir as never;
    storageLabel = "自動保存: この端末（OPFS）";
    return text;
  } catch {
    opfsDoc = null;
    try {
      const text = localStorage.getItem(DOC_LS_KEY) ?? "";
      storageLabel = "自動保存: この端末（localStorage）";
      return text;
    } catch {
      storageLabel = "自動保存: 不可（この環境では保存されません）";
      return "";
    }
  }
}

async function saveDocNow(): Promise<void> {
  const text = docText();
  if (opfsDoc) {
    try {
      const fh = await opfsDoc.getFileHandle(DOC_FILE, { create: true });
      const w = await (fh as unknown as { createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }).createWritable();
      await w.write(text);
      await w.close();
      return;
    } catch {
      // 書けなければ localStorage へ
    }
  }
  try { localStorage.setItem(DOC_LS_KEY, text); } catch { /* 保存不可環境 */ }
}

function scheduleSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void saveDocNow(); }, 800);
}

function updateCounts(): void {
  const t = docText();
  const chars = Array.from(t.replace(/\n/g, "")).length;
  const lines = t.length ? t.split("\n").length : 0;
  countsEl.textContent = `${chars} 字 ・ ${lines} 行`;
}

interface DocState { text: string; caret: number }
const undoStack: DocState[] = [];
const redoStack: DocState[] = [];

function currentState(): DocState {
  return { text: docText(), caret: caretOffset() };
}

/** 変更の直前に呼ぶ（native 編集は beforeinput から） */
function snapshot(): void {
  const cur = currentState();
  const top = undoStack[undoStack.length - 1];
  if (top && top.text === cur.text) return; // 同一テキストは積まない
  undoStack.push(cur);
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
}

function applyState(s: DocState): void {
  compEl = null;
  editorEl.textContent = s.text;
  setCaretByOffset(Math.min(s.caret, s.text.length));
  afterEdit();
}

function undo(): void {
  if (!undoStack.length || compositionActive()) return;
  redoStack.push(currentState());
  applyState(undoStack.pop()!);
}

function redo(): void {
  if (!redoStack.length || compositionActive()) return;
  undoStack.push(currentState());
  applyState(redoStack.pop()!);
}

/** 編集後の共通処理（保存 + カウント） */
function afterEdit(): void {
  scheduleSave();
  updateCounts();
}

// ---- 未確定表示（インライン）と候補ポップアップ ----

function renderComposition(segments: Hechima.SegmentView[]): void {
  if (!segments.length) {
    if (compositionActive() && compEl) {
      const marker = document.createTextNode("");
      compEl.replaceWith(marker);
      setCaretAfter(marker);
      editorEl.normalize();
    }
    compEl = null;
    renderCandidatePopup(segments);
    return;
  }
  if (!compositionActive()) {
    // 選択がある状態での入力開始は選択を置き換える（標準エディタの挙動）
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed &&
        editorEl.contains(sel.getRangeAt(0).startContainer)) {
      snapshot();
      sel.getRangeAt(0).deleteContents();
      editorEl.normalize();
    }
    compEl = document.createElement("span");
    compEl.className = "composition";
    const r = caretRange();
    r.insertNode(compEl);
  }
  compEl!.replaceChildren(
    ...segments.map((s) => {
      const span = document.createElement("span");
      span.className = `seg-${s.kind}`;
      span.textContent = s.text;
      return span;
    }),
  );
  setCaretAfter(compEl!);
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
  const anchorSpan = compEl?.children[focusIdx] as HTMLElement | undefined;
  const anchor = (anchorSpan ?? editorEl).getBoundingClientRect();
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

// ---- セッション（ホスト = このエディタ） ----

const fep = Hechima.createFep({
  show: (segments) => renderComposition(segments),
  hide: () => renderComposition([]),
  commit: (text) => {
    snapshot();
    renderComposition([]); // 未確定 span を畳んでから
    insertTextAtCaret(text);
    afterEdit();
  },
  hostKey: (name) => {
    // 編集キー委譲（薙刀式 T/Y/U の specialAction → 空バッファ時）
    const sel = window.getSelection();
    const canModify = !!sel && typeof sel.modify === "function";
    if (name === "ArrowLeft") { if (canModify) sel.modify("move", "backward", "character"); }
    else if (name === "ArrowRight") { if (canModify) sel.modify("move", "forward", "character"); }
    else if (name === "Backspace") {
      snapshot();
      if (deleteBeforeCaret(1)) afterEdit();
    }
  },
  retract: (text) => {
    // 確定アンドゥ（Ctrl+BS）の文書側協力: キャレット直前が確定テキストと一致するなら取り除く
    const off = caretOffset();
    if (!docText().slice(0, off).endsWith(text)) return false;
    snapshot();
    const r = rangeAt(off - text.length, off);
    if (!r) return false;
    r.deleteContents();
    editorEl.normalize();
    setCaretByOffset(off - text.length);
    afterEdit();
    return true;
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
  editorEl.focus(); // そのまま打鍵を続けられるように
});

$<HTMLButtonElement>("clear").addEventListener("click", () => {
  snapshot();
  fep.reset();
  compEl = null;
  editorEl.textContent = "";
  popupEl.hidden = true;
  afterEdit();
  editorEl.focus();
});

$<HTMLButtonElement>("reset-learning").addEventListener("click", () => {
  // OPFS の保存分を消してから再読み込み（メモリ内の学習は再ロードで消える）
  void saveDocNow().then(() => conn.clearLearning()).finally(() => location.reload());
});

// ---- ユーザー辞書（ページ内直置き UI） ----

const dictPanel = $<HTMLDetailsElement>("dict-panel");
const dictListEl = $<HTMLUListElement>("dict-list");
const dictMsgEl = $<HTMLSpanElement>("dict-msg");
const POS_NAMES: Record<number, string> = { 1: "名詞", 4: "固有名詞", 5: "人名", 9: "地名" };

function renderDict(entries: Hechima.DictEntry[] | null): void {
  if (entries === null) {
    dictMsgEl.textContent = "ユーザー辞書は利用できません";
    return;
  }
  dictListEl.replaceChildren(
    ...entries.map((e, i) => {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `${e.reading} → ${e.word}（${POS_NAMES[e.pos] ?? "その他"}）`;
      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "削除";
      del.addEventListener("click", () => {
        void conn.dictRemove(i).then(renderDict);
      });
      li.append(label, del);
      return li;
    }),
  );
  if (!entries.length) {
    const li = document.createElement("li");
    li.textContent = "（登録なし。よみと単語を入れて登録すると、すぐ変換候補に出ます）";
    dictListEl.replaceChildren(li);
  }
}

dictPanel.addEventListener("toggle", () => {
  if (dictPanel.open) void conn.dictList().then(renderDict);
});

$<HTMLFormElement>("dict-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const readingEl = $<HTMLInputElement>("dict-reading");
  const wordEl = $<HTMLInputElement>("dict-word");
  const reading = readingEl.value.trim();
  const word = wordEl.value.trim();
  const pos = Number($<HTMLSelectElement>("dict-pos").value) || 1;
  if (!reading || !word) return;
  dictMsgEl.textContent = "登録中…";
  void conn.dictAdd(reading, word, pos).then((entries) => {
    if (entries) {
      dictMsgEl.textContent = "";
      readingEl.value = "";
      wordEl.value = "";
      renderDict(entries);
      readingEl.focus();
    } else {
      // wasm 側で Mozc 純正のよみ検証（かな + 英数字は可、漢字等は不可）に弾かれた等
      dictMsgEl.textContent = "登録できませんでした — よみに使えない文字（漢字など）があります";
    }
  });
});

// ---- 再変換（確定済みテキストを選択して 変換キー / Ctrl+/） ----

async function doReconvert(): Promise<void> {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  if (!editorEl.contains(range.startContainer) || !editorEl.contains(range.endContainer)) return;
  const surface = sel.toString();
  if (!surface || surface.includes("\n") || Array.from(surface).length > 64) return;
  snapshot(); // 逆変換不能時や Ctrl+Z での復元用
  range.deleteContents();
  editorEl.normalize();
  range.collapse(true);
  selectRange(range); // キャレットを取り除いた位置へ（composition がここに開く）
  const ok = await fep.reconvert(surface);
  if (!ok) insertTextAtCaret(surface); // 逆変換不能 → 元に戻す
  afterEdit();
}

// ---- キー捕捉 ----

window.addEventListener("keydown", (e) => {
  if (e.metaKey) return; // OS/ブラウザのショートカットは奪わない
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement ||
      e.target instanceof HTMLInputElement) return; // 辞書フォーム等の入力は素通し
  // 候補ポップアップ表示中の数字 1-9 = ウィンドウ内の直接選択（標準 IME の作法）。
  // セッションのキー routing には触れず、ホスト側の方針としてここで先取りする
  if (popupVisible() && !e.ctrlKey && !e.altKey && /^[1-9]$/.test(e.key)) {
    if (fep.selectCandidate(winStart + Number(e.key) - 1)) {
      e.preventDefault();
      return;
    }
  }
  // 再変換: 確定済みテキストを選択して 変換キー（JIS）/ Ctrl+/（US 向け）
  if (!compositionActive() && (e.code === "Convert" || (e.ctrlKey && !e.altKey && e.key === "/"))) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed &&
        editorEl.contains(sel.getRangeAt(0).startContainer)) {
      e.preventDefault();
      void doReconvert();
      return;
    }
  }
  if (fep.feed(e)) {
    e.preventDefault();
    return;
  }
  // ---- セッションが飲まなかったキー = エディタの文書操作 ----
  if (e.ctrlKey && !e.altKey && (e.key === "z" || e.key === "Z")) {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if (e.ctrlKey && !e.altKey && (e.key === "y" || e.key === "Y")) {
    e.preventDefault();
    redo();
    return;
  }
  if (e.key === "Enter" && !e.ctrlKey && !e.altKey) {
    // contenteditable の native Enter は <div>/<br> を作るので平文の \n に統一する
    e.preventDefault();
    snapshot();
    insertTextAtCaret("\n");
    afterEdit();
    return;
  }
  // Backspace / 矢印 / Home / End / Delete などは contenteditable の native に任せる
  // （native 編集のスナップショットは beforeinput で取る）
});
window.addEventListener("keyup", (e) => {
  fep.feedUp(e);
});

// native 編集（BS・Delete・数字等の透過入力）の undo スナップショットと保存
editorEl.addEventListener("beforeinput", () => snapshot());
editorEl.addEventListener("input", () => afterEdit());

// 貼り付けはプレーンテキストに剥がす
editorEl.addEventListener("paste", (e) => {
  e.preventDefault();
  const text = e.clipboardData?.getData("text/plain") ?? "";
  if (!text) return;
  snapshot();
  insertTextAtCaret(text);
  afterEdit();
});

// 未確定のままエディタをクリック → 現在の内容で確定してからカーソル移動（標準 IME の挙動）
editorEl.addEventListener("mousedown", () => {
  if (compositionActive()) fep.feed({ key: "Enter" });
});

// ページを離れるときに保存を確実に
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void saveDocNow();
});

// ---- 起動: 保存文書の復元 ----

void initStorage().then((text) => {
  if (text) {
    editorEl.textContent = text;
    setCaretByOffset(text.length);
  }
  updateCounts();
  refreshStatus();
  editorEl.focus();
});
