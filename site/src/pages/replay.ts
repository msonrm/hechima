// 入力のリプレイ 実験ページ: 打鍵と変換の全部を記録して、あとから再生する。
//
// 記録は ReplayEngine の Recorder が受け持ち、app.ts は「状態が変わる点」で
// `config.recordSink` を呼ぶだけ（Recorder が RecordSink に構造的に適合する）。
//
// 再生は **変換エンジンも配列エンジンも動かさない**。記録された状態遷移を並べ直すだけなので、
// 学習状態が違う第三者の画面でも、記録どおりの候補が記録どおりの順に出る。
// 逆に「記録したキーを再投入する」設計だと、候補の学習差とカーソル上下移動の行長依存で必ず壊れる。
//
// 設計とログ形式 hlog-1: labo docs/hechima-replay-design.md
import { initLabPage, buildCandidateColumns, buildCandidateFooter } from "../app";

// ---- ReplayEngine（/vendor/replay/replay-engine.js） -------------------------

interface PlayDoc {
  text: string;
  caret: number;
  anchor: number | null;
}
interface PlaySeg {
  text: string;
  kind: "yomi" | "focus" | "other";
}
interface PlayCand {
  list: string[];
  sel: number;
  fold?: number;
  expanded: boolean;
  /** 追加候補（↑ で段階展開される ひらがな / カタカナ） */
  additional?: { text: string; annotation: string }[];
  additionalIndex?: number;
}
interface PlayState {
  doc: PlayDoc;
  ime: { visible: boolean; segments: PlaySeg[]; cands: Map<number, PlayCand> };
  /** 押下中のキー（KeyboardEvent.code）。キーボード図が読む */
  pressed: Set<string>;
}

interface KeyboardProfile {
  id: string;
  name: string;
}
interface PlayerView {
  time: number;
  duration: number;
  playing: boolean;
  index: number;
  state: PlayState;
  /** キーボード図に見せる押下集合（コマ送りではその 1 打鍵ぶん） */
  pressedForDisplay: Set<string>;
  caption: string | null;
  chapter: string | null;
}
interface Hlog {
  formatVersion: string;
  meta: {
    recordedAt: string;
    duration: number;
    counts: { keys: number; commits: number; chars: number };
    keymap: { id: string; name?: string; layout?: string; inline?: unknown } | null;
    engines: Record<string, string | null | undefined>;
  };
  events: unknown[];
}

declare const ReplayEngine: {
  version: string;
  /** 戻り値は app.ts の `RecordSink` に構造的に適合する（そのまま config へ渡せる） */
  createRecorder(opts?: unknown): {
    readonly recording: boolean;
    readonly eventCount: number;
    readonly overflowed: boolean;
    start(opts?: unknown): void;
    stop(): Promise<Hlog>;
    discard(): void;
    keyDown(e: { code: string; key: string; repeat?: boolean }): void;
    keyUp(e: { code: string }): void;
    paste(charCount: number): void;
    show(segments: Hechima.SegmentView[]): void;
    hide(): void;
    commit(text: string): void;
    doc(text: string, caret: number, anchor?: number | null): void;
    caret(caret: number, anchor?: number | null): void;
  };
  createPlayer(
    log: unknown,
    opts?: {
      onUpdate?(v: PlayerView): void;
      onEnd?(): void;
      onMismatch?(m: { at: number; expected: string; actual: string }): void;
    },
  ): {
    readonly view: PlayerView;
    play(): void;
    pause(): void;
    seek(ms: number): void;
    step(n?: number): void;
    /** 打鍵単位のコマ送り（次の keydown の直前まで） */
    stepKey(dir?: 1 | -1): void;
    setRate(r: number): void;
    setMode(m: "realtime" | "even"): void;
    destroy(): void;
  };
  visibleCandidates(c: PlayCand): { list: string[]; hidden: number };
  /** 人が開いて注釈を書き足せる形の JSON 文字列にする */
  stringifyLog(log: Hlog): string;
  KEYBOARD_PROFILES: KeyboardProfile[];
  findProfile(id: string): KeyboardProfile | undefined;
  mountKeyboard(
    container: HTMLElement,
    opts: { profile: KeyboardProfile; labels?: Map<string, string> | null; hands?: boolean },
  ): {
    update(pressed: Set<string>): void;
    setProfile(p: KeyboardProfile): void;
    setLabels(m: Map<string, string> | null): void;
    setHands(on: boolean): void;
    destroy(): void;
  };
};

/**
 * 配列エンジン（`/vendor/keymap-engine/keymap-engine.js`）。
 * キーキャップに何を刻むかは配列 JSON にしか書いていないので、ここを通る。
 * **ReplayEngine 側には持たせない** —— 再生はログの描画だけで成立する、が全体の芯なので、
 * 再生器に配列エンジンへの依存を作らない（ホストが繋ぐ）。
 */
declare const KeymapEngine: {
  version: string;
  decodeKeymap(json: unknown, opts?: { layout?: string }): unknown;
  keyCapLabels(km: unknown, opts?: { layout?: string }): Map<string, string>;
};

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つからない`);
  return el as T;
};

/** 同梱している配列（`/vendor/keymaps/*.json`）。JIS/US の別は `layouts` を持つ配列でだけ効く */
const KEYMAPS: { id: string; label: string }[] = [
  { id: "romaji", label: "ローマ字（QWERTY）" },
  { id: "romaji_colemak", label: "ローマ字（Colemak）" },
  { id: "azik", label: "AZIK" },
  { id: "tsuki2-263", label: "月配列 2-263" },
  { id: "naginata", label: "薙刀式" },
  { id: "nicola", label: "NICOLA（親指シフト）" },
  { id: "oyayubi_pyun_1key", label: "親指ぴゅん 1キー版" },
];

/**
 * 同梱エンジンの版を名前で拾う（再現条件の記録用。再生には使わない）。
 * 各エンジンの型宣言は app.ts のモジュールスコープにあり、ここからは見えないので
 * グローバルを直接引く。読めなければ null で構わない。
 */
function globalVersion(name: string): string | null {
  const v = (globalThis as Record<string, unknown>)[name] as { version?: string } | undefined;
  return typeof v?.version === "string" ? v.version : null;
}

const rec = ReplayEngine.createRecorder();

// ---- 配列の選択 -------------------------------------------------------------

const keymapSel = $<HTMLSelectElement>("rep-keymap");
const layoutSel = $<HTMLSelectElement>("rep-layout");
const keymapStatus = $<HTMLSpanElement>("rep-keymap-status");

keymapSel.innerHTML = KEYMAPS.map((k) => `<option value="${k.id}">${k.label}</option>`).join("");

let keymapControl: { load(json: unknown, layout?: string): Promise<void> } | null = null;
/** いま載っている配列（記録に埋め込む。再生には使わないが、段階 B のキーボード表示が要る） */
let currentKeymap: { id: string; name?: string; layout?: string; inline?: unknown } = { id: "romaji" };

async function applyKeymap(): Promise<void> {
  if (!keymapControl) return;
  const id = keymapSel.value;
  const layout = layoutSel.value;
  keymapStatus.textContent = "読み込み中…";
  try {
    const res = await fetch(`/vendor/keymaps/${id}.json`);
    if (!res.ok) throw new Error(`${res.status}`);
    const json = (await res.json()) as { name?: string };
    await keymapControl.load(json, layout || undefined);
    currentKeymap = { id, name: json?.name, layout: layout || undefined, inline: json };
    // ★記録済みのログがあるあいだは図を触らない。いま選んでいる配列で塗り替えると、
    // 「薙刀式のキーキャップでローマ字の打鍵が再生される」ような嘘の絵になる
    if (!log) syncKeyboardTo(json, layout || undefined);
    keymapStatus.textContent = log
      ? `「${json?.name ?? id}」で打てます（図は記録した配列のまま）`
      : `「${json?.name ?? id}」で打てます`;
  } catch (e) {
    keymapStatus.textContent = `⚠ 読み込めません: ${e instanceof Error ? e.message : String(e)}`;
  }
}

initLabPage({
  keymap: "romaji", // 初期状態。セレクタで差し替わる
  flick: "off",
  recordSink: rec,
  onKeymapControl(control) {
    keymapControl = control;
    void applyKeymap();
  },
});

keymapSel.addEventListener("change", () => void applyKeymap());
layoutSel.addEventListener("change", () => void applyKeymap());

// ---- 記録 -------------------------------------------------------------------

let log: Hlog | null = null;
let player: ReturnType<typeof ReplayEngine.createPlayer> | null = null;

const recToggle = $<HTMLButtonElement>("rec-toggle");
const recInfo = $<HTMLSpanElement>("rec-info");
const recNote = $<HTMLParagraphElement>("rec-note");
const downloadBtn = $<HTMLButtonElement>("rec-download");
const discardBtn = $<HTMLButtonElement>("rec-discard");
const playerWrap = $<HTMLElement>("player-wrap");

let infoTimer: number | null = null;

function updateRecInfo(): void {
  if (rec.recording) {
    recInfo.textContent = `⏺ 記録中 — ${rec.eventCount} 件${rec.overflowed ? "（上限に達して打ち切りました）" : ""}`;
  } else if (log) {
    const sec = (log.meta.duration / 1000).toFixed(1);
    recInfo.textContent = `記録済み — ${sec} 秒 / ${log.meta.counts.keys} 打鍵 / ${log.meta.counts.commits} 回の確定`;
  } else {
    recInfo.textContent = "記録していません";
  }
}

function startRecording(): void {
  // 途中から記録すると再生の頭が繋がらないので、まっさらにしてから始める
  document.getElementById("clear")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  // 記録中に配列が変わると、ログの中で打鍵の意味が途中から変わってしまう
  keymapSel.disabled = true;
  layoutSel.disabled = true;

  rec.start({
    text: "",
    caret: 0,
    keymap: currentKeymap,
    fronts: ["keyboard"],
    engines: {
      hechima: globalVersion("Hechima"),
      keymap: globalVersion("KeymapEngine"),
      replay: ReplayEngine.version,
    },
  });

  log = null;
  player?.destroy();
  player = null;
  playerWrap.hidden = true;
  downloadBtn.disabled = true;
  discardBtn.disabled = true;
  syncKeyboardTo(currentKeymap.inline, currentKeymap.layout); // 図をこれから打つ配列へ戻す
  recToggle.textContent = "⏹ 停止";
  recNote.hidden = true;
  updateRecInfo();
  infoTimer = window.setInterval(updateRecInfo, 500);
}

async function stopRecording(): Promise<void> {
  if (infoTimer !== null) {
    clearInterval(infoTimer);
    infoTimer = null;
  }
  log = await rec.stop();
  keymapSel.disabled = false;
  layoutSel.disabled = false;
  recToggle.textContent = "⏺ 記録を開始";
  recNote.hidden = false;
  downloadBtn.disabled = false;
  discardBtn.disabled = false;
  updateRecInfo();
  openPlayer(log);
}

recToggle.addEventListener("click", () => {
  if (rec.recording) void stopRecording();
  else startRecording();
});

discardBtn.addEventListener("click", () => {
  rec.discard();
  log = null;
  player?.destroy();
  player = null;
  playerWrap.hidden = true;
  downloadBtn.disabled = true;
  discardBtn.disabled = true;
  syncKeyboardTo(currentKeymap.inline, currentKeymap.layout); // 図をいま選んでいる配列へ戻す
  updateRecInfo();
});

downloadBtn.addEventListener("click", () => {
  if (!log) return;
  const stamp = log.meta.recordedAt.replace(/[:+]/g, "-").slice(0, 16);
  // 1 行 JSON だと開いても読めない。注釈を書き足せる形で出す
  const blob = new Blob([ReplayEngine.stringifyLog(log)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hechima-${stamp}.hlog.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// ファイル選択はネイティブボタンから開く（label だとボタンに見えない）
$<HTMLButtonElement>("log-open").addEventListener("click", () => $<HTMLInputElement>("log-file").click());

$<HTMLInputElement>("log-file").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text()) as Hlog;
    log = parsed;
    downloadBtn.disabled = false;
    discardBtn.disabled = false;
    updateRecInfo();
    openPlayer(parsed);
  } catch (err) {
    recInfo.textContent = `⚠ 読み込めません: ${err instanceof Error ? err.message : String(err)}`;
  }
});

// ---- 再生 -------------------------------------------------------------------

const playDoc = $<HTMLDivElement>("play-doc");
const playToggle = $<HTMLButtonElement>("play-toggle");
const playScrub = $<HTMLInputElement>("play-scrub");
const playTime = $<HTMLSpanElement>("play-time");
const playMeta = $<HTMLParagraphElement>("play-meta");
const playRate = $<HTMLSelectElement>("play-rate");
const playMode = $<HTMLSelectElement>("play-mode");

/** コードポイント単位の slice（サロゲートペアで割らない） */
const cp = (s: string, a: number, b?: number) => Array.from(s).slice(a, b).join("");

function el(cls: string, text: string): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = text;
  return s;
}

/** 候補窓の 1 ページ件数。本番（app.ts の WINDOW_SIZE）と同じ 9 = 数字キーの並びと一致させる */
const CAND_PAGE = 9;

/**
 * 候補窓。**本番の入力とまったく同じ組み立て関数**（app.ts の buildCandidateColumns）を使う。
 * 見た目を再生側で作り直すと必ずズレる —— 実際、作り直していたときは
 * 追加候補（↑ のひらがな/カタカナ）が丸ごと出ていなかった。
 * 違うのは「クリックで候補を選べない」ことだけ（再生なので選択は記録に従う）。
 */
function buildCands(v: PlayerView): HTMLElement | null {
  if (!v.state.ime.visible) return null;
  const focusIdx = v.state.ime.segments.findIndex((s) => s.kind === "focus");
  const cand = focusIdx >= 0 ? v.state.ime.cands.get(focusIdx) : undefined;
  if (!cand) return null;

  const built = buildCandidateColumns(
    {
      text: v.state.ime.segments[focusIdx].text,
      kind: "focus",
      candidates: cand.list,
      candidateIndex: cand.sel,
      // 二層目を開いている間は全候補を 1 つの流れで見せる（本番のグリッドは再生では出さない）
      foldCount: cand.expanded ? undefined : cand.fold,
      additional: cand.additional,
      additionalIndex: cand.additionalIndex,
    },
    { windowSize: CAND_PAGE },
  );
  if (!built) return null;

  const box = document.createElement("div");
  box.className = "candidates";
  box.append(built.cols);
  const footer = buildCandidateFooter(built, cand.sel);
  if (footer) box.append(footer);
  return box;
}

/** 描画して、候補窓をぶら下げるべき要素（注目文節、無ければキャレット）を返す */
function renderPlayDoc(v: PlayerView): { anchorEl: HTMLElement; caretEl: HTMLElement } {
  const { text, caret, anchor } = v.state.doc;
  playDoc.textContent = "";

  // 選択範囲（あれば）を挟んで 3 分割し、キャレット位置に未確定表示を挿す
  const selStart = anchor === null ? caret : Math.min(anchor, caret);
  const selEnd = anchor === null ? caret : Math.max(anchor, caret);

  playDoc.append(el("", cp(text, 0, selStart)));
  if (selEnd > selStart) playDoc.append(el("play-sel", cp(text, selStart, selEnd)));

  // 未確定の文節を並べつつ、注目文節（変換中の文節）の要素を控えておく
  let focusEl: HTMLSpanElement | null = null;
  if (v.state.ime.visible) {
    for (const seg of v.state.ime.segments) {
      const segEl = el(`play-seg play-seg-${seg.kind}`, seg.text);
      if (seg.kind === "focus" && !focusEl) focusEl = segEl;
      playDoc.append(segEl);
    }
  }

  const caretEl = el("play-caret", "");
  playDoc.append(caretEl);
  playDoc.append(el("", cp(text, selEnd)));

  if (v.caption) {
    const cap = document.createElement("div");
    cap.className = "play-caption";
    cap.textContent = v.caption;
    playDoc.append(cap);
  }
  return { anchorEl: focusEl ?? caretEl, caretEl };
}

/**
 * 候補窓を **注目文節の直下**（キャレットの下ではない）へ置く。
 * 本文の中に入れるとスクロール枠でクリップされて外側が見えなくなるので、
 * 枠の外（.player-wrap）に出して座標だけ合わせる（本番エディタと同じ手）。
 */
let candsEl: HTMLElement | null = null;
function placeCands(v: PlayerView, anchorEl: HTMLElement): void {
  candsEl?.remove();
  candsEl = buildCands(v);
  if (!candsEl) return;

  playerWrap.append(candsEl);
  const a = anchorEl.getBoundingClientRect();
  const host = playerWrap.getBoundingClientRect();
  candsEl.style.left = `${Math.max(0, a.left - host.left)}px`;
  candsEl.style.top = `${a.bottom - host.top + 4}px`;
}

/** キャレットが枠の外へ出たら追いかける（再生中に文書が伸びても見失わない） */
function followCaret(caretEl: HTMLElement): void {
  const top = caretEl.offsetTop;
  const h = playDoc.clientHeight;
  if (top < playDoc.scrollTop || top > playDoc.scrollTop + h - 32) {
    playDoc.scrollTop = Math.max(0, top - h / 2);
  }
}

// ---- キーボード図（段階 B。input 層＝打鍵を読む唯一の消費者） -----------------

const profileSel = $<HTMLSelectElement>("play-profile");
profileSel.innerHTML = ReplayEngine.KEYBOARD_PROFILES.map(
  (p) => `<option value="${p.id}">${p.name}</option>`,
).join("");

const handsToggle = $<HTMLInputElement>("play-hands");
const keyboard = ReplayEngine.mountKeyboard($<HTMLDivElement>("play-keyboard"), {
  profile: ReplayEngine.KEYBOARD_PROFILES[0],
  hands: handsToggle.checked,
});

handsToggle.addEventListener("change", () => keyboard.setHands(handsToggle.checked));

profileSel.addEventListener("change", () => {
  const p = ReplayEngine.findProfile(profileSel.value);
  if (p) keyboard.setProfile(p);
});

/** 配列 JSON からキーキャップの刻印を作る（読めなければ物理刻印のまま） */
function capLabels(json: unknown, layout?: string): Map<string, string> | null {
  if (!json) return null;
  try {
    const km = KeymapEngine.decodeKeymap(json, { layout });
    const labels = KeymapEngine.keyCapLabels(km, { layout });
    return labels.size > 0 ? labels : null;
  } catch {
    return null; // 読めない配列でもキーボード図は出す（刻印が物理のままになるだけ）
  }
}

/**
 * キーボード図を配列に合わせる（刻印 + 物理配置）。
 * レイアウト（JIS/US）は配列側の選択に**連動させる** —— 別々に動かせると
 * 「US の図に JIS 配列の刻印」のような、実在しない組み合わせが作れてしまう。
 * 図だけを別の配置で見たい場合は、あとから図のセレクタで変えられる。
 */
function syncKeyboardTo(json: unknown, layout?: string): void {
  const want = layout === "us" ? "us" : "jis";
  const p = ReplayEngine.findProfile(want);
  if (p && profileSel.value !== want) {
    profileSel.value = want;
    keyboard.setProfile(p);
  }
  keyboard.setLabels(capLabels(json, layout));
}

let lastAnchorEl: HTMLElement | null = null;

function render(v: PlayerView): void {
  // コマ送りでは keyup まで進んでいるので、素の押下状態ではなく表示用の集合を使う
  keyboard.update(v.pressedForDisplay);
  const { anchorEl, caretEl } = renderPlayDoc(v);
  followCaret(caretEl);
  lastAnchorEl = anchorEl;
  placeCands(v, anchorEl);
  playToggle.textContent = v.playing ? "⏸" : "▶";
  playTime.textContent = `${(v.time / 1000).toFixed(1)}s / ${(v.duration / 1000).toFixed(1)}s`;
  if (document.activeElement !== playScrub) {
    playScrub.value = String(v.duration === 0 ? 0 : Math.round((v.time / v.duration) * 1000));
  }
}

function openPlayer(l: Hlog): void {
  player?.destroy();
  const mismatches: unknown[] = [];
  try {
    player = ReplayEngine.createPlayer(l, {
      onUpdate: render,
      onMismatch: (m) => mismatches.push(m),
    });
  } catch (err) {
    playerWrap.hidden = true;
    recInfo.textContent = `⚠ このログは再生できません: ${err instanceof Error ? err.message : String(err)}`;
    return;
  }
  playerWrap.hidden = false;
  // 読み込みのたびに作り直すので、いま画面に出ている速度・進み方をそのまま引き継ぐ
  player.setRate(Number(playRate.value));
  player.setMode(playMode.value as "realtime" | "even");

  const km = l.meta.keymap;
  // 記録した配列のレイアウトにキーボード図を合わせる（NICOLA の US 版など）
  const wantProfile = km?.layout === "us" ? "us" : "jis";
  // 図は **記録した配列** に合わせる（読み込んだログなら送り主の配列）
  syncKeyboardTo(km?.inline, km?.layout);

  const parts = [
    `配列: ${km?.name ?? km?.id ?? "不明"}${km?.layout ? `／${km.layout.toUpperCase()}` : ""}` +
      `${km?.inline ? "（定義を同梱）" : "（定義なし）"}`,
    `${l.events.length} 件のイベント`,
    `記録: ${l.meta.recordedAt}`,
    `hechima ${l.meta.engines?.hechima ?? "?"} / 配列エンジン ${l.meta.engines?.keymap ?? "?"}`,
  ];
  if (mismatches.length > 0) parts.push(`⚠ 整合しない keyframe が ${mismatches.length} 件`);
  playMeta.textContent = parts.join(" ・ ");

  render(player.view);
}

playToggle.addEventListener("click", () => {
  if (!player) return;
  if (player.view.playing) player.pause();
  else player.play();
});

// コマ送りは**打鍵単位**（イベント単位だと 1 打鍵が down/up/show/cand/ins に割れて細かすぎる）
$<HTMLButtonElement>("play-step").addEventListener("click", () => {
  player?.pause();
  player?.stepKey(1);
});

$<HTMLButtonElement>("play-back").addEventListener("click", () => {
  player?.pause();
  player?.stepKey(-1);
});

playScrub.addEventListener("input", () => {
  if (!player) return;
  player.pause();
  player.seek((Number(playScrub.value) / 1000) * player.view.duration);
});

// 枠の外に出した候補窓は、本文をスクロールしても付いてこないので座標を取り直す
playDoc.addEventListener("scroll", () => {
  if (player && lastAnchorEl) placeCands(player.view, lastAnchorEl);
});

playRate.addEventListener("change", () => player?.setRate(Number(playRate.value)));
playMode.addEventListener("change", () => player?.setMode(playMode.value as "realtime" | "even"));

updateRecInfo();
