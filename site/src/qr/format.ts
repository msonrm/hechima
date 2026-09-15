/* へちまエディタ（PortMaster）の QR を読む側 —— 枚を集めて本文に戻す。
 *
 * 出す側は logical-layout-labo の `editor-mock/qrdoc.c`。形式:
 *
 *   ・1 枚で足りるとき … **生の UTF-8 そのまま**（ヘッダ無し）
 *                        ＝ スマホの標準カメラでもそのまま読める
 *   ・割れているとき  … `EDQ1 <seq>/<pages> <crc32 8桁16進> <全payload長>\n<payload の一部>`
 *                        payload は **deflate-raw**（zlib ヘッダ無し）
 *
 * ★**ヘッダが在る ＝ 圧縮されている**、が例外なしの規則（出す側が、本文そのものが
 *   ヘッダに見える場合も圧縮に回している）。だから読む側の分岐は 1 つで済む。
 * ★`crc32` と `全payload長` は**全枚に同じ値**が入る —— 1 枚目を撮り逃しても、
 *   何枚あるか・繋いだものが正しいかが分かる。
 * ★枚は**順不同**で受ける（撮る順は人まかせ）。
 */

/** 枚ごとの見出し（全枚に同じものが入っている）。 */
export interface Head {
  pages: number;
  crc: number;
  total: number;
}

/** 1 枚を読んだ結果。`seq` が 0 なら生の本文（ヘッダ無しの 1 枚）。 */
export interface Sheet {
  seq: number;
  head: Head | null;
  body: Uint8Array;
}

const HDR = /^EDQ1 (\d+)\/(\d+) ([0-9a-f]{8}) (\d+)\n/;

function ascii(b: Uint8Array, max: number): string {
  let s = "";
  for (let i = 0; i < Math.min(max, b.length); i++) s += String.fromCharCode(b[i]);
  return s;
}

/** 枚を読み分ける。★書式に完全一致したときだけ「割れた枚」と見なす。 */
export function readSheet(bytes: Uint8Array): Sheet {
  const m = HDR.exec(ascii(bytes, 48));
  if (!m) return { seq: 0, head: null, body: bytes };
  const seq = Number(m[1]);
  const pages = Number(m[2]);
  if (seq < 1 || seq > pages) return { seq: 0, head: null, body: bytes };
  return {
    seq,
    head: { pages, crc: parseInt(m[3], 16), total: Number(m[4]) },
    body: bytes.subarray(m[0].length),
  };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

/** CRC-32（zlib と同じ多項式・同じ初期値）。 */
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function inflateRaw(b: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 1 枚を足したときに起きたこと。★画面はこれをそのまま出せばよい。 */
export type AddResult =
  | { kind: "new"; seq: number }        /* 新しい枚が入った */
  | { kind: "dup"; seq: number }        /* もう持っている枚 */
  | { kind: "other" }                   /* 別の文書の枚（見出しが違う） */
  | { kind: "plain" };                  /* 生の本文 1 枚（これだけで完結） */

/**
 * 枚を集める。★**集めている途中の姿がそのまま画面になる**ので、
 * 「何枚目が来たか」「あと何枚か」を状態として持つ。
 */
export class Collector {
  private head: Head | null = null;
  private parts = new Map<number, Uint8Array>();
  private plain: Uint8Array | null = null;

  add(bytes: Uint8Array): AddResult {
    const s = readSheet(bytes);
    if (!s.head) {
      /* ★生の 1 枚は、それだけで本文。既に割れたものを集めていたら別の文書とみなす。 */
      if (this.head) return { kind: "other" };
      this.plain = s.body;
      return { kind: "plain" };
    }
    if (this.plain) return { kind: "other" };
    if (!this.head) this.head = s.head;
    else if (
      this.head.pages !== s.head.pages ||
      this.head.crc !== s.head.crc ||
      this.head.total !== s.head.total
    )
      return { kind: "other" };
    if (this.parts.has(s.seq)) return { kind: "dup", seq: s.seq };
    this.parts.set(s.seq, s.body);
    return { kind: "new", seq: s.seq };
  }

  /** 何枚あるか（生の 1 枚なら 1）。0 = まだ 1 枚も読んでいない。 */
  get pages(): number {
    if (this.plain) return 1;
    return this.head ? this.head.pages : 0;
  }

  /** いま持っている枚の番号（1 始まり・昇順）。 */
  get have(): number[] {
    if (this.plain) return [1];
    return [...this.parts.keys()].sort((a, b) => a - b);
  }

  /** まだ来ていない枚の番号。 */
  get missing(): number[] {
    if (this.plain || !this.head) return [];
    const out: number[] = [];
    for (let i = 1; i <= this.head.pages; i++) if (!this.parts.has(i)) out.push(i);
    return out;
  }

  get ready(): boolean {
    return this.plain !== null || (this.head !== null && this.missing.length === 0);
  }

  get empty(): boolean {
    return this.plain === null && this.head === null;
  }

  reset(): void {
    this.head = null;
    this.parts.clear();
    this.plain = null;
  }

  /** 揃った枚を本文に戻す。★繋いでから長さと CRC を見て、それから展開する。 */
  async restore(): Promise<string> {
    if (this.plain) return new TextDecoder().decode(this.plain);
    if (!this.head) throw new Error("まだ 1 枚も読んでいません");
    if (this.missing.length) throw new Error(`まだ ${this.missing.length} 枚足りません`);
    const { pages, crc, total } = this.head;
    const data = new Uint8Array(total);
    let at = 0;
    for (let i = 1; i <= pages; i++) {
      const part = this.parts.get(i)!;
      if (at + part.length > total) throw new Error("繋いだ長さが見出しと合いません");
      data.set(part, at);
      at += part.length;
    }
    if (at !== total) throw new Error(`繋いだ長さが足りません（${at} ≠ ${total}）`);
    if (crc32(data) !== crc) throw new Error("CRC が合いません（読み違えた枚があります）");
    return new TextDecoder().decode(await inflateRaw(data));
  }
}
