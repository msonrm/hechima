/* /qr/ —— へちまエディタの QR を集めて本文に戻す。
 *
 * ★**集める画面が本体**。復元そのものは `src/qr/format.ts` の 20 行で終わっていて
 *   （検査は `scripts/check-qr.mjs` が出す側の実物で往復させている）、
 *   ここでやるのは「いま何枚目まで来たか」を人に見せることだけ。
 * ★読み取りは **jsQR**（npm・Apache-2.0）。`BarcodeDetector` は Android Chrome だと
 *   速いが **iOS Safari に無い**ので、まずは 1 本で通す。
 */
import jsQR from "jsqr";

import { Collector, pagesFromUrl } from "../qr/format";

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
/* ★★**撮れているフレーム数**（2026-09-15）—— 機体の間隔は「1 枚あたり何フレーム
 *   撮れるか」で決めているのに、**その fps を測っていなかった**（30fps と仮定していた）。
 *   ★溜めているあいだは jsQR を呼ばないので、デコード回数のメーターでは見えない。 */
let grabs = 0;
let grabT0 = 0;
let fps = 0;
/* ★★**読めた QR が枠の何割を占めていたか**（2026-09-15）—— iPad の方が遅い理由を
 *   絞るため。★端末が大きいと機体に近づけにくく、**小さく写っている**かもしれない。
 *   jsQR は 4 隅の座標を返すので、そのまま測れる。 */
let qrFill = 0;
let decMs = 0;
/* ★**1 枚目が入ってから揃うまで**の時間。機体側の型番と間隔を比べるための唯一の数
   —— 「速くなった気がする」では、粗い型番（枚数は増えるが 1 枚が読みやすい）と
   密な型番（枚数は少ないが読みにくい）のどちらが良いか決められない。 */
let firstAt = 0;

/* ★★**溜めてから、まとめて読む**（2026-09-15・本人の案）—— デコードは 1 回 60ms
 *   かかるので、**その間に来たフレームを取りこぼす**。機体の切り替えが速いほど損が大きい。
 * ★★**総枚数が分かっていれば、撮る側は「1 周ぶん撮る」だけでよく、どのフレームが
 *   何枚目かは*あとで*分かればいい。** 総枚数は機体が段 1 の URL に `?n=5` として
 *   載せてくるので、**1 枚もデコードしないうちに**分かる。
 * ★異同判定（24×24 に落として比べる）は 1ms なので、溜める間はほぼカメラ任せで回る。
 * ★足りなければ次の周回でまた溜める（枚は順不同で受けるので、何周かかっても構わない）。 */
/* ★★★**溜めるのはグレースケール**（1 バイト/画素 ＝ 518KB）。
 *   RGBA のまま持つと 1 枚 2MB で、**1 周ぶん撮ると 100MB を超える**。
 * ★★**上限 24 では足りなかった**（2026-09-15・実機 17 枚で 15〜20 秒）——
 *   30fps で 24 フレームは **0.8 秒**しかなく、機体の 1 周（17 枚 × 0.1 ＝ 1.7 秒）の
 *   半分しか見ていなかった。**「最後の数枚が埋まらない」の正体**がこれ。
 *   ★**1 巡で全枚が視界に入る**だけ溜める（64 フレーム ＝ 2.1 秒 ＝ 33MB）。 */
const BANK_MAX = 64;
let need = 0;                     /* 総枚数（0 = まだ分からない ＝ 従来どおり 1 枚ずつ読む） */
let roundMs = 0;                  /* 機体の 1 周（ミリ秒）。0 = 分からない */
let bank: Uint8Array[] = [];
let bankT0 = 0;
let lastGrabAt = 0;
let draining = false;
/* jsQR へ渡すときだけ RGBA に展開する。★1 枚ぶんを使い回す（毎回確保しない） */
const rgbaBuf = new Uint8ClampedArray(SCAN_SIDE * SCAN_SIDE * 4).fill(255);


function say(msg: string): void {
  statusEl.textContent = msg;
}

/* ★**1 枚あたり何フレーム撮れているか**を出す —— 機体の間隔はこの数から決める。
   `?ms=` で間隔を教わっているので、そのまま割り算できる。 */
function showMeter(): void {
  if (!fps) {
    meterEl.textContent = "";
    return;
  }
  const perSheet = roundMs ? (fps * roundMs) / 1000 : 0;
  let t = `カメラ ${fps} 枚/秒`;
  if (perSheet) t += ` ／ QR 1 枚あたり ${perSheet.toFixed(1)} 枚`;
  /* ★★**枠に対する QR の大きさ**が、読めるかどうかをいちばん左右する
     （v30 は 1 模様 3.5px しかないので、小さく写ると一気に落ちる）。 */
  if (qrFill) t += ` ／ QR は枠の ${qrFill}%`;
  if (decMs) t += `・1 回 ${decMs}ms`;
  /* ★★**遅いときは理由を言う** —— 「なぜか読めない」で終わらせない。
     カメラは暗いと露光を延ばすので fps が落ち、1 枚あたりのフレーム数が足りなくなる。 */
  if (perSheet && perSheet < 2) t += "　★暗いかもしれません（明るい所だと速くなります）";
  else if (fps < 20) t += "　★カメラが遅めです";
  meterEl.textContent = t;
  void scans;
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
  const before = col.pages;
  const r = col.add(bytes);
  /* ★★段 1（読み取りページの URL）—— **本文ではない**ので Collector が弾いて返す。
     ★弾くだけでなく**次に何を押すかを言う**（その QR を撮った人は、たいてい
     「読んだのに何も起きない」と思っている）。★ついでに `?n=` を拾う。 */
  if (r.kind === "url") {
    if (r.pages && !need) need = r.pages;
    if (col.empty)
      say(
        r.pages
          ? `全部で ${r.pages} 枚あります。機体で → を押すと本文の QR に変わります。`
          : "読み取り先の QR です。機体で → を押すと本文の QR に変わります。",
      );
    return;
  }
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
  if (col.pages > 1) need = col.pages;   /* ★ヘッダの方が確か（`?n=` は古いことがある） */
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

/** ImageData から輝度だけを取り出す（溜めるため）。 */
function toGray(img: ImageData): Uint8Array {
  const d = img.data;
  const g = new Uint8Array(SCAN_SIDE * SCAN_SIDE);
  for (let i = 0, o = 0; i < g.length; i++, o += 4)
    g[i] = (d[o] * 77 + d[o + 1] * 150 + d[o + 2] * 29) >> 8;
  return g;
}

/* 1 枚デコードして Collector に渡す。★`binaryData` を使う（`data` は文字列で、
   圧縮した中身は文字にならない）。 */
function decodeGray(g: Uint8Array): void {
  for (let i = 0, o = 0; i < g.length; i++, o += 4)
    rgbaBuf[o] = rgbaBuf[o + 1] = rgbaBuf[o + 2] = g[i];
  const t0 = performance.now();
  const got = jsQR(rgbaBuf, SCAN_SIDE, SCAN_SIDE, { inversionAttempts: "dontInvert" });
  decMs = Math.round(performance.now() - t0);
  if (got?.location) {
    const { topLeftCorner: tl, topRightCorner: tr } = got.location;
    qrFill = Math.round((Math.hypot(tr.x - tl.x, tr.y - tl.y) / SCAN_SIDE) * 100);
    showMeter();
  }
  if (got && got.binaryData && got.binaryData.length) handle(Uint8Array.from(got.binaryData));
  scans++;
  void scanT0;
}

/* 溜めたぶんを読み切ったか。★**1 フレームに 1 枚だけ**読む —— まとめて回すと
   その間プレビューが固まり、撮っている人は「止まった」と思う。 */
function drainStep(): void {
  const g = bank.shift();
  if (g) decodeGray(g);
  if (!bank.length) {
    draining = false;
    lastTiny = null;                     /* ★次の周回は「前の絵」を持たずに始める */
    bankT0 = performance.now();
    lastGrabAt = 0;
    if (!done) say(col.empty ? "QR を枠に収めてください。" : `あと ${col.missing.length} 枚。`);
  } else {
    say(`読み取り中… 残り ${bank.length}`);
  }
}

function scan(): void {
  raf = requestAnimationFrame(scan);
  if (done || video.readyState < video.HAVE_CURRENT_DATA || !ctx) return;
  if (draining) {
    drainStep();
    return;
  }
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return;
  /* ★**中央の正方形を、決まった大きさに落として見る**（画面のガイド枠と同じ範囲）。
     カメラが何 px を返そうと、デコードにかかる時間が一定になる。 */
  const side = Math.min(w, h);
  ctx.drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SCAN_SIDE, SCAN_SIDE);
  /* ★★**撮れた数はここで数える**（同じ絵を弾く前）—— カメラが何 fps で回っているかは、
     弾いたあとの数では分からない。 */
  grabs++;
  const tNow = performance.now();
  if (tNow - grabT0 >= 1000) {
    fps = Math.round((grabs * 1000) / (tNow - grabT0));
    grabs = 0;
    grabT0 = tNow;
    showMeter();
  }
  if (sameAsLast()) return;              /* ★動いていない ＝ 撮る意味がない（1ms） */

  if (!need) {                           /* 総枚数が分からない ＝ 1 枚ずつ読む（従来） */
    decodeGray(toGray(ctx.getImageData(0, 0, SCAN_SIDE, SCAN_SIDE)));
    return;
  }

  /* ★★★**同じ枚を何枚も溜めない**（2026-09-15・iPad で 30fps 出ても速くならなかった）——
     6 枚を 1 周ぶん（0.72 秒）撮ると 30fps では **22 フレーム**溜まるが、そこに写っている
     *違う枚* はせいぜい 7 枚。**15 フレームは同じ枚の撮り直し**で、それを全部デコード
     していた（22 × 86ms ＝ 1.9 秒 ＝ 1 巡の 73%）。
     ★★**律速は fps ではなくデコードだった** —— だから fps を上げても変わらなかった。

     ★★★**残りが少なくなったら間引きをやめる**（本人の案・実機の指摘
     *「最後の 2 枚あるいは 1 枚で大幅に時間を食う」* から）——
     これは**クーポンコレクターの裾**で説明がつく: 各枚を 2 回撮って両方読めない確率は
     (1-p)²、6 枚ならそれが 1〜2 枚残り、次の巡でも同じ割合が残る。
     ★★**間引きは「多くの枚を集める」ための節約で、「特定の 1 枚を捕まえる」には邪魔**
     —— いちばん機会が要るときに機会を捨てていた。残り 2 枚以下なら**全フレーム総当たり**
     （そのときデコードの総量は知れている）。

     ★**周期の噛み合わせ（ビート）も疑ったが、模擬では否定された** —— カメラの fps は
     正確な整数比にならない（29.97 だったり可変だったり）ので、位相は少しずつずれる。
     ★ランダムに揺らす案も**効かない**（カメラの刻みに量子化されるので、35〜65ms は
     どれも「2 フレームに 1 回」になる）。**効かないと分かったものは入れない。** */
  const few = !col.empty && col.missing.length <= 2;
  const minGap = few ? 0 : (roundMs || 100) / 2;
  if (tNow - lastGrabAt < minGap) return;
  lastGrabAt = tNow;
  bank.push(toGray(ctx.getImageData(0, 0, SCAN_SIDE, SCAN_SIDE)));
  /* ★★★**やめどきは「機体が 1 周するまで」**（2026-09-15 に直した）——
     それまでは「要る枚数の 2 倍」で切っていて、17 枚のとき **0.8 秒＝ 1 周の半分**しか
     見ていなかった。★機体が `&ms=` で間隔を教えてくるので、**1 周 ＋ 2 割**撮る。
     ★間隔が分からないときだけ、枚数から見当をつける（0.1 秒とみなす）。 */
  const want = Math.max(1, col.empty ? need : col.missing.length);
  const oneRound = (roundMs || 100) * need * 1.2;
  if (bank.length >= BANK_MAX || tNow - bankT0 > Math.min(4000, oneRound)) {
    draining = true;
    say(`読み取り中… 残り ${bank.length}`);
  }
  void want;
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
        /* ★★★**カメラは高い方を貰う**（2026-09-15 に戻した）—— 一度
           「見るのは 720×720 だから 1280×720 で足りる」と落としたが、**それは別物**:
             1280×720 で撮る … 中央の正方形が **720×720（等倍）** ＝ v30 の 1 模様 3.5px
             1920×1080 で撮る … 中央 1080×1080 を **720 に縮小** ＝ 元の情報が 1.5 倍あり、
                                 縮小で平滑化されるぶん二値化が効く
           ★**「見る解像度」は 720 で足りても、「カメラの解像度」は高い方がいい。**
           ★私の測定は理想画像（すでに二値）だったので、この差が出なかった。 */
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        /* ★★★**暗いと fps が落ちる**（2026-09-15・実機で 9〜14 枚/秒しか出なかった）——
           カメラは暗いと露光を延ばすので、フレームレートが下がる。機体の切り替え間隔は
           「1 枚あたり何フレーム撮れるか」で決めているので、ここが半分になると
           **設計ごとずれる**。★`ideal` で要求しておく（強制はしない ―― `min` にすると
           満たせない端末でカメラが開かなくなる）。 */
        frameRate: { ideal: 30 },
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
  bank = [];
  draining = false;
  scans = 0;
  scanT0 = performance.now();
  grabs = 0;
  grabT0 = performance.now();
  fps = 0;
  qrFill = 0;
  decMs = 0;
  bankT0 = performance.now();
  lastGrabAt = 0;
  startBtn.hidden = true;
  stopBtn.hidden = false;
  say(col.empty ? "QR を枠に収めてください。" : `あと ${col.missing.length} 枚。`);
  scan();
}

function again(): void {
  col.reset();
  firstAt = 0;
  bank = [];
  draining = false;
  done = false;
  resultEl.hidden = true;
  againBtn.hidden = true;
  textEl.value = "";
  drawSheets();
  void start();
}

/* ★★機体の段 1 の QR は `…/qr/?n=5` —— **それを読んでこのページが開く**ので、
   総枚数が最初から手元にある（ブックマークから開いた人には無いが、そのときは従来どおり）。 */
{
  const n = pagesFromUrl(location.search);
  const ms = Number(new URLSearchParams(location.search).get("ms"));
  if (Number.isInteger(ms) && ms > 0 && ms <= 2000) roundMs = ms;
  if (n) {
    need = n;
    say(`全部で ${n} 枚あります。カメラを使うと読み取りが始まります。`);
  }
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
