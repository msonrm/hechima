// レシート印字のデータ作り（src/qr/receipt.ts）を確かめる（prebuild）。
//
// なぜ要るか: 間違いは**紙が出るまで分からない**（ビット順や帯の高さを間違えても、
// プリンタは黙って崩れた絵を出すか、何も出さない）。実機の無い CI で見られるのはここだけ。
//
// 見るのは 3 つ:
//   1. 折り返し（幅・空行・サロゲートペア・行頭禁則）
//   2. `GS v 0` の帯の見出し（幅バイト数・行数）と、ビットの向き（左端 ＝ 最上位ビット）
//   3. 帯が 24 行ごとに切れて、端数が最後に来ること
import { BAND, INIT, WIDTH, bandsFromRgba, feed, normalize, wrapLines } from "../src/qr/receipt.ts";

let bad = 0;
const ng = (name, msg) => {
  bad++;
  console.log(`  NG [${name}] ${msg}`);
};
const eq = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) ng(name, `${g} ≠ ${w}`);
};

/* ---- 1. 折り返し（1 字 24 ドット ＝ 1 行 16 字） ---- */
const m = (s) => [...s].length * 24;
const a = (n) => "あ".repeat(n);
eq("wrap/ちょうど", wrapLines(a(16), WIDTH, m), [a(16)]);
eq("wrap/あふれ", wrapLines(a(20), WIDTH, m), [a(16), a(4)]);
eq("wrap/空行", wrapLines("あ\n\nい", WIDTH, m), ["あ", "", "い"]);
eq("wrap/禁則", wrapLines(a(16) + "。い", WIDTH, m), [a(15), "あ。い"]);
eq("wrap/サロゲート", wrapLines("𠮷".repeat(17), WIDTH, m), ["𠮷".repeat(16), "𠮷"]);
eq("normalize", normalize("a\r\nb\rc\t\n\n  "), "a\nb\nc");

/* ---- 2. 帯の見出しとビットの向き ---- */
const W = 16;
const H = BAND + 6;
const px = new Uint8ClampedArray(W * H * 4).fill(255);
const black = (x, y) => px.fill(0, (y * W + x) * 4, (y * W + x) * 4 + 3);
black(0, 0);   /* 左上 → 1 帯目の最初のバイトの最上位ビット */
black(15, H - 1); /* 右下 → 2 帯目の最後のバイトの最下位ビット */
const bands = bandsFromRgba(px, W, H);
eq("band/本数", bands.length, 2);
eq("band/見出し1", [...bands[0].subarray(0, 8)], [0x1d, 0x76, 0x30, 0x00, 2, 0, BAND, 0]);
eq("band/見出し2", [...bands[1].subarray(0, 8)], [0x1d, 0x76, 0x30, 0x00, 2, 0, 6, 0]);
eq("band/長さ", bands.map((b) => b.length), [8 + 2 * BAND, 8 + 2 * 6]);
eq("band/左上", bands[0][8], 0x80);
eq("band/右下", bands[1][bands[1].length - 1], 0x01);
const ink = bands.reduce((n, b) => n + [...b.subarray(8)].filter((v) => v).length, 0);
eq("band/白は印字しない", ink, 2);

/* ---- 3. 本番の幅（384 ドット ＝ 48 バイト）と、命令の端 ---- */
const full = bandsFromRgba(new Uint8ClampedArray(WIDTH * 100 * 4).fill(255), WIDTH, 100);
eq("band/384 幅", [full.length, full[0][4], full[0][5], full.at(-1)[6]], [5, 48, 0, 100 - 4 * BAND]);
eq("init", [...INIT], [0x1b, 0x40]);
eq("feed", [...feed(3)], [10, 10, 10]);
eq("feed/負", feed(-1).length, 0);

if (bad) {
  console.log(`レシート印字 ★${bad} 件ちがう`);
  process.exit(1);
}
console.log("レシート印字 そろっている");
