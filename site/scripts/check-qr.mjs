// QR の読み取り（src/qr/format.ts）を、**出す側が実際に出したもの**で往復させる（prebuild）。
//
// なぜ要るか: 読む側の実装は、出す側（logical-layout-labo の editor-mock/qrdoc.c）とは
// 別の言語・別のリポジトリにある。形式を写し間違えても、**カメラを通すまで誰も気づかない**。
// src/qr/vectors.json は C が `tools/qrdoc_dump --bytes` で吐いたもののスナップショットで、
// ★**手で書いたものではない**（先頭の _comment に作り方がある）。
//
// 見るのは 4 つ:
//   1. 順番どおりに入れて本文に戻るか
//   2. ★**順不同**でも戻るか（撮る順は人まかせ）
//   3. 足りない枚が正しく分かるか（＝ 画面に出す「あと何枚」）
//   4. ★**別の文書の枚**が混ざったら弾けるか
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import jsQR from "jsqr";

import { Collector, crc32, readSheet } from "../src/qr/format.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const V = JSON.parse(readFileSync(join(HERE, "../src/qr/vectors.json"), "utf8"));

const hex = (s) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));
let bad = 0;
const ng = (name, msg) => {
  bad++;
  console.log(`  NG [${name}] ${msg}`);
};

/* ---- CRC-32 を 1 つだけ独立に確かめる（表が壊れていたら全部が落ちるので、先に） ---- */
if (crc32(new TextEncoder().encode("123456789")) !== 0xcbf43926)
  ng("crc32", "既知の値（123456789 → CBF43926）と合わない");

/* ★**戻せないこと自体が検査結果**なので、例外は捕まえて NG にする ――
   投げっぱなしだと、どのケースで何件落ちたのかが読めない。 */
const restore = async (col) => {
  try {
    return await col.restore();
  } catch (e) {
    return `★例外: ${e.message ?? e}`;
  }
};

for (const c of V.cases) {
  const sheets = c.pages.map(hex);

  /* 1. 順番どおり */
  const a = new Collector();
  for (const s of sheets) a.add(s);
  if (a.pages !== sheets.length) ng(c.name, `枚数が違う（${a.pages} ≠ ${sheets.length}）`);
  if (!a.ready) ng(c.name, `揃わない（足りない: ${a.missing}）`);
  else {
    const got = await restore(a);
    if (got !== c.text) ng(c.name, `本文が戻らない（${got.slice(0, 40)}…）`);
  }

  /* 2. 逆順（＝ 順不同） */
  const b = new Collector();
  for (const s of [...sheets].reverse()) b.add(s);
  if (!b.ready || (await restore(b)) !== c.text) ng(c.name, "逆順で戻らない");

  /* 3. 1 枚抜く（★足りないことが分かるか。1 枚ものは対象外） */
  if (sheets.length > 1) {
    const d = new Collector();
    sheets.forEach((s, i) => i !== 1 && d.add(s));
    if (d.ready) ng(c.name, "1 枚抜いても「揃った」と言う");
    if (String(d.missing) !== "2") ng(c.name, `足りない枚が違う（${d.missing} ≠ 2）`);
    /* ★同じ枚をもう一度入れても「新しい」と言わない */
    if (d.add(sheets[0]).kind !== "dup") ng(c.name, "同じ枚を「新しい」と言う");
  }

  /* 4. 別の文書の枚を混ぜる（★見出しが違うものは弾く） */
  const other = V.cases.find((x) => x.name !== c.name && x.pages.length > 1);
  if (other) {
    const e = new Collector();
    e.add(sheets[0]);
    if (e.add(hex(other.pages[0])).kind !== "other")
      ng(c.name, `別の文書（${other.name}）の枚を受け入れてしまう`);
  }
}

/* ★生の 1 枚は、ヘッダを持たない ＝ readSheet が seq 0 を返す */
{
  const plain = V.cases.find((c) => !c.packed);
  if (plain && readSheet(hex(plain.pages[0])).seq !== 0) ng("plain", "生の枚をヘッダ有りと読む");
  const packed = V.cases.find((c) => c.packed);
  if (packed && readSheet(hex(packed.pages[0])).seq !== 1) ng("packed", "割れた枚の連番が読めない");
}

/* ---- ★盤面を jsQR に直接食わせる（画像ファイルもカメラも経由しない） ----
   ここまでの検査は「枚の中身が本文に戻るか」で、**枚を読み出す側（jsQR）は通っていない**。
   ★確かめたいのは 2 つ: いちばん密な v30 を読めるか／**binaryData が返るか**
   （`data` は文字列なので、圧縮した中身は文字にならない ―― ここを取り違えると、
   短い本文だけ動いて長い本文で黙って落ちる）。
   ★**画像にしない** —— PNG を作ると、落ちたときに符号が悪いのか絵が悪いのか分からない。
   盤面をそのまま RGBA に展開して渡す。
   ★余白（クワイエットゾーン）は規格どおり 4 模様付けてあるが、**この検査では効かない**
   ―― 0 にしても jsQR は読む（盤面だけを渡しているので、どこが符号かが自明）。
   実際に効くのはカメラで撮るときで、そこは機体側が白い板を描いて確保している。
   ★**壊しても赤くならない箇所を、検査が守っているように書かない。** */
for (const c of V.cases) {
  if (!c.board) continue;
  const { size, bits } = c.board;
  const packed = Buffer.from(bits, "base64");
  const dark = (r, k) => {
    const i = r * size + k;
    return (packed[i >> 3] >> (7 - (i & 7))) & 1;
  };
  const q = 4; /* クワイエットゾーン */
  const side = size + q * 2;
  const rgba = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let r = 0; r < size; r++)
    for (let k = 0; k < size; k++) {
      if (!dark(r, k)) continue;
      const o = ((r + q) * side + (k + q)) * 4;
      rgba[o] = rgba[o + 1] = rgba[o + 2] = 0;
    }
  const got = jsQR(rgba, side, side, { inversionAttempts: "dontInvert" });
  if (!got) {
    ng(c.name, `jsQR が盤面を読めない（v${(size - 17) / 4}）`);
    continue;
  }
  if (!got.binaryData || !got.binaryData.length) {
    ng(c.name, "jsQR が binaryData を返さない");
    continue;
  }
  const mine = Uint8Array.from(got.binaryData);
  const want = hex(c.pages[0]);
  if (mine.length !== want.length || mine.some((v, i) => v !== want[i]))
    ng(c.name, `jsQR が読んだ中身が違う（${mine.length}B ≠ ${want.length}B）`);
  else if (readSheet(mine).seq !== (c.packed ? 1 : 0))
    ng(c.name, "jsQR 経由だと枚の読み分けが変わる");
  /* ★`data`（文字列）で代用すると **plain は通って multi4 だけ落ちる** ――
     「短い本文では動くのに長い本文で黙って落ちる」の実物。2026-09-15 に壊して確かめた。 */
}

if (bad) {
  console.log(`QR の読み取り ★${bad} 件ちがう`);
  process.exit(1);
}
console.log(`QR の読み取り ${V.cases.length} 件そろっている`);
