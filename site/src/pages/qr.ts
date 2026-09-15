/* /qr/ —— へちまエディタの QR を集めて本文に戻す。
 *
 * ★**集める画面が本体**。復元そのものは `src/qr/format.ts` の 20 行で終わっていて
 *   （検査は `scripts/check-qr.mjs` が出す側の実物で往復させている）、
 *   ここでやるのは「いま何枚目まで来たか」を人に見せることだけ。
 * ★読み取りは **jsQR**（npm・Apache-2.0）。`BarcodeDetector` は Android Chrome だと
 *   速いが **iOS Safari に無い**ので、まずは 1 本で通す。
 */
import jsQR from "jsqr";

import { Collector } from "../qr/format";

const video = document.getElementById("qr-video") as HTMLVideoElement;
const statusEl = document.getElementById("qr-status") as HTMLParagraphElement;
const sheetsEl = document.getElementById("qr-sheets") as HTMLOListElement;
const startBtn = document.getElementById("qr-start") as HTMLButtonElement;
const stopBtn = document.getElementById("qr-stop") as HTMLButtonElement;
const againBtn = document.getElementById("qr-again") as HTMLButtonElement;
const resultEl = document.getElementById("qr-result") as HTMLElement;
const textEl = document.getElementById("qr-text") as HTMLTextAreaElement;
const countEl = document.getElementById("qr-count") as HTMLElement;
const meterEl = document.getElementById("qr-meter") as HTMLElement;
const copyBtn = document.getElementById("qr-copy") as HTMLButtonElement;
const saveBtn = document.getElementById("qr-save") as HTMLButtonElement;

/* ★★**見る大きさ**（2026-09-15・実測して決めた）—— いちばん密な v30（137 模様）を
 *   理想的な画像で読ませたときの jsQR の速さと、読めるかどうか:
 *
 *     1080px … 1 模様 7.4px … 158ms …  6 回/秒 … 読める
 *      720px … 1 模様 5.0px …  88ms … 11 回/秒 … 読める  ← ここ
 *      480px … 1 模様 3.3px …  66ms … 15 回/秒 … 読める
 *      360px … 1 模様 2.5px …  53ms … 19 回/秒 … ★**読めない**
 *
 * ★**1080 で見るのは無駄**（速さが半分になるだけで、読めるものは変わらない）。
 * ★**2.5px で読めなくなる**ので、下げすぎの境界も分かった ―― カメラは傾きも
 *   ブレも照明ムラもあるので、実測の限界 3.3px ではなく **5px 側に寄せる**。
 * ★`BarcodeDetector`（Android ネイティブ）は**使えない** —— `rawValue` が文字列しか
 *   返さないので、**圧縮した payload（バイナリ）が取り出せない**。
 *   バイト列を返すのは zxing-wasm の方だが、それは 1MB 超の wasm を積む話になる。 */
const SCAN_SIDE = 720;

const col = new Collector();
const canvas = document.createElement("canvas");
canvas.width = canvas.height = SCAN_SIDE;
const ctx = canvas.getContext("2d", { willReadFrequently: true });
/* 直前のフレームの粗い縮小（★同じ絵をもう一度デコードしないため） */
const tiny = document.createElement("canvas");
tiny.width = tiny.height = 24;
const tctx = tiny.getContext("2d", { willReadFrequently: true });
let lastTiny: Uint8ClampedArray | null = null;
let stream: MediaStream | null = null;
let raf = 0;
let done = false;
let wake: WakeLockSentinel | null = null;
let scans = 0;
let scanT0 = 0;
/* ★**1 枚目が入ってから揃うまで**の時間。機体側の型番と間隔を比べるための唯一の数
   —— 「速くなった気がする」では、粗い型番（枚数は増えるが 1 枚が読みやすい）と
   密な型番（枚数は少ないが読みにくい）のどちらが良いか決められない。 */
let firstAt = 0;

/* ★★出す側は**このページの URL を先に出す**（機体のメニュー → QRコード の 1 枚目）ので、
   集めている最中に必ず視界へ入る。本文として受けると「https://…/qr/」が本文になってしまう。
   ★弾くだけでなく**次に何を押すかを言う** —— その QR を撮った人は、たいてい
   「読んだのに何も起きない」と思っている。 */
const SELF_URL = /^https?:\/\/[^\s]+\/qr\/?$/;

function isSelfUrl(bytes: Uint8Array): boolean {
  if (bytes.length > 120) return false;
  try {
    return SELF_URL.test(new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim());
  } catch {
    return false; /* UTF-8 でない ＝ 圧縮された枚 */
  }
}

function say(msg: string): void {
  statusEl.textContent = msg;
}

/** 集まった枚をマス目で出す。★「あと何枚」が一目で分かることが、この画面の仕事。 */
function drawSheets(): void {
  const n = col.pages;
  sheetsEl.innerHTML = "";
  if (!n) return;
  const have = new Set(col.have);
  for (let i = 1; i <= n; i++) {
    const li = document.createElement("li");
    li.textContent = String(i);
    li.className = have.has(i) ? "got" : "yet";
    sheetsEl.append(li);
  }
}

/** ★新しい枚が入ったら**震わせる** —— 撮っている人は、この画面ではなく機体を見ている。 */
function buzz(ms: number): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* 未対応 */
  }
}

async function finish(): Promise<void> {
  done = true;
  stop();
  try {
    const text = await col.restore();
    textEl.value = text;
    const secs = firstAt ? (performance.now() - firstAt) / 1000 : 0;
    countEl.textContent =
      `${[...text].length} 字` + (col.pages > 1 ? ` ／ ${col.pages} 枚を ${secs.toFixed(1)} 秒で` : "");
    resultEl.hidden = false;
    say("そろいました。");
    buzz(120);
    resultEl.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    say(`戻せませんでした —— ${e instanceof Error ? e.message : String(e)}`);
  }
  againBtn.hidden = false;
}

function handle(bytes: Uint8Array): void {
  if (isSelfUrl(bytes)) {
    if (col.empty) say("読み取り先の QR です。機体で → を押すと本文の QR に変わります。");
    return;
  }
  const before = col.pages;
  const r = col.add(bytes);
  if (r.kind === "other") {
    say("別の文書の QR のようです。集め直すなら「集め直す」を押してください。");
    return;
  }
  if (r.kind === "dup") {
    say(`${r.seq} 枚目はもう読んでいます（あと ${col.missing.length} 枚）。`);
    return;
  }
  buzz(30);
  if (!firstAt) firstAt = performance.now();
  drawSheets();
  if (col.ready) {
    void finish();
    return;
  }
  if (r.kind === "new") {
    const first = before === 0 ? `全部で ${col.pages} 枚あります。` : "";
    say(`${first}${r.seq} 枚目が入りました（あと ${col.missing.length} 枚）。`);
  }
}

/* ★機体は 1 枚を何百ミリ秒も出しっぱなしにするので、**同じ絵を何度もデコードする**。
   24×24 に落として見比べ、動いていなければ丸ごと飛ばす（1ms ＋ 節約 88ms）。
   ★閾値は低め —— **切り替わりを見逃すほうが、無駄に 1 回デコードするより高くつく**。
   手ブレでも差が出るが、そのときは普通にデコードするだけで害はない。 */
function sameAsLast(): boolean {
  if (!tctx) return false;
  tctx.drawImage(canvas, 0, 0, tiny.width, tiny.height);
  const now = tctx.getImageData(0, 0, tiny.width, tiny.height).data;
  const prev = lastTiny;
  lastTiny = new Uint8ClampedArray(now);
  if (!prev) return false;
  let diff = 0;
  for (let i = 0; i < now.length; i += 4) diff += Math.abs(now[i] - prev[i]);
  return diff / (now.length / 4) < 2;   /* 平均 2/255 未満なら「動いていない」 */
}

function scan(): void {
  raf = requestAnimationFrame(scan);
  if (done || video.readyState < video.HAVE_CURRENT_DATA || !ctx) return;
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return;
  /* ★**中央の正方形を、決まった大きさに落として見る**（画面のガイド枠と同じ範囲）。
     カメラが何 px を返そうと、デコードにかかる時間が一定になる。 */
  const side = Math.min(w, h);
  ctx.drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SCAN_SIDE, SCAN_SIDE);
  if (sameAsLast()) return;
  const img = ctx.getImageData(0, 0, SCAN_SIDE, SCAN_SIDE);
  const got = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
  /* ★**binaryData を使う**（`data` は文字列で、圧縮した中身は文字にならない）。 */
  if (got && got.binaryData && got.binaryData.length) handle(Uint8Array.from(got.binaryData));
  /* ★**速さを画面に出す** —— 「遅い」を数字にしないと、機体側の間隔を決められない。 */
  scans++;
  const now = performance.now();
  if (now - scanT0 >= 1000) {
    meterEl.textContent = `${Math.round((scans * 1000) / (now - scanT0))} 回/秒`;
    scans = 0;
    scanT0 = now;
  }
}

function stop(): void {
  cancelAnimationFrame(raf);
  raf = 0;
  meterEl.textContent = "";
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  void wake?.release();
  wake = null;
  startBtn.hidden = done;
  stopBtn.hidden = true;
}

/* ★機体が 1 秒ごとに送ってくるので、**待っている時間が長い** ——
   その間に画面が消えると読み取りが止まる。使えない環境では黙って諦める。 */
async function keepAwake(): Promise<void> {
  try {
    wake = (await navigator.wakeLock?.request("screen")) ?? null;
  } catch {
    wake = null;
  }
}

async function start(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    say("このブラウザではカメラが使えません（https でない場合も、ここに来ます）。");
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        /* ★見るのは 720×720 なので、これ以上貰っても捨てるだけ（帯域と電池の無駄）。 */
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
  } catch (e) {
    say(`カメラを開けませんでした —— ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  video.srcObject = stream;
  await video.play();
  void keepAwake();
  lastTiny = null;
  scans = 0;
  scanT0 = performance.now();
  startBtn.hidden = true;
  stopBtn.hidden = false;
  say(col.empty ? "QR を枠に収めてください。" : `あと ${col.missing.length} 枚。`);
  scan();
}

function again(): void {
  col.reset();
  firstAt = 0;
  done = false;
  resultEl.hidden = true;
  againBtn.hidden = true;
  textEl.value = "";
  drawSheets();
  void start();
}

startBtn.addEventListener("click", () => void start());
stopBtn.addEventListener("click", () => {
  stop();
  say("止めました。");
});
againBtn.addEventListener("click", again);

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(textEl.value);
    say("コピーしました。");
  } catch {
    /* ★権限が下りないことがあるので、選択して自分で押せる形に落とす */
    textEl.select();
    say("コピーできませんでした。選択してあるので、そのままコピーしてください。");
  }
});

saveBtn.addEventListener("click", () => {
  const blob = new Blob([textEl.value], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const t = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  a.download = `hechima-${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

/* ★ページを離れたらカメラを止める（点きっぱなしにしない） */
addEventListener("pagehide", stop);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop();
});
