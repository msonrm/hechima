// 配列を使うページが keymap-engine.js を読み込んでいるかを検査する。
//
// `initLabPage({ keymap: "..." })` を書いても、ページの HTML に
// `/vendor/keymap-engine/keymap-engine.js` の script タグが無いと `KeymapEngine` が
// undefined になる。以前はそこで例外が握りつぶされ、**内蔵ローマ字のまま黙って動いていた**
// ——「cya が ちゃ にならない」「nn が ん にならない」のような綴りの欠けとしてしか現れず、
// 打ってみるまで気づけない（2026-08-02 に実際に踏んだ）。
//
// ページ名の対応は `src/pages/<name>.ts` ↔ `<name>/index.html`。

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE_SRC = "/vendor/keymap-engine/keymap-engine.js";

const bad = [];
for (const file of readdirSync(join(SITE, "src/pages"))) {
  if (!file.endsWith(".ts")) continue;
  const name = file.replace(/\.ts$/, "");
  const source = readFileSync(join(SITE, "src/pages", file), "utf-8");
  // config に keymap: "..." があるか（keymapChoices / keymapLabel / keymapLayout は別物）
  if (!/\bkeymap:\s*["']/.test(source)) continue;

  const html = join(SITE, name, "index.html");
  if (!existsSync(html)) {
    bad.push(`${name}: ${name}/index.html が無い`);
    continue;
  }
  if (!readFileSync(html, "utf-8").includes(ENGINE_SRC)) {
    bad.push(`${name}: 配列を使うのに ${name}/index.html が ${ENGINE_SRC} を読んでいない`);
  }
}

if (bad.length) {
  console.error("\ncheck-keymap-script: 配列エンジンの読み込み漏れ\n");
  for (const line of bad) console.error(`  ✗ ${line}`);
  console.error(
    "\nページの HTML に次を足すこと（hechima.js より前）:\n" +
      `  <script src="${ENGINE_SRC}"></script>\n`
  );
  process.exit(1);
}
