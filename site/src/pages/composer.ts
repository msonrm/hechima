// 経路コンポーザ 実験ページ（インライン版）。
//
// 打っているものが**本文の中に直接**出る。打鍵中はひらがな、句点でその文だけが変換され、
// 4 文目を打ち始めると最も古い文が確定して通常の本文に戻る。
//
// この版にマーク（§2.4）と候補の提示（§2.5）はまだ無い。
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
    + `／Enter: 未確定を確定 ${e.settled}・ひらがなで確定 ${e.typing}・改行 ${e.newline}`;
}
renderStats(composer.stats);

resetEl.addEventListener("click", () => {
  composer.resetStats();
  hostEl.focus();
});

hostEl.focus();
