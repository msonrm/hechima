// 経路コンポーザの「テキストの流れ」の規則を固定する（docs/composer.md §2.3）。
//
// ここが守るのは、読むだけでは取り違えやすい三つ:
//   1. **句点そのもの**が切り出しのトリガー（旧案の「次の 1 文字」ではない）
//   2. 未確定は**最大 2 文**（打鍵中 1 を入れて 3）。**変換が届いていない文は押し出さない**
//   3. Enter は**一段だけ**進む（§2.3 の表）
//   4. 句点で踏みとどまった後の**次の打鍵**の扱い（§2.4(a) の表）
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
const { Flow, sentenceBreakAt, canBreak, endsWithSpace, afterStop, residueWithin, scanTarget, baseShare, shouldOfferAlternatives, unsureSpan, kanaToSurface, alternativesIn, spliceSegments, shelfOf } =
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
  eq("打鍵中はひらがなのまま", f.view(), { settled: [], typing: "きょうはあめだk", typingMarks: [], caret: 8 });
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
    { text: "三。", filled: true, marks: [] },
    { text: "四。", filled: true, marks: [] },
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
  eq("未着はかなのまま", f.view().settled, [{ text: "あめだ。", filled: false, marks: [] }]);
  f.applyConversion("あめだ。", seg([["あめだ。", "雨だ。"]]));
  eq("届いたら埋まる", f.view().settled, [{ text: "雨だ。", filled: true, marks: [] }]);
  f.applyConversion("あめだ。", seg([["あめだ。", "飴だ。"]]));
  eq("2 度目は書き換えない", f.view().settled, [{ text: "雨だ。", filled: true, marks: [] }]);
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
  eq("**打鍵中の文は何も変わらない**", f.view(), { settled: [], typing: "にほんめ", typingMarks: [], caret: 4 });

  eq("二段目: ひらがなのまま確定", f.enter(), "typing");
  eq("二段目で打鍵中が出る", flushed, ["一。", "にほんめ"]);
  eq("二段目のあとは空", f.view(), { settled: [], typing: "", typingMarks: [], caret: 0 });

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

// --- 9. 句点で踏みとどまる（§2.4(a)）。次の打鍵で扱いを分ける。タイマーではなく位置で見る ---
eq("何も足されていない = 止まったまま", afterStop("さk。", "さk。"), { kind: "keep" });
eq("BS で句点を消した = 止めるのをやめて改めて判定", afterStop("さk。", "さk"), { kind: "clear" });
eq("直した（読みが変わった）= 改めて判定", afterStop("さk。", "さ"), { kind: "clear" });
eq("句点 2 回 = 誤打ごと変換。句点は 1 つだけ", afterStop("さk。", "さk。。"),
  { kind: "pass", settle: "さk。", rest: "", again: true });
eq("文字キー = 誤打ごと流し、打鍵は新しい文へ", afterStop("さk。", "さk。あ"),
  { kind: "pass", settle: "さk。", rest: "あ", again: false });
eq("「文を区切る」で止めた文に句点 = その句点が文の終わり", afterStop("さk", "さk。"),
  { kind: "pass", settle: "さk。", rest: "", again: true });
eq("「文を区切る」で止めた文に文字 = 誤打ごと流す", afterStop("さk", "さkあ"),
  { kind: "pass", settle: "さk", rest: "あ", again: false });

eq("文の中の誤打だけ残す", residueWithin([{ start: 1, end: 2 }, { start: 5, end: 6 }], "さk。"),
  [{ start: 1, end: 2 }]);
eq("文の外にはみ出した分は切る", residueWithin([{ start: 2, end: 5 }], "さかk"), [{ start: 2, end: 3 }]);
eq("誤打が無ければ空", residueWithin([], "さか。"), []);

{
  const f = new Flow(() => {});
  f.setCurrent("さk。", "", [{ start: 1, end: 2 }]);
  eq("マークは打鍵中の文に乗る", f.view().typingMarks, [{ start: 1, end: 2 }]);
  f.enter();
  eq("Enter で流したらマークも消える", f.view().typingMarks, []);
}

// --- 10. かなカーソル（§2.4「マークへの到達」）。← / → はマークの右端へ吸い付く ---
{
  const marks = [{ start: 2, end: 3 }, { start: 6, end: 7 }];
  eq("← は手前のマークの右端へ", scanTarget(marks, 9, 9, -1), 7);
  eq("← をもう一度で次のマークへ", scanTarget(marks, 7, 9, -1), 3);
  eq("手前にマークが無ければ 1 文字", scanTarget(marks, 3, 9, -1), 2);
  eq("先頭で止まる", scanTarget([], 0, 9, -1), 0);
  eq("→ は後ろのマークの右端へ", scanTarget(marks, 3, 9, 1), 7);
  eq("後ろにマークが無ければ 1 文字", scanTarget(marks, 7, 9, 1), 8);
  eq("末尾で止まる", scanTarget([], 9, 9, 1), 9);
}
{
  const f = new Flow(() => {});
  f.setCurrent("だかざあ。", "r", [], 2);
  eq("ローマ字の途中はカーソルの位置に見せる", f.view().typing, "だかrざあ。");
  eq("キャレットはローマ字の途中の後ろ", f.view().caret, 3);
  f.setCurrent("だかrざあ。k", "", [{ start: 2, end: 3 }, { start: 6, end: 7 }], 3);
  eq("カーソルが無くてもマークはそのまま", f.view().typingMarks, [{ start: 2, end: 3 }, { start: 6, end: 7 }]);
  f.setCurrent("だかrざあ。", "t", [{ start: 2, end: 3 }, { start: 4, end: 5 }], 3);
  eq("カーソルより後ろのマークはずれる", f.view().typingMarks, [{ start: 2, end: 3 }, { start: 5, end: 6 }]);
}

// --- 11. 区切りの揺れ（§2.4(b)）。baseShare < 0.9 で印。印の区間は base と次点が食い違うところ ---
{
  // ここでは|着物を|脱ぐ（base）/ ここで|履物を|脱ぐ
  const paths = [
    { base: true, cost: 1000, sizes: [4, 4, 2] },
    { base: false, cost: 1100, sizes: [3, 5, 2] },
    { base: false, cost: 3000, sizes: [2, 2, 4, 2] },
  ];
  const share = baseShare(paths);
  eq("baseShare は 0..1", share > 0 && share < 1, true);
  eq("コスト差 100 は拮抗 = 代替を出す", shouldOfferAlternatives(paths), true);
  eq("コスト差が大きければ出さない", shouldOfferAlternatives([
    { base: true, cost: 1000, sizes: [4, 4, 2] }, { base: false, cost: 4000, sizes: [3, 5, 2] }]), false);
  eq("経路が 1 本なら出さない", shouldOfferAlternatives([{ base: true, cost: 1000, sizes: [10] }]), false);
  eq("食い違う区間は共通の区切りまで広げる", unsureSpan(paths), { start: 0, end: 8 });
  eq("区切りが同じなら null", unsureSpan([
    { base: true, cost: 1, sizes: [2, 2] }, { base: false, cost: 2, sizes: [2, 2] }]), null);
  eq("後半だけの食い違い", unsureSpan([
    { base: true, cost: 1, sizes: [3, 2, 3] }, { base: false, cost: 2, sizes: [3, 3, 2] }]), { start: 3, end: 8 });

  const segs = seg([["ここでは", "ここでは"], ["きものを", "着物を"], ["ぬぐ", "脱ぐ"]]);
  eq("よみの区間を表記へ写す", kanaToSurface(segs, { start: 0, end: 8 }), { start: 0, end: 7 });
  eq("文節の途中は写せない", kanaToSurface(segs, { start: 0, end: 5 }), null);

  const f = new Flow(() => {});
  f.applyConversion("ここではきものをぬぐ", segs);
  f.settle("ここではきものをぬぐ");
  eq("印が届くまでは無し", f.view().settled[0].marks, []);
  f.applyUnsure("ここではきものをぬぐ", { start: 0, end: 8 });
  eq("印は表記の位置で出る", f.view().settled[0].marks, [{ start: 0, end: 7, kind: "unsure", focused: false }]);
  eq("表記は書き換えない", f.view().settled[0].text, "ここでは着物を脱ぐ");
}

// --- 12. 候補の提示（§2.5）。印の区間の中を区切りで並べ、選んだら区間だけ差し替える ---
{
  const P = (base, cost, pairs) => ({ base, cost, sizes: pairs.map(([k]) => [...k].length), segments: seg(pairs) });
  const paths = [
    P(false, 1100, [["ここで", "ここで"], ["はきものを", "履物を"], ["ぬぐ", "脱ぐ"]]),
    P(true, 1000, [["ここでは", "ここでは"], ["きものを", "着物を"], ["ぬぐ", "脱ぐ"]]),
    P(false, 1500, [["ここで", "此処で"], ["はきものを", "履物を"], ["ぬぐ", "脱ぐ"]]),
    P(false, 1600, [["ここでは", "ここでは"], ["きものを", "着物を"], ["ぬぐ", "拭ぐ"]]),
    P(false, 1700, [["ここ", "ここ"], ["では", "では"], ["きものをぬぐ", "着物を脱ぐ"]]),
  ];
  const span = { start: 0, end: 8 };
  const alts = alternativesIn(paths, span);
  eq("先頭はいまの区切り、以下コスト順", alts.map((a) => a.label), ["ここでは着物を", "ここで履物を", "此処で履物を"]);
  eq("区間の中が同じ経路はまとめる（語尾だけ違う経路は重複）", alts.length, 3);
  eq("区切りだけ違って表記が同じならまとめる（見た目が同じ行を並べない）", alternativesIn([
    P(true, 100, [["きょうは", "今日は"], ["あめ", "雨"]]),
    P(false, 150, [["きょう", "今日"], ["はあめ", "は雨"]]),
    P(false, 200, [["きょうはあ", "今日はあ"], ["め", "め"]]),
  ], { start: 0, end: 6 }).map((a) => a.label), ["今日は雨", "今日はあめ"]);
  const cliff = [
    P(true, 17573, [["ここでは", "ここでは"], ["きものを", "着物を"], ["ぬぐ", "脱ぐ"]]),
    P(false, 18294, [["ここで", "ここで"], ["はきものを", "履物を"], ["ぬぐ", "脱ぐ"]]),
    P(false, 19978, [["ここで", "ここで"], ["はき", "破棄"], ["ものを", "者を"], ["ぬぐ", "脱ぐ"]]),
    P(false, 23654, [["ここ", "個々"], ["で", "デ"], ["はきものを", "履物を"], ["ぬぐ", "脱ぐ"]]),
  ];
  eq("コストの崖の向こうは出さない（実測の値）", alternativesIn(cliff, span).map((a) => a.label), ["ここでは着物を", "ここで履物を"]);

  const segs = seg([["ここでは", "ここでは"], ["きものを", "着物を"], ["ぬぐ", "脱ぐ"]]);
  eq("区間だけ差し替える", spliceSegments(segs, span, alts[1].segments).map((s) => s.value).join("|"), "ここで|履物を|脱ぐ");
  eq("境目に乗らなければ null", spliceSegments(segs, { start: 0, end: 5 }, alts[1].segments), null);

  const f = new Flow(() => {});
  const kana = "ここではきものをぬぐ";
  f.applyConversion(kana, segs);
  f.settle(kana);
  f.applyUnsure(kana, span, paths);
  eq("印の一覧", f.markRefs(), [{ i: 0, key: "u" }]);
  f.setFocus({ i: 0, key: "u" });
  eq("吸い付いた印は見える", f.view().settled[0].marks[0].focused, true);
  eq("候補が並ぶ", f.alternatives().length, 3);
  eq("選ぶと差し替わる", f.choose(1), true);
  eq("表記が変わる", f.view().settled[0].text, "ここで履物を脱ぐ");
  eq("印は消え、走査は終わる", [f.view().settled[0].marks, f.focused], [[], null]);

  const g = new Flow(() => {});
  g.applyConversion(kana, segs); g.settle(kana); g.applyUnsure(kana, span, paths); g.setFocus({ i: 0, key: "u" });
  g.choose(0);
  eq("いまの区切りを選んでも印は消える（確かめた）", [g.view().settled[0].text, g.view().settled[0].marks], ["ここでは着物を脱ぐ", []]);
}

// --- 13. 文書内の一貫性の台帳（§8.1）。棚 = 末尾のひらがなを落としたよみ。先例と違う表記に印 ---
eq("図る / 図った は同じ棚", [shelfOf("はかる", "図る"), shelfOf("はかった", "図った")],
  [{ shelf: "はか", form: "図" }, { shelf: "はか", form: "図" }]);
eq("助詞も落ちる", shelfOf("らんようを", "乱用を"), { shelf: "らんよう", form: "乱用" });
eq("文末の句点も落ちる", [shelfOf("かいせつする。", "解説する。"), shelfOf("かいせつした。", "開設した。")],
  [{ shelf: "かいせつ", form: "解説" }, { shelf: "かいせつ", form: "開設" }]);
eq("長音は語の一部", shelfOf("こーひー", "コーヒー"), { shelf: "こーひー", form: "コーヒー" });
eq("全部かなは棚に入れない", shelfOf("ここでは", "ここでは"), null);
eq("棚のよみが 1 字は入れない（見る / 身を / 実が を繋がない）", shelfOf("みる", "見る"), null);
{
  const S = (key, value, candidates) => ({ key, value, candidates });
  const f = new Flow(() => {});
  f.applyConversion("らんようをいましめる。", [S("らんようを", "乱用を", ["乱用を", "濫用を"]), S("いましめる。", "戒める。")]);
  f.settle("らんようをいましめる。");
  f.applyConversion("らんようがめだつ。", [S("らんようが", "濫用が", ["濫用が", "乱用が"]), S("めだつ。", "目立つ。")]);
  f.settle("らんようがめだつ。");
  eq("先例と違う表記に印", f.view().settled[1].marks, [{ start: 0, end: 3, kind: "variant", focused: false }]);
  eq("先例の文には付かない", f.view().settled[0].marks, []);
  f.setFocus({ i: 1, key: "v0" });
  eq("候補 = いまの表記と、先例に揃えた表記", f.alternatives().map((a) => a.label), ["濫用が", "乱用が"]);
  eq("一言が添えられる", f.note(), "この文書では「乱用を」（1 文前）");
  eq("揃える", f.choose(1), true);
  eq("文節だけ差し替わる", f.view().settled[1].text, "乱用が目立つ。");
  eq("印は消える", f.view().settled[1].marks, []);

  const g = new Flow(() => {});
  g.applyConversion("らんよう。", [S("らんよう。", "乱用。", ["乱用。"])]); g.settle("らんよう。");
  g.applyConversion("らんよう！", [S("らんよう！", "濫用！", ["濫用！"])]); g.settle("らんよう！");
  eq("先例の表記が候補に無ければ印を出さない", g.view().settled[1].marks, []);

  const h = new Flow(() => {});
  h.applyConversion("かいせつする。", [S("かいせつする。", "解説する。", ["解説する。", "開設する。"])]); h.settle("かいせつする。");
  h.applyConversion("かいせつした。", [S("かいせつした。", "開設した。", ["開設した。", "解説した。"])]); h.settle("かいせつした。");
  eq("同音異義語にも印は付く（§8.3 の留保。わざとなら 1 番で消える）", h.view().settled[1].marks.length, 1);
  h.setFocus({ i: 1, key: "v0" });
  h.choose(0);
  eq("いまの表記のまま = 表記は変わらず印だけ消える", [h.view().settled[1].text, h.view().settled[1].marks], ["開設した。", []]);
}

if (fail) {
  console.error(`check-composer-flow: ${fail} 件失敗`);
  process.exit(1);
}
console.log(`check-composer-flow: ${pass} 件 OK`);
