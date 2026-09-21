// 経路コンポーザの「テキストの流れ」の規則を固定する（docs/composer.md §2.3）。
//
// ここが守るのは、読むだけでは取り違えやすい三つ:
//   1. **句点そのもの**が切り出しのトリガー（旧案の「次の 1 文字」ではない）
//   2. 未確定は**最大 2 文**（打鍵中 1 を入れて 3）。**変換が届いていない文は押し出さない**
//   3. Enter は**一段だけ**進む（§2.3 の表）
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
const { Flow, sentenceBreakAt, canBreak, endsWithSpace } =
  await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

let fail = 0;
let pass = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { console.log(`NG ${name}\n   got  ${g}\n   want ${w}`); fail++; }
  else pass++;
};

const seg = (pairs) => pairs.map(([key, value]) => ({ key, value }));

// --- 1. 句点そのものがトリガー（旧案の「次の 1 文字」から反転した。§2.3） ---
eq("句点だけで切れる", sentenceBreakAt("きょうはあめだ。"), 7);
eq("次の1字は要らない", sentenceBreakAt("きょうはあめだ。で"), 7);
eq("最初の句点で切れる", sentenceBreakAt("あ。い。う"), 1);
eq("！も句点", sentenceBreakAt("すごい！"), 3);
eq("句点なし", sentenceBreakAt("きょうはあめ"), -1);

// --- 2. 区切る対象の判定（空白しか無いときは発火しない。§2.6 の Markdown ハード改行） ---
eq("中身があれば区切れる", canBreak("けんさくご"), true);
eq("空は区切れない", canBreak(""), false);
eq("半角空白だけは区切れない", canBreak("  "), false);
eq("全角空白だけは区切れない", canBreak("　　"), false);
eq("空白＋中身は区切れる", canBreak("　あ"), true);
eq("末尾の空白を見る（全角）", endsWithSpace("けんさくご　"), true);
eq("末尾の空白を見る（半角）", endsWithSpace("けんさくご "), true);
eq("末尾が空白でない", endsWithSpace("けんさくご"), false);

// --- 3. 打鍵中の文は変換されない（§2.2。矩形版の「窓の分割」は無くなった） ---
{
  const f = new Flow(() => {});
  f.setCurrent("きょうはあめだ", "k");
  eq("打鍵中はひらがなのまま", f.view(), { settled: [], typing: "きょうはあめだk" });
}

// --- 4. 未確定は最大 2 文。3 文目を区切った時点で最古が押し出される（§2.1 / §2.3） ---
{
  const flushed = [];
  const f = new Flow((t) => flushed.push(t));
  for (const [kana, text] of [["いち。", "一。"], ["に。", "二。"], ["さん。", "三。"], ["よん。", "四。"]]) {
    f.applyConversion(kana, seg([[kana, text]]));
    f.settle(kana);
  }
  eq("FIFO で古い順に出る", flushed, ["一。", "二。"]);
  eq("未確定は 2 文まで", f.view().settled, [
    { text: "三。", filled: true },
    { text: "四。", filled: true },
  ]);
}

// --- 5. 変換が届いていない文は押し出さない（かなのままホストへ出さない） ---
{
  const flushed = [];
  const f = new Flow((t) => flushed.push(t));
  f.settle("いち。");  // 変換が未着のまま
  f.applyConversion("に。", seg([["に。", "二。"]]));
  f.settle("に。");
  f.applyConversion("さん。", seg([["さん。", "三。"]]));
  f.settle("さん。");
  eq("未変換の先頭は押し出さない", flushed, []);
  f.applyConversion("いち。", seg([["いち。", "一。"]]));
  eq("届いた時点で押し出す", flushed, ["一。"]);
}

// --- 6. 確定した文は書き換えない（§2.2）。届いた 1 度だけ埋まる ---
{
  const f = new Flow(() => {});
  f.settle("あめだ。");
  eq("未着はかなのまま", f.view().settled, [{ text: "あめだ。", filled: false }]);
  f.applyConversion("あめだ。", seg([["あめだ。", "雨だ。"]]));
  eq("届いたら埋まる", f.view().settled, [{ text: "雨だ。", filled: true }]);
  f.applyConversion("あめだ。", seg([["あめだ。", "飴だ。"]]));
  eq("2 度目は書き換えない", f.view().settled, [{ text: "雨だ。", filled: true }]);
}

// --- 7. Enter は一段だけ進む（§2.3 の表） ---
{
  const flushed = [];
  const f = new Flow((t) => flushed.push(t));
  f.applyConversion("いち。", seg([["いち。", "一。"]]));
  f.settle("いち。");
  f.setCurrent("にほんめ", "");

  eq("一段目: 未確定だけを確定", f.enter(), "settled");
  eq("一段目で出るのは未確定の文だけ", flushed, ["一。"]);
  eq("**打鍵中の文は何も変わらない**", f.view(), { settled: [], typing: "にほんめ" });

  eq("二段目: ひらがなのまま確定", f.enter(), "typing");
  eq("二段目で打鍵中が出る", flushed, ["一。", "にほんめ"]);
  eq("二段目のあとは空", f.view(), { settled: [], typing: "" });

  eq("三段目: 改行", f.enter(), "newline");
  eq("三段目はホストへ何も渡さない（改行は呼び出し側）", flushed, ["一。", "にほんめ"]);
}

// --- 8. holding（キーを飲むかどうかの判定に使う） ---
{
  const f = new Flow(() => {});
  eq("空なら抱えていない", f.holding, false);
  f.setCurrent("あ", "");
  eq("打鍵中があれば抱えている", f.holding, true);
  f.setCurrent("", "");
  f.settle("い。");
  eq("未確定があれば抱えている", f.holding, true);
}

if (fail) {
  console.error(`check-composer-flow: ${fail} 件失敗`);
  process.exit(1);
}
console.log(`check-composer-flow: ${pass} 件 OK`);
