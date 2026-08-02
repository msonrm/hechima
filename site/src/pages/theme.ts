// テーマ連動ページ（2026-07-25 公開。TOP の実験ページ一覧・対比表「候補の見た目」行から導線あり）。
//
// 実験の主題は「**候補ウィンドウがページの中にある**とどうなるか」。
// エディタ本文と候補ポップアップは同じ CSS 変数を見ているので、body のクラスと
// --editor-size を差し替えるだけで両方が同時に着替える。
// OS の IME では候補窓が別プロセスなので原理的に起こせない現象（= 対比表「候補の見た目」行の実演）。
//
// 将来の統合執筆環境のテーマ機能（原稿用紙・セピア・ダーク等）の土台でもある。
import { initLabPage } from "../app";

type Theme = { id: string; label: string };

// id は style.css の body.theme-* に対応（色とフォントの定義はすべて CSS 側）
const THEMES: Theme[] = [
  { id: "normal", label: "ノーマル" },
  { id: "neon", label: "ネオン" },
  { id: "letterpress", label: "活版印刷" },
  { id: "terminal", label: "ターミナル" },
];

const KEY_THEME = "hechima-theme";
const KEY_SIZE = "hechima-theme-size";
// 活版印刷は明朝で小さいと読みにくいので、既定サイズだけ少し大きくする
const DEFAULT_SIZE: Record<string, number> = { normal: 18, neon: 17, letterpress: 21, terminal: 17 };

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つからない`);
  return el as T;
};

initLabPage({ keymap: "romaji", flick: "off" });

const swatches = $<HTMLSpanElement>("themes");
const sizeInput = $<HTMLInputElement>("size");
const sizeLabel = $<HTMLSpanElement>("sizeLabel");

let current = localStorage.getItem(KEY_THEME) ?? "normal";
if (current === "komonjo") current = "letterpress"; // 旧 id からの移行
if (!THEMES.some((t) => t.id === current)) current = "normal";

const applyTheme = (id: string): void => {
  current = id;
  // body のクラスを差し替えるだけで、エディタと候補ポップアップの両方が追従する
  document.body.classList.remove(...THEMES.map((t) => `theme-${t.id}`));
  if (id !== "normal") document.body.classList.add(`theme-${id}`);
  for (const b of swatches.querySelectorAll("button")) {
    b.setAttribute("aria-pressed", String(b.dataset.theme === id));
  }
  localStorage.setItem(KEY_THEME, id);
};

const applySize = (px: number): void => {
  // 候補ポップアップは本文より少し小さめ（読みやすさ優先。連動していることは変わらない）
  document.documentElement.style.setProperty("--editor-size", `${px}px`);
  document.documentElement.style.setProperty("--cand-size", `${Math.round(px * 0.92)}px`);
  sizeLabel.textContent = `${px}px`;
  localStorage.setItem(KEY_SIZE, String(px));
};

for (const t of THEMES) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "sw";
  b.dataset.theme = t.id;
  b.textContent = t.label;
  b.setAttribute("aria-pressed", "false");
  b.addEventListener("click", () => {
    applyTheme(t.id);
    // テーマを変えたら、そのテーマの既定サイズへ寄せる（保存済みサイズがあればそれを優先）
    const saved = localStorage.getItem(KEY_SIZE);
    const px = saved ? Number(saved) : (DEFAULT_SIZE[t.id] ?? 18);
    sizeInput.value = String(px);
    applySize(px);
  });
  swatches.appendChild(b);
}

sizeInput.addEventListener("input", () => applySize(Number(sizeInput.value)));

applyTheme(current);
const savedSize = Number(localStorage.getItem(KEY_SIZE) ?? DEFAULT_SIZE[current] ?? 18);
sizeInput.value = String(savedSize);
applySize(savedSize);
