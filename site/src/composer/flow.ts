// 経路コンポーザ: テキストの流れ（docs/composer.md §2.2 三層モデル / §2.3 テキストの流れ）。
//
// DOM を持たない状態機械。描画は inline.ts、配線は index.ts。
//
// 三層が分けているのは**場所ではなく状態**である（§2.2）。ここが持つのは
//
//   settled … 変換済み未確定の文（最大 2）。書き換えない。マークが付く層
//   kana    … 打鍵中の文。ひらがなのまま。**変換しない**
//
// の二つだけで、確定した文はホストのものなので持たない。
// 打鍵中のかなの実体は配列エンジンの composingKana で、ここにあるのはその写しである
// （エンジンに持たせたままにすると Backspace とキー routing がそのまま効く）。

/** アプリが持つ文の数 = 打鍵中 1 ＋ 変換済み未確定 2（§2.3） */
export const BUFFER_SENTENCES = 3;

/** 句点。**これは合図を兼ねている文字であって、トリガーの本体ではない**（§2.3） */
const SENTENCE_END = /[。！？]/;

/** 空白（半角・全角）。Space 2 連打の判定と「空白しか無いとき」の判定に使う */
const SPACE_ONLY = /^[\s　]*$/;

export interface Segment {
  key: string;
  value: string;
}

export interface SettledView {
  text: string;
  /** false = 変換がまだ届いておらず、かなを見せている */
  filled: boolean;
  /** 区切りの揺れの印（§2.4(b)）。text の中の位置（コードポイント） */
  marks: KanaRange[];
}

/** かなの中の区間（コードポイント単位、end は含まない。配列エンジンの KanaRange と同じ形） */
export interface KanaRange {
  start: number;
  end: number;
}

export interface FlowView {
  /** 変換済み未確定の文（古い順） */
  settled: SettledView[];
  /** 打鍵中の文（ひらがな ＋ ローマ字の途中） */
  typing: string;
  /** 打鍵中の文に付いた誤打マーク（§2.4(a)。句点で踏みとどまったときだけ）。typing の中の位置 */
  typingMarks: KanaRange[];
  /** 打鍵中の文の中のキャレット（typing のコードポイント位置）。普段は末尾 */
  caret: number;
}

/** Enter が実際に行った段（§2.3 の表） */
export type EnterResult = "settled" | "typing" | "newline";

interface Settled {
  kana: string;
  text: string;
  filled: boolean;
  /** 変換結果の文節（よみ → 表記の位置の写しに使う） */
  segs?: Segment[];
  /** 区切りの揺れている区間（よみの位置）。null = 揺れていない / まだ届いていない */
  unsure: KanaRange | null;
}

/**
 * かなの中で最初の句点の位置。無ければ -1。
 *
 * 旧案（矩形）は「句点の**次の 1 文字**」がトリガーだったが、インライン模型では
 * **句点そのもの**で切る（§2.3。判断基準は同じで、注意の在りかが違うので結論が反転した）。
 */
export function sentenceBreakAt(kana: string): number {
  for (let i = 0; i < kana.length; i++) {
    if (SENTENCE_END.test(kana[i]!)) return i;
  }
  return -1;
}

/** 区切る対象になるか（空白しか無いときは区切らない。§2.6 の Markdown ハード改行） */
export function canBreak(kana: string): boolean {
  return !SPACE_ONLY.test(kana);
}

/** 末尾が空白か（Space 2 連打の判定。**時間ではなく位置で見る**。§2.6） */
export function endsWithSpace(kana: string): boolean {
  return /[\s　]$/.test(kana);
}

/**
 * ← / → の行き先（§2.4「マークへの到達」）。**マークの右端へ吸い付く**（直しは BS から始まるので右端）。
 * 行き先のマークが無ければ 1 文字ずつ動く。どちらも文の端で止まる。
 */
export function scanTarget(marks: KanaRange[], cursor: number, length: number, dir: -1 | 1): number {
  if (dir < 0) {
    const ends = marks.map((m) => m.end).filter((e) => e < cursor);
    return ends.length ? Math.max(...ends) : Math.max(0, cursor - 1);
  }
  const ends = marks.map((m) => m.end).filter((e) => e > cursor);
  return ends.length ? Math.min(...ends) : Math.min(length, cursor + 1);
}

// ---- 区切りの揺れ（§2.4(b)） ----

/** 経路（hechima の WirePath のうち、判定に要る分） */
export interface PathLike {
  base: boolean;
  cost: number;
  sizes: number[];
}

/**
 * **baseShare** = 列挙した経路の重みのうち base の区切りが占める取り分（§4.2b / §9.2）。
 * 重みは Mozc の経路コストのソフトマックス（λ = 温度）。**確率ではない** ——
 * 「base が正しいか」には弱く（AUC 0.677）、「正解が近くにあるか」に効く（AUC 0.889）。
 * だから量の名前であって判断の名前ではない。判断は shouldOfferAlternatives の側
 */
export function baseShare(paths: PathLike[], lambda = 500): number {
  if (paths.length === 0) return 1;
  const min = Math.min(...paths.map((p) => p.cost));
  const ws = paths.map((p) => Math.exp(-(p.cost - min) / lambda));
  const bi = Math.max(0, paths.findIndex((p) => p.base));
  return ws[bi]! / ws.reduce((a, b) => a + b, 0);
}

/** 代替の区切りを出す価値があるか（§4.2b: baseShare < 0.9 で 6 文に 1 文、救えるものの 9 割弱） */
export function shouldOfferAlternatives(paths: PathLike[]): boolean {
  return paths.length >= 2 && baseShare(paths) < 0.9;
}

/** 区切りの位置（先頭 0 と末尾を含む） */
function cutsOf(sizes: number[]): number[] {
  const out = [0];
  for (const n of sizes) out.push(out[out.length - 1]! + n);
  return out;
}

/**
 * base と次点の区切りが**食い違う区間**（よみの位置）。前後の共通の区切りまで広げるので、
 * 両端は必ず base の文節の境目に乗る（表記の位置へ写せる）。食い違いが無ければ null
 */
export function unsureSpan(paths: PathLike[]): KanaRange | null {
  const base = paths.find((p) => p.base);
  const alt = paths.filter((p) => !p.base).sort((a, b) => a.cost - b.cost)[0];
  if (!base || !alt) return null;
  const b = cutsOf(base.sizes), a = cutsOf(alt.sizes);
  const bs = new Set(b), as = new Set(a);
  const diff = [...b.filter((x) => !as.has(x)), ...a.filter((x) => !bs.has(x))];
  if (diff.length === 0) return null;
  const lo = Math.min(...diff), hi = Math.max(...diff);
  const common = b.filter((x) => as.has(x));
  return {
    start: Math.max(...common.filter((x) => x < lo)),
    end: Math.min(...common.filter((x) => x > hi)),
  };
}

/**
 * よみの区間を表記の区間へ写す。区間の両端が文節の境目に乗っていなければ null
 * （変換の文節と経路の base の区切りが食い違った = 写せない。印を出さない）
 */
export function kanaToSurface(segs: Segment[], r: KanaRange): KanaRange | null {
  let k = 0, v = 0;
  let start: number | null = null, end: number | null = null;
  if (r.start === 0) start = 0;
  for (const s of segs) {
    k += [...s.key].length;
    v += [...s.value].length;
    if (k === r.start) start = v;
    if (k === r.end) end = v;
  }
  return start !== null && end !== null && start < end ? { start, end } : null;
}

/** 末尾が句点か */
function endsWithSentenceEnd(kana: string): boolean {
  return kana !== "" && SENTENCE_END.test(kana[kana.length - 1]!);
}

/** 文（head）の中に掛かっている誤打の区間だけを残す。ranges はかな全体に対する位置 */
export function residueWithin(ranges: KanaRange[], head: string): KanaRange[] {
  const n = [...head].length;
  return ranges
    .filter((r) => r.start < n)
    .map((r) => ({ start: r.start, end: Math.min(r.end, n) }));
}

/**
 * 句点で踏みとどまった文（§2.4(a)）に、**次の打鍵**が何をしたか。
 * タイマーは使わず、**止めたときのかなと今のかなの関係だけ**で決める（§2.6 の方針）。
 *
 *   keep  … 何も足されていない。まだ止まっている
 *   clear … 止めた文そのものが削られた（BS で句点を消した等）。止めるのをやめ、改めて判定する
 *   pass  … 後ろに何か足された。**止めた文を誤打ごと流す**（settle を変換へ、rest は新しい文）
 *           again = 足されたのが句点 = 句点 2 回（誤打ではなかった・直さないの意思）
 */
export type StopOutcome =
  | { kind: "keep" }
  | { kind: "clear" }
  | { kind: "pass"; settle: string; rest: string; again: boolean };

export function afterStop(stopped: string, kana: string): StopOutcome {
  if (!kana.startsWith(stopped)) return { kind: "clear" };
  if (kana.length === stopped.length) return { kind: "keep" };
  let settle = stopped;
  let rest = kana.slice(stopped.length);
  const again = SENTENCE_END.test(rest[0]!);
  if (again) {
    // 句点で止めた文なら 2 つ目の句点は入れない（句点は 1 つしか入らない）。
    // 「文を区切る」役で止めた文（句点なし）なら、その句点が文の終わりになる
    if (!endsWithSentenceEnd(stopped)) settle += rest[0]!;
    rest = rest.slice(1);
  }
  return { kind: "pass", settle, rest, again };
}

export class Flow {
  private settled: Settled[] = [];
  private kana = "";
  private inflight = "";
  private marks: KanaRange[] = [];
  /** かなの中のカーソル（コードポイント）。null = 末尾 */
  private cursor: number | null = null;
  /** 区切った文の変換結果を凍結するための控え */
  private cache = new Map<string, Segment[]>();

  /** FIFO で押し出された文をホストへ渡す（§2.3） */
  constructor(private readonly onFlush: (text: string) => void) {}

  /** 打鍵中の文（エンジンが持つかな ＋ 合成中のローマ字）を写す */
  /**
   * cursor はかなの中のカーソル（配列エンジンの composingCursor）。省略 = 末尾。
   * ローマ字の途中（inflight）は**カーソルの位置に**見せる（途中を直しているとき）。
   */
  setCurrent(kana: string, inflight: string, marks: KanaRange[] = [], cursor?: number): void {
    this.kana = kana;
    this.inflight = inflight;
    this.marks = marks;
    this.cursor = cursor ?? null;
  }

  /**
   * 「文を区切る」（§2.3）。句点でも変換キーでも Space 2 連打でも、入口は違えどここへ落ちる。
   * 呼ぶ前にエンジン側のかなを詰め直しておくこと。
   */
  settle(kana: string): void {
    const segs = this.cache.get(kana);
    this.settled.push(segs
      ? { kana, text: join(segs), filled: true, segs, unsure: null }
      : { kana, text: kana, filled: false, unsure: null });
    this.drainFifo();
  }

  /** 変換結果が届いた。確定した文を 1 度だけ埋める（**二度目は書き換えない**。§2.2） */
  applyConversion(kana: string, segments: Segment[]): void {
    this.cache.set(kana, segments);
    if (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value as string);
    for (const s of this.settled) {
      if (!s.filled && s.kana === kana) {
        s.text = join(segments);
        s.filled = true;
        s.segs = segments;
      }
    }
    this.drainFifo();
  }

  /**
   * 区切りの揺れが届いた（§2.4(b)）。**印だけを付ける。表記は書き換えない**（§2.2）。
   * span = よみの区間（unsureSpan の結果）。null = 揺れていない
   */
  applyUnsure(kana: string, span: KanaRange | null): void {
    for (const s of this.settled) {
      if (s.kana === kana) s.unsure = span;
    }
  }

  /**
   * Enter（§2.3 の表）。**上から順に一段だけ**進める。
   * 戻り値 "typing" のとき、呼び出し側はエンジンのかなを捨てること。
   */
  enter(): EnterResult {
    if (this.settled.length > 0) {
      // 変換済み未確定の文を、その時の状態のままホストへ。**打鍵中の文は何も変わらない**
      for (const s of this.settled) this.onFlush(s.text);
      this.settled = [];
      return "settled";
    }
    if (this.kana || this.inflight) {
      // 「ここで Enter を押した」= 本人の中では確定していた = ひらがなで書きたかった
      this.onFlush(this.kana + this.inflight);
      this.kana = "";
      this.inflight = "";
      this.marks = [];
      this.cursor = null;
      return "typing";
    }
    return "newline";
  }

  view(): FlowView {
    const chars = [...this.kana];
    const at = Math.min(this.cursor ?? chars.length, chars.length);
    const n = [...this.inflight].length;
    return {
      settled: this.settled.map((s) => {
        const m = s.filled && s.segs && s.unsure ? kanaToSurface(s.segs, s.unsure) : null;
        return { text: s.text, filled: s.filled, marks: m ? [m] : [] };
      }),
      typing: chars.slice(0, at).join("") + this.inflight + chars.slice(at).join(""),
      // カーソルより後ろのマークはローマ字の途中の分だけ後ろへずれる
      typingMarks: this.marks.map((m) => m.start >= at
        ? { start: m.start + n, end: m.end + n }
        : { start: m.start, end: m.end }),
      caret: at + n,
    };
  }

  /** アプリが何か抱えているか（キーを飲むかどうかの判定に使う） */
  get holding(): boolean {
    return this.settled.length > 0 || this.kana !== "" || this.inflight !== "";
  }

  /**
   * 打鍵中の文を入れて BUFFER_SENTENCES を超えた分を押し出す（§2.3 の FIFO）。
   *
   * **変換が届いていない文は押し出さない。** かなのままホストへ出てしまうため。
   * 変換は 1〜5ms なので 2 文ぶんの猶予がある実際の入力ではまず待たない。
   */
  private drainFifo(): void {
    while (this.settled.length + 1 > BUFFER_SENTENCES && this.settled[0]!.filled) {
      this.onFlush(this.settled.shift()!.text);
    }
  }
}

function join(segs: Segment[]): string {
  return segs.map((s) => s.value).join("");
}
