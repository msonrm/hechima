// 縦書き検証ページ（TOP の実験ページ一覧・対比表「表示・レイアウト」行からは辿れるが、
// まだ noindex = 正式公開は保留中。手順は labo の docs/hechima-tategaki-notes.md）。
// 内蔵ローマ字固定・物理キーボード専用。候補ポップアップの段の並びは
// 既定 = 右から左（縦組の読み順・番号なし）、?cand=lr で番号付き左→右と見比べられる
import { initLabPage } from "../app";

initLabPage({
  keymap: "romaji",
  flick: "off",
  writingMode: "vertical",
  verticalCandOrder: new URLSearchParams(location.search).get("cand") === "lr" ? "lr" : "rl",
});
