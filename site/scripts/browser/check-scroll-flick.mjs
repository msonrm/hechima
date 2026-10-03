// /scroll-flick/ をヘッドレス Chromium で確かめる（ビルド時の検査ではなく、手で回す確認用）。
//
//   PW_DIR=/tmp/pw node site/scripts/browser/check-scroll-flick.mjs [base]
//     base: 既定 http://localhost:4789（`cd site && npm run build && npx vite preview --port 4789`）
//
// 前提は README.md。盤面は 26 秒周期（3 秒静止 → 右 3 → 静止 3 → 下 4 → 静止 3 → 左 3 → 静止 3 → 上 4）で
// 勝手に動くので、動き出しを盤面の transform から検出して、その間に押して離す:
//   1. 静止中のタップ: 中央の文字が入る（「か」）
//   2. 右へ動いている間 = 左フリック（押したキーの左の文字）
//   3. 下へ動いている間 = 上フリック（押したキーの上の文字）
// どのキーを押したかはタイミング次第なので、「最後に入った文字が左（上）フリックの文字の集合に入るか」で見る。
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";

const { chromium } = createRequire(join(process.env.PW_DIR ?? process.cwd(), "_"))("playwright-core");
const base = process.argv[2] ?? "http://localhost:4789";

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

const LEFT = new Set(["き", "し", "ち", "に", "ひ", "み", "「", "り", "を", "。"]);
const UP = new Set(["う", "く", "す", "つ", "ぬ", "ふ", "む", "ゆ", "る", "ん", "？"]);

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
};

const browser = await chromium.launch({ executablePath: findChrome() });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("pageerror", (e) => check("ページエラーなし", false, e.message));
await page.goto(`${base}/scroll-flick/?cb=${Date.now()}`);
await page.waitForSelector(".sf-root");

const translate = () =>
  page.$eval(".sf-field", (el) => {
    const m = /translate\(([-\d.e]+)%, ([-\d.e]+)%\)/.exec(el.style.transform);
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 };
  });
const editorText = () => page.$eval("#editor", (el) => el.textContent ?? "");
const clearEditor = async () => {
  await page.$eval("#editor", (el) => { el.textContent = ""; });
};
/** 動く盤面の中央あたりの座標 */
const center = async () => {
  const r = await (await page.$(".sf-viewport")).boundingBox();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};

// 1. 静止中のタップ（起動から 3 秒は静止）。「か」は 2 列目の最上段
{
  const r = await (await page.$(".sf-viewport")).boundingBox();
  const x = r.x + r.width / 2;
  const y = r.y + r.height / 8;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  const t = await editorText();
  check("静止中のタップで「か」", t.includes("か"), JSON.stringify(t));
}

// 2. 右へ動いている間 = 左フリック
{
  await clearEditor();
  for (let i = 0; i < 200 && (await translate()).x < 3; i++) await page.waitForTimeout(50);
  const c = await center();
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const t = await editorText();
  check("右へ動く間の押下 = 左フリックの文字", LEFT.has([...t].at(-1)), JSON.stringify(t));
}

// 3. 下へ動いている間 = 上フリック（右の動きが終わって X が 0 に戻ったあと、Y が動き出す）
{
  await clearEditor();
  for (let i = 0; i < 400 && (await translate()).y < 3; i++) await page.waitForTimeout(50);
  const c = await center();
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const t = await editorText();
  check("下へ動く間の押下 = 上フリックの文字", UP.has([...t].at(-1)), JSON.stringify(t));
}

await browser.close();
process.exit(failed ? 1 : 0);
