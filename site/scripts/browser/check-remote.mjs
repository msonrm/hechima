// /remote/（別の端末をキーボードにする）を 2 ページで通す: 受け手の QR の URL を送り手で開き、
// 送り手の盤面をタップして受け手に入る・変換できる・読み込み直してもつなぎ直せる、を見る。
//
// 中継（/api/pair/<room>）が要る。本番に向けるか、workerd が動かない環境では
// relay-local.mjs（Worker の代役）を立てて向ける:
//   PW_DIR=/tmp/pw node site/scripts/browser/relay-local.mjs site/dist 8791 &
//   PW_DIR=/tmp/pw node site/scripts/browser/check-remote.mjs http://127.0.0.1:8791
// （relay-local.mjs は ws パッケージを使う。playwright-core と同じ場所に `npm i ws`）
//
// ★headless の 2 ページは同じ機械の中なので、**同じ Wi-Fi の 2 台で直結できるか**（mDNS・
//   クライアント分離）はここでは見えない。それは実機で確かめる
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";

const { chromium } = createRequire(join(process.env.PW_DIR ?? process.cwd(), "_"))("playwright-core");
const base = process.argv[2] ?? "https://luffa-lang-labo.dev";
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = join(homedir(), ".cache/ms-playwright");
  for (const dir of readdirSync(cache)) if (dir.startsWith("chromium_headless_shell")) { const p = join(cache, dir, "chrome-linux/headless_shell"); if (existsSync(p)) return p; }
}
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`); if (!ok) failed++; };
const browser = await chromium.launch({ executablePath: findChrome() });
const host = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const kb = await (await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: false })).newPage();
for (const [n, p] of [["host", host], ["kb", kb]]) { p.on("pageerror", (e) => check(`${n}: ページエラーなし`, false, e.message)); }
await host.goto(`${base}/remote/?cb=${Date.now()}`);
await host.waitForSelector(".remote-url a[href*='/remote/keyboard/#r=']");
const url = await host.$eval(".remote-url a", (a) => a.href);
check("受け手が QR と URL を出す", (await host.$(".remote-qr svg")) !== null, url);
await kb.goto(url);
const waitText = async (p, sel, re, ms = 15000) => { const t0 = Date.now(); let t = ""; while (Date.now() - t0 < ms) { t = await p.$eval(sel, (e) => e.textContent ?? "").catch(() => ""); if (re.test(t)) return t; await p.waitForTimeout(100); } return t; };
check("送り手: つながる", /つながりました/.test(await waitText(kb, ".kb-status", /つながりました/)));
check("受け手: つながる", /つながりました/.test(await waitText(host, ".remote-status", /つながりました/)));
check("受け手: つながったら QR が引っ込む", await host.$eval(".remote-pair", (e) => getComputedStyle(e).display === "none"));
// mozc の読み込みを待つ（受け手）
await host.waitForTimeout(500);
const keyBox = async (label) => {
  const h = await kb.evaluateHandle((label) => {
    const els = [...document.querySelectorAll(".fe-root *")].filter((e) => e.children.length === 0 && e.textContent === label);
    return els[0]?.closest(".fe-root > * , .fe-root *") ?? null;
  }, label);
  const el = h.asElement(); if (!el) return null; return el.boundingBox();
};
const tap = async (label) => { const b = await keyBox(label); if (!b) { check(`キー「${label}」がある`, false); return; } await kb.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await kb.mouse.down(); await kb.mouse.up(); await kb.waitForTimeout(150); };
const editor = () => host.$eval("#editor", (e) => e.textContent ?? "");
// 1) かな → 濁点 → 改行（合成中は「確定」）
await tap("た");
check("送り手: 合成中は「空白」が「変換」に変わる（受け手の状態が返る）", (await keyBox("変換")) !== null);
await tap("゛゜小");
await host.waitForTimeout(300);
const comp = await editor();
check("゛゜小 が受け手の末尾に効く（た → だ）", comp.includes("だ"), JSON.stringify(comp));
await tap("確定"); await host.waitForTimeout(300);
check("確定で本文へ", (await editor()).includes("だ"), JSON.stringify(await editor()));
check("確定後は「空白」に戻る", (await keyBox("空白")) !== null);
// 2) 変換: か な → 変換 → 確定
await tap("か"); await tap("な");
await tap("変換"); await host.waitForTimeout(1500);
const cands = await host.$$eval(".flick-cands .fcand", (els) => els.map((e) => e.textContent));
check("受け手に候補が並ぶ", cands.length > 0, JSON.stringify(cands.slice(0, 5)));
await tap("確定"); await host.waitForTimeout(300);
const doc = await editor();
check("変換して確定", /仮名|かな|カナ|家内/.test(doc.replace("だ", "")), JSON.stringify(doc));
// 3) 送り手を読み込み直しても、つなぎ直せる
await kb.reload();
check("読み込み直した送り手が再びつながる", /つながりました/.test(await waitText(kb, ".kb-status", /つながりました/)));
await tap("あ"); await host.waitForTimeout(300);
check("再接続後も入る", (await editor()).includes("あ"), JSON.stringify(await editor()));
// 4) 受け手を読み込み直しても、同じ部屋で送り手がつなぎ直す
await host.reload();
await host.waitForSelector(".remote-url a");
check("受け手は同じ部屋を覚えている", (await host.$eval(".remote-url a", (a) => a.href)) === url);
check("受け手の読み込み直し後、送り手が再びつながる", /つながりました/.test(await waitText(kb, ".kb-status", /つながりました/)));
check("受け手側も再びつながる", /つながりました/.test(await waitText(host, ".remote-status", /つながりました/)));
await host.waitForTimeout(800);
await tap("さ"); await host.waitForTimeout(400);
check("受け手の再接続後も入る", (await editor()).includes("さ"), JSON.stringify(await editor()));
await browser.close();
console.log(failed ? `${failed} 件失敗` : "すべて ok");
process.exit(failed ? 1 : 0);
