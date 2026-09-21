// 経路コンポーザの「テキストの流れ」の境界規則を固定する（docs/composer.md §2.3）。
//
// ここが守るのは **1行欄と矩形の切れ目**。1行欄は末尾 40 かなを見せる窓で、矩形へ送るのは
// 「窓から完全に出た文節」だけ、という規則になっている。半分だけ変換した表示は作れないので、
// **先頭文節を出すと 1行欄が 40 かなを割る間は、まだ出さない**（その間の数かなは 1行欄の
// 左側でクリップされて一時的に見えないが、文節が出きった時点で矩形に現れる）。
// 書いた本人が一度取り違えた規則なので、集計ではなく**境界そのもの**をここに置いてある。
//
//   node scripts/check-composer-flow.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// flow.ts は DOM も import も持たない純粋な状態機械なので、その場で JS にして読み込める
const srcPath = fileURLToPath(new URL("../src/composer/flow.ts", import.meta.url));
const js = ts.transpileModule(readFileSync(srcPath, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText;
const { Flow, sentenceBreakAt, TAIL_KANA } =
  await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);


let fail = 0;
let pass = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { console.log(`NG ${name}\n   got  ${g}\n   want ${w}`); fail++; }
  else pass++;
};

// かなを 1 文節 1 語でそれらしく変換したことにするダミー
const seg = (pairs) => pairs.map(([key, value]) => ({ key, value }));

// --- 句点の切り出しは「次の1文字」がトリガー（§2.3） ---
eq("句点だけでは切らない", sentenceBreakAt("きょうはあめだ。"), -1);
eq("次の1字で切れる", sentenceBreakAt("きょうはあめだ。で"), 7);
eq("最初の句点で切れる", sentenceBreakAt("あ。い。う"), 1);
eq("句点なし", sentenceBreakAt("きょうはあめ"), -1);

// --- 短い文は矩形へ出ず、全部 1行欄に残る（§4.6 の 72.2%） ---
{
  const flushed = [];
  const f = new Flow((t) => flushed.push(t));
  f.setCurrent("きょうはあめだ", "");
  f.applyConversion("きょうはあめだ", seg([["きょうは", "今日は"], ["あめだ", "雨だ"]]));
  f.setCurrent("きょうはあめだ", "");
  eq("短文は矩形が空", f.view(), { lines: [], tail: "きょうはあめだ" });
}

// --- 1行欄が 40 かなを超えたぶんだけ、文節単位で矩形へ出る（§2.3） ---
{
  const f = new Flow(() => {});
  const head = "あ".repeat(10), rest = "い".repeat(40);
  // 50 かな。先頭 10 を出しても 1行欄に 40 残るので、ここで初めて出る
  const kana = head + rest;
  f.setCurrent(kana, "");
  f.applyConversion(kana, seg([[head, "＊"], [rest, "＃"]]));
  f.setCurrent(kana, "");
  const v = f.view();
  eq("溢れた文節だけ矩形へ", v.lines, [{ text: "＊", settled: false }]);
  eq("1行欄は 40 かな以上を残す", v.tail.length >= TAIL_KANA && v.tail === rest, true);
}
{
  // 境界ちょうど: 残り 40 かなで切れてはいけない（40 を割る手前まで出す）
  const f = new Flow(() => {});
  const kana = "あ".repeat(8) + "い".repeat(40);
  f.setCurrent(kana, "");
  f.applyConversion(kana, seg([["あ".repeat(8), "＊"], ["い".repeat(40), "＃"]]));
  f.setCurrent(kana, "");
  eq("48=8+40 は先頭文節が出る", f.view().lines.length, 1);
  const g = new Flow(() => {});
  const k2 = "あ".repeat(8) + "い".repeat(33); // 41 かな。先頭を出すと残り 33 で 40 を割る
  g.setCurrent(k2, "");
  g.applyConversion(k2, seg([["あ".repeat(8), "＊"], ["い".repeat(33), "＃"]]));
  g.setCurrent(k2, "");
  eq("41 かなでは出さない", g.view().lines.length, 0);
}

// --- 合成中のローマ字も 1行欄の長さに数える ---
{
  const f = new Flow(() => {});
  const kana = "あ".repeat(8) + "い".repeat(39); // 47 かな。合成中の 1 字を足して 48
  f.setCurrent(kana, "k");
  f.applyConversion(kana, seg([["あ".repeat(8), "＊"], ["い".repeat(39), "＃"]]));
  f.setCurrent(kana, "k");
  eq("合成中を数えて溢れる", f.view().lines.length, 1);
  eq("1行欄の末尾に合成中が付く", f.view().tail.endsWith("k"), true);
}

// --- 3 文バッファと FIFO（§2.3） ---
{
  const flushed = [];
  const f = new Flow((t) => flushed.push(t));
  for (const [kana, text] of [["いち。", "一。"], ["に。", "二。"], ["さん。", "三。"], ["よん。", "四。"]]) {
    f.applyConversion(kana, seg([[kana, text]]));
    f.settle(kana);
  }
  eq("4 文目で最古が押し出される", flushed, ["一。", "二。"]);
  eq("矩形に残るのは 2 文（＋現在の文）", f.view().lines, [
    { text: "三。", settled: true },
    { text: "四。", settled: true },
  ]);
}

// --- 確定した文は書き換えない。変換が間に合わなければ 1 度だけ埋まる ---
{
  const f = new Flow(() => {});
  f.settle("あめだ。"); // 変換結果が未着
  eq("未着はかなのまま", f.view().lines, [{ text: "あめだ。", settled: true }]);
  f.applyConversion("あめだ。", seg([["あめだ。", "雨だ。"]]));
  eq("届いたら埋まる", f.view().lines, [{ text: "雨だ。", settled: true }]);
  f.applyConversion("あめだ。", seg([["あめだ。", "飴だ。"]]));
  eq("2 度目は書き換えない", f.view().lines, [{ text: "雨だ。", settled: true }]);
}

// --- drain: ページを離れるときに全部ホストへ出す ---
{
  const flushed = [];
  const f = new Flow((t) => flushed.push(t));
  f.applyConversion("いち。", seg([["いち。", "一。"]]));
  f.settle("いち。");
  f.setCurrent("にほんめ", "");
  f.applyConversion("にほんめ", seg([["にほんめ", "二本目"]]));
  f.setCurrent("にほんめ", "");
  f.drain();
  eq("drain は確定分と現在の文を出す", flushed, ["一。", "二本目"]);
}


if (fail) {
  console.error(`check-composer-flow: ${fail} 件失敗`);
  process.exit(1);
}
console.log(`check-composer-flow: ${pass} 件 OK`);
