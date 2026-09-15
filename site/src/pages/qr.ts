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
const copyBtn = document.getElementById("qr-copy") as HTMLButtonElement;
const saveBtn = document.getElementById("qr-save") as HTMLButtonElement;

const col = new Collector();
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
let stream: MediaStream | null = null;
let raf = 0;
let done = false;

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
    countEl.textContent = `${[...text].length} 字`;
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

function scan(): void {
  raf = requestAnimationFrame(scan);
  if (done || video.readyState < video.HAVE_CURRENT_DATA || !ctx) return;
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return;
  /* ★**中央の正方形だけを見る** —— 画面のガイド枠と同じ範囲。縮小はしない
     （模様が潰れると、いちばん密な v30 から先に読めなくなる）。 */
  const side = Math.min(w, h);
  if (canvas.width !== side) {
    canvas.width = side;
    canvas.height = side;
  }
  ctx.drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, side, side);
  const img = ctx.getImageData(0, 0, side, side);
  const got = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
  /* ★**binaryData を使う**（`data` は文字列で、圧縮した中身は文字にならない）。 */
  if (got && got.binaryData && got.binaryData.length) handle(Uint8Array.from(got.binaryData));
}

function stop(): void {
  cancelAnimationFrame(raf);
  raf = 0;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  startBtn.hidden = done;
  stopBtn.hidden = true;
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
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
  } catch (e) {
    say(`カメラを開けませんでした —— ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  video.srcObject = stream;
  await video.play();
  startBtn.hidden = true;
  stopBtn.hidden = false;
  say(col.empty ? "QR を枠に収めてください。" : `あと ${col.missing.length} 枚。`);
  scan();
}

function again(): void {
  col.reset();
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
