// 縦書き検証ページ（隠しページ: TOP からのリンクなし・noindex）。
// 内蔵ローマ字固定・物理キーボード専用。候補ポップアップの段の並びは
// 既定 = 右から左（縦組の読み順・番号なし）、?cand=lr で番号付き左→右と見比べられる
import { initLabPage } from "../app";

initLabPage({
  flick: "off",
  writingMode: "vertical",
  verticalCandOrder: new URLSearchParams(location.search).get("cand") === "lr" ? "lr" : "rl",
});
