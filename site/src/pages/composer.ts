// 経路コンポーザ 実験ページ: 区切りの異なる変換候補を並列に提案できる UI の「器」。
//
// この版で見るのは **配置（§2.6 / §4.4）** —— 案 A（画面中央固定）と案 B（キャレット追従）を
// 切り替えて、実際に打ちながら比べるためのページ。マーク（§2.4）と候補の提示（§2.5）は
// まだ無い。中身のレイアウトはどちらの案でも同じなので、配置だけを先に測れる。
//
// 仕様と測定: hechima/docs/composer.md
import { mountComposer, type ComposerStats } from "../composer/index";
import type { Placement } from "../composer/placement";

const app = document.getElementById("app");
if (!app) throw new Error("#app がありません");

app.innerHTML = `
  <p class="cmp-status" id="cmp-status">変換エンジンを準備中…</p>
  <div class="cmp-host" id="cmp-host" contenteditable="plaintext-only" spellcheck="false"></div>
  <p class="cmp-note">↑ ここが「ホスト」。矩形から押し出された文（4 文目に入った時点で最も古い 1 文）が落ちてきます。</p>
  <div class="cmp-panel">
    <label>配置:
      <select id="cmp-placement">
        <option value="center">案 A — 画面中央固定</option>
        <option value="caret">案 B — キャレット追従</option>
      </select>
    </label>
    <label><input type="checkbox" id="cmp-hover" checked> ホバーで半透明にする</label>
    <button type="button" id="cmp-reset">計測をリセット</button>
    <span class="cmp-stats" id="cmp-stats"></span>
  </div>
`;

const statusEl = document.getElementById("cmp-status") as HTMLParagraphElement;
const hostEl = document.getElementById("cmp-host") as HTMLDivElement;
const placementEl = document.getElementById("cmp-placement") as HTMLSelectElement;
const hoverEl = document.getElementById("cmp-hover") as HTMLInputElement;
const resetEl = document.getElementById("cmp-reset") as HTMLButtonElement;
const statsEl = document.getElementById("cmp-stats") as HTMLSpanElement;

const composer = mountComposer({
  host: hostEl,
  keymap: "romaji",
  status: (text) => { statusEl.textContent = text; },
  onStats: renderStats,
});

function renderStats(s: ComposerStats): void {
  // §4.4 が見たいのは「隠す操作をどれだけ使うか」。配置で本文を覆う頻度が変わるので、
  // 隠す操作の必要性そのものが配置の従属変数になる
  statsEl.textContent = `打鍵 ${s.keys} ／ 隠した回数 ${s.hides}（計 ${(s.hideMs / 1000).toFixed(1)} 秒）`;
}
renderStats(composer.stats);

placementEl.addEventListener("change", () => {
  composer.setPlacement(placementEl.value as Placement);
  hostEl.focus();
});
hoverEl.addEventListener("change", () => {
  composer.setHideOnHover(hoverEl.checked);
  hostEl.focus();
});
resetEl.addEventListener("click", () => {
  composer.resetStats();
  hostEl.focus();
});

composer.setPlacement(placementEl.value as Placement);
hostEl.focus();
