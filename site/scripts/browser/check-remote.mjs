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
// mozc の読み込みを待つ（受け手）。★時間で待たない —— 本番は辞書（gz で 12.8MB）を回線から取るので、
// 0.5 秒待つだけだと**読み込みが間に合った回だけ通る**（デプロイ直後の本番で 2 回に 1 回落ちた）
const engineReady = async () =>
  check("受け手: 変換エンジンの準備完了", /準備完了/.test(await waitText(host, "#status", /準備完了/, 60000)),
    await host.$eval("#status", (e) => e.textContent ?? "").catch(() => ""));
await engineReady();
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
await engineReady(); // 読み込み直したので辞書から取り直している
await tap("さ"); await host.waitForTimeout(400);
check("受け手の再接続後も入る", (await editor()).includes("さ"), JSON.stringify(await editor()));
// 5) 配列図（理想的な物理キーボード）: 薙刀式。押した・離したを送り、受け手の配列エンジンが解く
await kb.selectOption(".kb-mode", "naginata");
await kb.selectOption(".kb-profile", "jis");
check("受け手が薙刀式を読む", /薙刀式/.test(await waitText(host, ".remote-status", /薙刀式/)));
await host.$eval("#editor", (e) => { e.textContent = ""; });
// 盤面の座標系（u）からキーの中心を画面の座標へ。指ごとに pointerId を分けて多指を再現する
const keyPoint = (code) => kb.evaluate((code) => {
  const svg = document.querySelector(".kb-area svg");
  const p = ReplayEngine.findProfile(document.querySelector(".kb-profile").value);
  const k = p.keys.find((k) => k.code === code);
  const r = svg.getBoundingClientRect(); const vb = svg.viewBox.baseVal; const u = vb.width / p.width;
  return { x: r.left + ((k.x + k.w / 2) * u - vb.x) * r.width / vb.width, y: r.top + ((k.y + k.h / 2) * u - vb.y) * r.height / vb.height };
}, code);
const finger = async (type, code, id) => {
  const pt = await keyPoint(code);
  await kb.evaluate(({ type, pt, id }) => {
    document.querySelector(".kb-area").dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: pt.x, clientY: pt.y, bubbles: true, isPrimary: id === 1 }));
  }, { type, pt, id });
  await kb.waitForTimeout(60);
};
const press = async (code) => { await finger("pointerdown", code, 1); await finger("pointerup", code, 1); };
await press("KeyJ"); await press("KeyK");
await host.waitForTimeout(300);
check("薙刀式: J K → あい", (await editor()).includes("あい"), JSON.stringify(await editor()));
// 親指（スペース）を押したまま J = の（センターシフト）
await finger("pointerdown", "Space", 1); await finger("pointerdown", "KeyJ", 2);
await finger("pointerup", "KeyJ", 2); await finger("pointerup", "Space", 1);
await host.waitForTimeout(300);
check("薙刀式: スペース押しながら J → の（多指）", (await editor()).includes("あいの"), JSON.stringify(await editor()));
// F と J の同時押し = が
await finger("pointerdown", "KeyF", 1); await finger("pointerdown", "KeyJ", 2);
await finger("pointerup", "KeyJ", 2); await finger("pointerup", "KeyF", 1);
await host.waitForTimeout(300);
check("薙刀式: F+J 同時押し → が", (await editor()).includes("あいのが"), JSON.stringify(await editor()));
// スペース単打 = 変換、Enter = 確定
await press("Space"); await host.waitForTimeout(1500);
// 配列図の候補は物理キーボードと同じポップアップに出る（帯ではない）
const popupShown = await host.evaluate(() => {
  const pop = document.getElementById("candidates");
  return { bar: document.querySelectorAll(".flick-cands .fcand").length, popup: !!pop && !pop.hidden && !!pop.textContent };
});
check("薙刀式: スペース単打で変換、候補はポップアップに（帯ではない）", popupShown.popup && popupShown.bar === 0, JSON.stringify(popupShown));
await press("Enter"); await host.waitForTimeout(300);
const nagDoc = await editor();
check("薙刀式: Enter で確定（よみのままではない）", nagDoc.length > 0 && !nagDoc.includes("あいのが"), JSON.stringify(nagDoc));

// 連打がダブルタップの拡大に化けない（iPad の実機で BS 連打 → 拡大 → 戻せない、を踏んだ）。
// 拡大そのものは headless では起きないので、盤面が touchend の既定動作を止めているかを見る
const zoomBlocked = await kb.evaluate(() => {
  if (typeof TouchEvent === "undefined") return null;
  const ev = new TouchEvent("touchend", { cancelable: true, bubbles: true });
  return !document.querySelector(".kb-area svg").dispatchEvent(ev);
});
check("配列図: touchend の既定動作を止める（連打で拡大しない）", zoomBlocked === true, String(zoomBlocked));
const pinchable = await kb.evaluate(() => getComputedStyle(document.body).touchAction);
check("ページ全体はピンチできる（拡大されても戻せる）", pinchable === "manipulation", pinchable);

// 6) AZIK: 逐次系。待っている打鍵（k）が受け手に見えて、z で「かん」になる
await kb.selectOption(".kb-mode", "azik");
check("受け手が AZIK を読む", /AZIK/.test(await waitText(host, ".remote-status", /AZIK/)));
await host.$eval("#editor", (e) => { e.textContent = ""; });
await press("KeyK"); await host.waitForTimeout(300);
check("AZIK: k が受け手に見える（待っている打鍵）", (await editor()).includes("k"), JSON.stringify(await editor()));
await press("KeyZ"); await host.waitForTimeout(300);
check("AZIK: k z → かん", (await editor()).includes("かん"), JSON.stringify(await editor()));
await press("Escape"); await host.waitForTimeout(200);

// 7) 自由配置（キースイッチを画面に貼る自作キーボード用）: 登録 → 打つ → 読み込み直し → 調整
await kb.selectOption(".kb-mode", "naginata");
check("受け手が薙刀式を読む（自由配置の前）", /薙刀式/.test(await waitText(host, ".remote-status", /薙刀式/)));
await kb.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("lll-remote-free:")) localStorage.removeItem(k); });
await kb.click(".kb-free");
await kb.waitForSelector(".fx-layer");
const freeMode = () => kb.evaluate(() => document.body.dataset.free ?? "");
check("自由配置: 配置が無ければ登録から始まる", (await freeMode()) === "register", await freeMode());
const firstAsk = await kb.$eval(".kb-tools", (e) => e.textContent ?? "");
check("自由配置: 左上の文字キーから促す（薙刀式は Q）", /文字キー 1 \/ 30.*Q/.test(firstAsk), firstAsk);
const at = async (type, pt, id = 1, sel = ".fx-layer") => {
  await kb.evaluate(({ type, pt, id, sel }) => {
    document.querySelector(sel).dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: pt.x, clientY: pt.y, bubbles: true, cancelable: true, isPrimary: id === 1 }));
  }, { type, pt, id, sel });
  await kb.waitForTimeout(40);
};
const touch = async (pt, id = 1) => { await at("pointerdown", pt, id); await at("pointerup", pt, id); };
const pos = new Map();
const grid = (i) => ({ x: 60 + (i % 11) * 85, y: 230 + Math.floor(i / 11) * 85 });
let gi = 0;
while (/文字キー/.test(await kb.$eval(".kb-tools", (e) => e.textContent ?? ""))) {
  const pt = grid(gi++);
  const before = await kb.$$eval(".fx-key", (els) => els.map((e) => e.dataset.code));
  await touch(pt);
  const after = await kb.$$eval(".fx-key", (els) => els.map((e) => e.dataset.code));
  const added = after.find((c) => !before.includes(c));
  if (!added) { check(`自由配置: ${gi} 手目が置ける`, false); break; }
  pos.set(added, pt);
  if (gi === 1) {
    // 置いたキーの上をもう一度押しても、次のキーにはならない
    await touch(pt);
    const n = await kb.$$eval(".fx-key", (els) => els.length);
    const msg = await kb.$eval(".kb-tools", (e) => e.textContent ?? "");
    check("自由配置: 置いたキーに重ねて登録しない", n === 1 && /そこには/.test(msg), `${n} ${msg}`);
  }
}
check("自由配置: 文字キー 30 個を登録", pos.size === 30, String(pos.size));
const funcAsk = await kb.$eval(".kb-tools", (e) => e.textContent ?? "");
check("自由配置: 続いて機能キー（親指の役 = 空白）", /機能キー 1 \/.*空白/.test(funcAsk), funcAsk);
for (const code of ["Space", "Backspace", "Enter"]) { const pt = grid(gi++); await touch(pt); pos.set(code, pt); }
await kb.click(".kb-tools button.is-primary"); // ここで終える
check("自由配置: ここで終えると打てる", (await freeMode()) === "type", await freeMode());
check("自由配置: 登録した順と位置（J は J の位置）", (await kb.$eval(".fx-key[data-code='KeyJ'] .fx-main", (e) => e.textContent)) === "あ");
await host.$eval("#editor", (e) => { e.textContent = ""; });
const free = async (type, code, id = 1, pt = pos.get(code)) => at(type, pt, id);
const freePress = async (code) => { await free("pointerdown", code); await free("pointerup", code); };
await free("pointerdown", "KeyJ");
const fx = await kb.evaluate(() => ({ on: !!document.querySelector(".fx-key.is-on[data-code='KeyJ']"), ripple: document.querySelectorAll(".fx-key[data-code='KeyJ'] .fx-ripple").length }));
check("自由配置: 押すとキーの色が変わり、波紋が出る", fx.on && fx.ripple > 0, JSON.stringify(fx));
await free("pointerup", "KeyJ");
await freePress("KeyK"); await host.waitForTimeout(300);
check("自由配置: J K → あい", (await editor()).includes("あい"), JSON.stringify(await editor()));
await free("pointerdown", "Space", 1); await free("pointerdown", "KeyJ", 2);
await free("pointerup", "KeyJ", 2); await free("pointerup", "Space", 1);
await host.waitForTimeout(300);
check("自由配置: 空白を押しながら J → の（多指）", (await editor()).includes("あいの"), JSON.stringify(await editor()));
// キーとキーのあいだ（どちらからも遠い点）は何も送らない
await touch({ x: 1000, y: 740 }); await host.waitForTimeout(200);
check("自由配置: キーから遠い点は打たない", (await editor()) === "あいの", JSON.stringify(await editor()));
const freeZoom = await kb.evaluate(() => !document.querySelector(".fx-layer").dispatchEvent(new TouchEvent("touchend", { cancelable: true, bubbles: true })));
check("自由配置: touchend の既定動作を止める（連打で拡大しない）", freeZoom === true);
// 読み込み直しても配置は残る
await kb.reload();
check("自由配置: 読み込み直した送り手が再びつながる", /つながりました/.test(await waitText(kb, ".kb-status", /つながりました/)));
await kb.waitForSelector(".fx-key");
check("自由配置: 読み込み直しても配置が残る", (await freeMode()) === "type" && (await kb.$$eval(".fx-key", (els) => els.length)) === 33);
// 調整: ドラッグで動かす
await kb.click(".kb-tools button"); // 調整
check("自由配置: 調整に入る（揺れて − が付く）", (await kb.$eval(".fx-layer", (e) => e.dataset.mode)) === "edit"
  && (await kb.$eval(".fx-key .fx-del", (e) => getComputedStyle(e).display)) === "flex");
const newJ = { x: 900, y: 640 };
await at("pointerdown", pos.get("KeyJ"));
for (let t = 1; t <= 5; t++) await at("pointermove", { x: pos.get("KeyJ").x + (newJ.x - pos.get("KeyJ").x) * t / 5, y: pos.get("KeyJ").y + (newJ.y - pos.get("KeyJ").y) * t / 5 });
await at("pointerup", newJ);
const savedJ = await kb.evaluate(() => JSON.parse(localStorage.getItem("lll-remote-free:jis")).keys.find((k) => k.code === "KeyJ"));
check("自由配置: ドラッグで動かして保存", Math.abs(savedJ.x - newJ.x) < 1 && Math.abs(savedJ.y - newJ.y) < 1, JSON.stringify(savedJ));
// 押して → 空いた場所を押す、でも動かせる（スイッチを貼り替えたあと）
const newK = { x: 800, y: 640 };
await touch(pos.get("KeyK"));
check("自由配置: 押したキーが選ばれる", !!(await kb.$(".fx-key.is-sel[data-code='KeyK']")));
await touch(newK);
check("自由配置: 空いた場所を押すとそこへ動く", (await kb.$eval(".fx-key[data-code='KeyK']", (e) => e.style.left)) === `${newK.x}px`);
// − で外す → トレイから置き直す
await at("pointerdown", pos.get("KeyL"), 1, ".fx-key[data-code='KeyL'] .fx-del");
await kb.waitForTimeout(500);
check("自由配置: − で外す", !(await kb.$(".fx-key[data-code='KeyL']")));
check("自由配置: 外したキーが「置いていないキー」に並ぶ", !!(await kb.$(".fx-chip[data-code='KeyL']")));
await kb.click(".fx-chip[data-code='KeyL']");
const newL = { x: 700, y: 640 };
await touch(newL);
check("自由配置: トレイのキーを置き直す", (await kb.$eval(".fx-key[data-code='KeyL']", (e) => e.style.left)) === `${newL.x}px`);
await kb.click(".kb-tools button.is-primary"); // 完了
check("自由配置: 完了で打つ側へ", (await freeMode()) === "type");
await host.$eval("#editor", (e) => { e.textContent = ""; });
pos.set("KeyJ", newJ); pos.set("KeyK", newK); pos.set("KeyL", newL);
await freePress("KeyJ"); await freePress("KeyK"); await freePress("KeyL"); await host.waitForTimeout(300);
check("自由配置: 動かした先で J K L → あいう", (await editor()).includes("あいう"), JSON.stringify(await editor()));
await freePress("Escape").catch(() => {});
await kb.click(".kb-free"); // 図に戻す
check("自由配置を切ると配列図に戻る", !!(await kb.$(".kb-area svg")) && !(await kb.$(".fx-layer")));

await browser.close();
console.log(failed ? `${failed} 件失敗` : "すべて ok");
process.exit(failed ? 1 : 0);
