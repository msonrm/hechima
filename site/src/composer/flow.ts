// 経路コンポーザ: テキストの流れ（docs/composer.md §2.2 三層モデル / §2.3 テキストの流れ）。
//
// DOM を持たない状態機械。描画は block.ts、配置は placement.ts、配線は index.ts。
// ここが持つのは「かなをどこで切り、どこまでを矩形へ送るか」だけ。
//
// 現在の文のかなは**このクラスではなく配列エンジン（InputEngine.composingKana）が持つ**。
// エンジンに持たせたままにすると Backspace とキー routing（chord 配列の合成中判定）が
// そのまま効くので、index.ts が毎打鍵 setCurrent() で写しているだけの関係になっている。

/** 1行欄の幅 = 40 かな（§2.1。矩形の幅 40 字と揃える） */
export const TAIL_KANA = 40;

/** 保持する文の数（§2.3）。**表示の窓（6 行）とは別物**（§2.3「バッファと窓は別物」） */
export const BUFFER_SENTENCES = 3;

/** 句点。「次の文の1文字目」がトリガーなので、ここに挙げた字の**次に1字来たとき**に流れる */
const SENTENCE_END = /[。！？]/;

export interface Segment {
  key: string;
  value: string;
}

/** 矩形に上詰めで並べる 1 文 */
export interface Line {
  text: string;
  /** true = 確定した文（書き換えない・マークの対象）/ false = 現在の文（都度書き換わる） */
  settled: boolean;
}

export interface FlowView {
  lines: Line[];
  /** 1行欄（右端キャレット固定）。矩形へまだ流れていないかな + 合成中のローマ字 */
  tail: string;
}

interface Settled {
  /** 表記。変換が間に合わなかったときだけ一時的にかなが入り、届いた時点で 1 度だけ埋まる */
  text: string;
  kana: string;
  filled: boolean;
}

/** かな列の中で「句点の次に 1 字以上ある」最初の句点の位置。無ければ -1 */
export function sentenceBreakAt(kana: string): number {
  for (let i = 0; i < kana.length - 1; i++) {
    if (SENTENCE_END.test(kana[i]!)) return i;
  }
  return -1;
}

export class Flow {
  private settled: Settled[] = [];
  private kana = "";
  private inflight = "";
  private segments: Segment[] = [];
  /** segments がどのかなに対する結果か（古い変換結果を捨てるための照合） */
  private segmentsFor = "";
  /** 確定した文の表記を凍結するために直近の変換結果を控えておく */
  private cache = new Map<string, Segment[]>();

  /** 4 文目に入って押し出された文をホストへ送る（§2.3 FIFO） */
  constructor(private readonly onFlush: (text: string) => void) {}

  /** 現在の文（エンジンが持つかな + 合成中のローマ字）を写す */
  setCurrent(kana: string, inflight: string): void {
    this.kana = kana;
    this.inflight = inflight;
  }

  /** 句点までを確定した文として矩形へ送る（§2.3。呼ぶ前にエンジン側のかなを詰め直すこと） */
  settle(kana: string): void {
    const segs = this.cache.get(kana);
    this.settled.push(
      segs
        ? { text: join(segs), kana, filled: true }
        : { text: kana, kana, filled: false },
    );
    // 現在の文を入れて BUFFER_SENTENCES を超えた分だけ押し出す
    while (this.settled.length + 1 > BUFFER_SENTENCES) {
      this.onFlush(this.settled.shift()!.text);
    }
    this.segments = [];
    this.segmentsFor = "";
  }

  /** 変換結果が届いた。現在の文なら差し替え、確定した文なら 1 度だけ埋める */
  applyConversion(kana: string, segments: Segment[]): void {
    this.cache.set(kana, segments);
    // 控えは「直前の句点までのかな」が拾えれば足りるので、増えすぎたら古い順に捨てる
    if (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value as string);
    if (kana === this.kana) {
      this.segments = segments;
      this.segmentsFor = kana;
    }
    for (const s of this.settled) {
      if (!s.filled && s.kana === kana) {
        s.text = join(segments);
        s.filled = true;
      }
    }
  }

  /** 残っているものを全部ホストへ出す（ページを離れるとき等） */
  drain(): void {
    for (const s of this.settled) this.onFlush(s.text);
    this.settled = [];
    const segs = this.segmentsFor === this.kana ? this.segments : [];
    const text = segs.length ? join(segs) : this.kana;
    if (text) this.onFlush(text);
    this.kana = "";
    this.inflight = "";
    this.segments = [];
    this.segmentsFor = "";
  }

  view(): FlowView {
    const lines: Line[] = this.settled.map((s) => ({ text: s.text, settled: true }));
    const segs = this.segmentsFor === this.kana ? this.segments : [];

    // 1行欄に残すのは末尾 40 かな。矩形へ送るのは「左端に到達した」= 窓から出た分だけ（§2.3）。
    //
    // ★切れ目は文節境界に取る（半分だけ変換した表示は作れないため）。つまり
    // **先頭文節を出すと 1行欄が 40 かなを割る間は、まだ出さない。** その間の数かな
    // （最大で文節長 - 1）は 1行欄の左側でクリップされて一時的に見えないが、文節が出きった
    // 時点で矩形に現れる。文節を「またがったまま」出すと矩形と1行欄に同じかなが二重に出る。
    // 境界は scripts/check-composer-flow.mjs が固定している。
    let cut = 0;
    let acc = 0;
    for (const s of segs) {
      const next = acc + s.key.length;
      if (this.kana.length - next + this.inflight.length < TAIL_KANA) break;
      acc = next;
      cut++;
    }
    if (cut > 0) lines.push({ text: join(segs.slice(0, cut)), settled: false });

    return { lines, tail: this.kana.slice(acc) + this.inflight };
  }
}

function join(segs: Segment[]): string {
  return segs.map((s) => s.value).join("");
}
