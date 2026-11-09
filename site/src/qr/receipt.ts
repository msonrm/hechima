/* 58mm 感熱レシートプリンタ（Jieli 4c4a:4155 / BLE 名 YHK-…）へ送るデータを作る。
 *
 * ★**DOM を触らない部分だけ**をここに置く（`scripts/check-receipt.mjs` が node で直接読む）。
 *   機器との接続と canvas への描画は `printer.ts`。
 * ★この機種は ESC/POS の**ラスタ画像（`GS v 0`）しか印字しない** —— テキスト命令は黙って
 *   無視される。だから日本語も英数字も、幅 384 ドットの白黒画像にしてから送る。
 * ★**流量制御が無い**（あふれた分は黙って捨てる）ので、帯（24 行）ごとに分けて渡し、
 *   送る側が帯ごとに待つ。実測で 500ms 待てば欠けず、150ms では欠けた。
 *   出典は `receipt-printer/`（2026-11-04 の実機調査）。
 */

/** 印字幅（ドット）。203dpi で約 48mm。 */
export const WIDTH = 384;
/** 1 つの `GS v 0` に入れる行数（＝ 送る側が待つ単位）。 */
export const BAND = 24;

/** 初期化（ESC @）。 */
export const INIT = Uint8Array.of(0x1b, 0x40);

/** 末尾の紙送り（LF × n）。★切り取り位置まで本文を出すため。 */
export function feed(lines: number): Uint8Array {
  return new Uint8Array(Math.max(0, Math.min(20, Math.floor(lines)))).fill(0x0a);
}

/* 行頭に来てはいけない文字（簡易の禁則）。★来そうになったら、前の 1 字を連れて次の行へ送る
   （追い出し）。ぶら下げは使えない —— 幅 384 ドットの外は印字されない。 */
const NO_START = new Set([..."、。，．,.・：；:;？！?!」』）)］]｝}】〕〉》〟’”ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ…‥々ゝゞヽヾ"]);

/** 印字用に本文を整える（改行の統一・タブ・末尾の空行）。 */
export function normalize(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").replace(/\s+$/, "");
}

/**
 * 本文を幅 `width` に収まる行に割る。`measure` は文字列の幅を返す（canvas の measureText）。
 * ★空の段落（空行）はそのまま 1 行として残す。★サロゲートペアは 1 字として扱う。
 */
export function wrapLines(text: string, width: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let cur: string[] = [];
    for (const ch of para) {
      if (cur.length && measure(cur.join("") + ch) > width) {
        if (NO_START.has(ch) && cur.length > 1) {
          const last = cur.pop()!;
          out.push(cur.join(""));
          cur = [last, ch];
        } else {
          out.push(cur.join(""));
          cur = [ch];
        }
      } else cur.push(ch);
    }
    out.push(cur.join(""));
  }
  return out;
}

/**
 * RGBA の画像（白地に黒）を `GS v 0` の帯に切る。★暗い（R < 128）画素が印字される。
 * `w` は 8 の倍数であること（幅 384 は 48 バイト）。
 */
export function bandsFromRgba(px: Uint8ClampedArray, w: number, h: number): Uint8Array[] {
  const wb = w >> 3;
  const out: Uint8Array[] = [];
  for (let y0 = 0; y0 < h; y0 += BAND) {
    const rows = Math.min(BAND, h - y0);
    const band = new Uint8Array(8 + wb * rows);
    band.set([0x1d, 0x76, 0x30, 0x00, wb & 0xff, wb >> 8, rows & 0xff, rows >> 8]);
    for (let y = 0; y < rows; y++)
      for (let xb = 0; xb < wb; xb++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          if (px[((y0 + y) * w + xb * 8 + bit) * 4] < 128) byte |= 0x80 >> bit;
        }
        band[8 + y * wb + xb] = byte;
      }
    out.push(band);
  }
  return out;
}
