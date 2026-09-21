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
}

export interface FlowView {
  /** 変換済み未確定の文（古い順） */
  settled: SettledView[];
  /** 打鍵中の文（ひらがな ＋ ローマ字の途中） */
  typing: string;
}

/** Enter が実際に行った段（§2.3 の表） */
export type EnterResult = "settled" | "typing" | "newline";

interface Settled {
  kana: string;
  text: string;
  filled: boolean;
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

export class Flow {
  private settled: Settled[] = [];
  private kana = "";
  private inflight = "";
  /** 区切った文の変換結果を凍結するための控え */
  private cache = new Map<string, Segment[]>();

  /** FIFO で押し出された文をホストへ渡す（§2.3） */
  constructor(private readonly onFlush: (text: string) => void) {}

  /** 打鍵中の文（エンジンが持つかな ＋ 合成中のローマ字）を写す */
  setCurrent(kana: string, inflight: string): void {
    this.kana = kana;
    this.inflight = inflight;
  }

  /**
   * 「文を区切る」（§2.3）。句点でも変換キーでも Space 2 連打でも、入口は違えどここへ落ちる。
   * 呼ぶ前にエンジン側のかなを詰め直しておくこと。
   */
  settle(kana: string): void {
    const segs = this.cache.get(kana);
    this.settled.push(segs
      ? { kana, text: join(segs), filled: true }
      : { kana, text: kana, filled: false });
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
      }
    }
    this.drainFifo();
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
      return "typing";
    }
    return "newline";
  }

  view(): FlowView {
    return {
      settled: this.settled.map((s) => ({ text: s.text, filled: s.filled })),
      typing: this.kana + this.inflight,
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
