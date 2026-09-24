// 経路コンポーザ 実験ページ（インライン版）。
//
// 打っているものが**本文の中に直接**出る。打鍵中はひらがな、句点でその文だけが変換され、
// 4 文目を打ち始めると最も古い文が確定して通常の本文に戻る。
//
// 句点の時点で誤打（かなにならなかった打鍵）があれば、変換せずに止まる（§2.4(a)）。
// 変換の不確実性マーク（§2.4(b)）と候補の提示（§2.5）はまだ無い。
// 仕様と測定: hechima/docs/composer.md
import { mountComposer, type ComposerStats } from "../composer/index";

const app = document.getElementById("app");
if (!app) throw new Error("#app がありません");

app.innerHTML = `
  <p class="cmp-status" id="cmp-status">変換エンジンを準備中…</p>
  <div class="cmp-host" id="cmp-host" contenteditable="true" spellcheck="false"></div>
  <div class="cmp-panel">
    <button type="button" id="cmp-reset">計測をリセット</button>
    <span class="cmp-stats" id="cmp-stats"></span>
  </div>
`;

const statusEl = document.getElementById("cmp-status") as HTMLParagraphElement;
const hostEl = document.getElementById("cmp-host") as HTMLDivElement;
const resetEl = document.getElementById("cmp-reset") as HTMLButtonElement;
const statsEl = document.getElementById("cmp-stats") as HTMLSpanElement;

const composer = mountComposer({
  host: hostEl,
  keymap: "romaji",
  status: (text) => { statusEl.textContent = text; },
  onStats: renderStats,
});

function renderStats(s: ComposerStats): void {
  // 「文を区切る」にどの入口が使われたかを数える（§2.6）。
  // 変換キーは覚えた人の道、Space 2 連打は覚えていない人の道で、割合がそのまま学習の進み具合になる。
  // Enter の段（§2.3）も数える —— 二段目が多ければ「ひらがなのまま流れた」が起きている
  const b = s.breaks;
  const e = s.enters;
  statsEl.textContent =
    `打鍵 ${s.keys}／区切り: 句点 ${b.punct}・変換キー ${b.key}・Space2連打 ${b["double-space"]}`
    + `／Enter: 未確定を確定 ${e.settled}・ひらがなで確定 ${e.typing}・改行 ${e.newline}`
    // 句点で踏みとどまった後どうなったか（§2.4(a)）。「流れた」が多ければ、止めても見られていない
    + `／誤打で止めた ${s.typo.stops}（句点2回 ${s.typo.again}・流れた ${s.typo.through}・直した ${s.typo.fixed}）`
    // 区切りの揺れの印を付けた割合（§2.4(b)）。§4.2b の予想は 6 文に 1 文（17.8%）
    + `／区切りの揺れ ${s.unsure.marked}/${s.unsure.checked} 文`
    // 候補を開いて何を選んだか（§2.5）。「確かめた」= いまの区切りを選んだ = 印が空振りだった
    + `（候補を開いた ${s.unsure.opened}・別の区切りを選んだ ${s.unsure.changed}・確かめた ${s.unsure.kept}）`
    // 表記の揺れ（§8.1）。「わざと」が多ければ同音異義語を拾っている（§8.3 の留保）
    + `／表記の揺れ: 候補を開いた ${s.variant.opened}・揃えた ${s.variant.changed}・わざと ${s.variant.kept}`;
}
renderStats(composer.stats);

resetEl.addEventListener("click", () => {
  composer.resetStats();
  hostEl.focus();
});

hostEl.focus();
