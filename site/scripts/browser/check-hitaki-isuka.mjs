// /hitaki-isuka/ をヘッドレス Chromium で確かめる（ビルド時の検査ではなく、手で回す確認用）。
//
//   PW_DIR=/tmp/pw node site/scripts/browser/check-hitaki-isuka.mjs [base]
//     base: 既定 http://localhost:4789（`cd site && npm run build && npx vite preview --port 4789`）
//           本番なら https://luffa-lang-labo.dev（デプロイ直後は CDN が古い応答を返すことがあるので
//           URL に ?cb= を付けて取りに行く）
//
// 前提は README.md（playwright-core とブラウザ本体の場所）。見るものは 3 つ:
//
//   1. 打鍵: 両配列で子音が薄く出る（seg-pending）、タブを切り替えても文書が残る
//   2. 収まり: タブを画面の上端に置いたとき、説明図とエディタが一画面に収まる
//      （style.css の .hi-figure の max-height はこの実測から決めた: 図より上 ≒ 7rem、下 ≒ 10.5rem）
//   3. 静止: 読み込み中にページが勝手に動かない。2026-09-25 に 3 つ踏んだ ——
//      起動時の focus() で下へ飛ぶ / 説明図の loading="lazy" で 510px 跳ぶ /
//      準備完了で状態表示が折り返して 35px 動く（後の 2 つはスクロールアンカリング）
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";

// playwright-core は package.json に入れていない（ビルドに要らない）。実行したディレクトリか
// PW_DIR の node_modules から読む（ESM は NODE_PATH を見ないので createRequire で探す）
const { chromium } = createRequire(join(process.env.PW_DIR ?? process.cwd(), "_"))("playwright-core");

const base = process.argv[2] ?? "http://localhost:4789";
const url = (hash = "") => `${base}/hitaki-isuka/?cb=${Date.now()}${hash}`;

/** CHROME_PATH が無ければ、Playwright のキャッシュにある headless_shell を探す */
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = join(homedir(), ".cache/ms-playwright");
  for (const dir of existsSync(cache) ? readdirSync(cache) : []) {
    if (!dir.startsWith("chromium_headless_shell")) continue;
    for (const sub of ["chrome-linux/headless_shell", "chrome-headless-shell-linux64/chrome-headless-shell"]) {
      const p = join(cache, dir, sub);
      if (existsSync(p)) return p;
    }
  }
  throw new Error("ブラウザが見つからない。CHROME_PATH で指定するか README.md を参照");
}

const ready = (p) =>
  p.waitForFunction(() => /打てます/.test(document.querySelector("#hi-status")?.textContent ?? ""), null, { timeout: 60000 });
const composition = (p) => p.evaluate(() => document.querySelector(".composition")?.innerHTML ?? "(合成なし)");
let failed = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK" : "NG"}  ${label}${detail ? `  ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: findChrome() });

// 1. 打鍵
{
  const p = await browser.newPage();
  p.on("pageerror", (e) => check(false, "ページのエラー", e.message));
  await p.goto(url());
  await ready(p);
  await p.click("#editor");
  for (const k of ["a", "h", "q"]) await p.keyboard.press(k);
  await p.waitForTimeout(150);
  const hitaki = await composition(p);
  check(hitaki.includes('か<span class="seg-pending">ま</span>'), "ひたき a h q → か＋薄い ま", hitaki);
  await p.keyboard.press("Enter");
  await p.click("#hi-tab-isuka");
  await p.waitForFunction(() => /いすか配列で打てます/.test(document.querySelector("#hi-status")?.textContent ?? ""));
  for (const k of ["e", "o", "b", "q", "r"]) await p.keyboard.press(k);
  await p.waitForTimeout(150);
  const isuka = await composition(p);
  check(isuka.includes('ぎゃ<span class="seg-pending">さ</span>'), "いすか e o b q r → ぎゃ＋薄い さ（Q は無反応）", isuka);
  const doc = await p.evaluate(() => document.querySelector("#editor").innerText);
  check(doc.startsWith("か"), "タブを切り替えても文書が残る", JSON.stringify(doc));
  check((await p.evaluate(() => location.hash)) === "#isuka", "タブで #isuka になる");
  await p.close();
}

// 2. 収まり と 3. 静止（タブを上端に置いてから 6 秒、ページが動かないこと）
for (const [w, h] of [[1280, 800], [1440, 900]]) {
  for (const id of ["hitaki", "isuka"]) {
    const p = await browser.newPage({ viewport: { width: w, height: h } });
    await p.goto(url(`#${id}`));
    await ready(p);
    const y0 = await p.evaluate(() => {
      document.querySelector(".hi-tabs").scrollIntoView({ block: "start" });
      return Math.round(scrollY);
    });
    await p.waitForTimeout(6000);
    const r = await p.evaluate(() => {
      const fig = [...document.querySelectorAll(".hi-figure")].find((e) => e.offsetParent);
      return {
        y: Math.round(scrollY),
        figTop: Math.round(fig.getBoundingClientRect().top),
        editorBottom: Math.round(document.querySelector("#editor").getBoundingClientRect().bottom),
        vh: innerHeight,
      };
    });
    check(r.y === y0, `${w}x${h} ${id}: 読み込み中にページが動かない`, `scrollY ${y0} → ${r.y}`);
    check(r.figTop >= 0 && r.editorBottom <= r.vh, `${w}x${h} ${id}: 図とエディタが一画面に収まる`,
      `図の上端 ${r.figTop} / エディタの下端 ${r.editorBottom} / 画面 ${r.vh}`);
    await p.close();
  }
}

// 起動時のフォーカスでページが下へ飛ばない（何も操作せずに開く）
{
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await p.goto(url());
  await ready(p);
  await p.waitForTimeout(3000);
  const st = await p.evaluate(() => ({ y: Math.round(scrollY), active: document.activeElement?.id }));
  check(st.y === 0 && st.active === "editor", "開いただけではスクロールしない（エディタにはフォーカスが入る）", JSON.stringify(st));
  await p.close();
}

await browser.close();
console.log(failed === 0 ? "\nすべて OK" : `\nNG ${failed} 件`);
process.exit(failed === 0 ? 0 : 1);
