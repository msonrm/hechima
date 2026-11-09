/* /qr/ の「レシートに印字」—— 受け取った本文を 58mm 感熱プリンタへ直接送る。
 *
 * ★経路は **WebUSB** と **Web Bluetooth（BLE）** の 2 本。どちらも Chrome 系
 *   （Android / ChromeOS / PC）にしか無く、**iPhone / iPad の Safari には無い**。
 * ★送るデータの作り方は `receipt.ts`（検査あり）。ここは描画と機器の出し入れだけ。
 * ★本文は最大 9,999 字 ＝ 2m を超える長さになるので、**1 枚の canvas には描かない**
 *   （高さの上限に当たる）。塊ごとに描いて、その場で帯にして送る。
 */
import { BAND, INIT, WIDTH, bandsFromRgba, feed, normalize, wrapLines } from "./receipt";

/* ---- 機器（実機で確かめた値・receipt-printer/README.md） ---- */
const USB_VENDOR = 0x4c4a; /* Jieli */
const BLE_SVC = "49535343-fe7d-4ae5-8fa9-9fafd205e455"; /* ISSC 透過シリアル */
const BLE_RX = "49535343-8841-43f4-a8d4-ecbe34729bb3"; /* 書き込み先 */
const BLE_CHUNK = 200; /* 1 回に書くバイト数 */
const BLE_GAP = 10; /* その間隔（ms） */

/* ---- lib.dom に無い型（使う分だけ） ---- */
interface UsbEndpoint { endpointNumber: number; direction: "in" | "out"; type: string }
interface UsbInterface { interfaceNumber: number; alternates: { endpoints: UsbEndpoint[] }[] }
interface UsbDevice {
  productName?: string;
  configuration: { interfaces: UsbInterface[] } | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(n: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  transferOut(ep: number, data: BufferSource): Promise<{ status: string }>;
}
interface Usb extends EventTarget {
  requestDevice(o: { filters: { vendorId?: number; classCode?: number }[] }): Promise<UsbDevice>;
}
interface BleChar {
  writeValueWithoutResponse?(d: BufferSource): Promise<void>;
  writeValue(d: BufferSource): Promise<void>;
}
interface BleDevice extends EventTarget {
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<{ getPrimaryService(s: string): Promise<{ getCharacteristic(c: string): Promise<BleChar> }> }>;
    disconnect(): void;
  };
}
interface Ble {
  requestDevice(o: { filters: object[]; optionalServices: string[] }): Promise<BleDevice>;
}
type Nav = Navigator & {
  usb?: Usb;
  bluetooth?: Ble;
  wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> };
};
const nav = navigator as Nav;

/** つながっているプリンタ。★送り方の違い（USB は一括・BLE は細切れ）はここに閉じ込める。 */
interface Link {
  name: string;
  send(part: Uint8Array): Promise<void>;
  close(): void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function openUsb(onLost: () => void): Promise<Link> {
  const usb = nav.usb!;
  const dev = await usb.requestDevice({ filters: [{ vendorId: USB_VENDOR }, { classCode: 0x07 }] });
  await dev.open();
  if (dev.configuration === null) await dev.selectConfiguration(1);
  let iface = -1;
  let ep = -1;
  for (const itf of dev.configuration!.interfaces) {
    const out = itf.alternates[0]?.endpoints.find((e) => e.direction === "out" && e.type === "bulk");
    if (out) {
      iface = itf.interfaceNumber;
      ep = out.endpointNumber;
      break;
    }
  }
  if (ep < 0) throw new Error("印字用の出口（bulk OUT）が見つかりません");
  await dev.claimInterface(iface);
  const lost = (e: Event) => {
    if ((e as Event & { device?: unknown }).device === dev) {
      usb.removeEventListener("disconnect", lost);
      onLost();
    }
  };
  usb.addEventListener("disconnect", lost);
  return {
    name: `${dev.productName || "USB プリンタ"}（USB）`,
    async send(part) {
      const r = await dev.transferOut(ep, part as BufferSource);
      if (r.status !== "ok") throw new Error(`USB 送信 ${r.status}`);
    },
    close() {
      usb.removeEventListener("disconnect", lost);
      void dev.close().catch(() => {});
    },
  };
}

async function openBle(onLost: () => void): Promise<Link> {
  const dev = await nav.bluetooth!.requestDevice({
    filters: [{ namePrefix: "YHK" }, { services: [BLE_SVC] }],
    optionalServices: [BLE_SVC],
  });
  if (!dev.gatt) throw new Error("この機器には GATT がありません");
  const lost = () => {
    dev.removeEventListener("gattserverdisconnected", lost);
    onLost();
  };
  dev.addEventListener("gattserverdisconnected", lost);
  const server = await dev.gatt.connect();
  /* ★最初のサービス一覧が空で返ることがある（実機）ので、少し待って取り直す */
  let svc = null;
  for (let i = 0; i < 3 && !svc; i++) {
    try {
      svc = await server.getPrimaryService(BLE_SVC);
    } catch {
      await sleep(1000);
    }
  }
  if (!svc) {
    dev.gatt.disconnect();
    throw new Error("印字用のサービスが見つかりません");
  }
  const ch = await svc.getCharacteristic(BLE_RX);
  const write = ch.writeValueWithoutResponse ? ch.writeValueWithoutResponse.bind(ch) : ch.writeValue.bind(ch);
  return {
    name: `${dev.name || "Bluetooth プリンタ"}（Bluetooth）`,
    async send(part) {
      for (let i = 0; i < part.length; i += BLE_CHUNK) {
        await write(part.subarray(i, i + BLE_CHUNK) as BufferSource);
        await sleep(BLE_GAP);
      }
    },
    close() {
      dev.removeEventListener("gattserverdisconnected", lost);
      if (dev.gatt?.connected) dev.gatt.disconnect();
    },
  };
}

/* ---- 設定（この端末にだけ覚える） ---- */
interface Prefs { size: number; bold: boolean; pace: number; feed: number }
const PREFS_KEY = "lll-qr-print";
const DEFAULTS: Prefs = { size: 24, bold: false, pace: 500, feed: 4 };
function loadPrefs(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}
function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* 保存できない環境 */
  }
}

/** 本文を割り付けたもの。★描くのは塊ごと（`drawChunk`）。 */
interface Layout { font: string; size: number; lh: number; lines: string[] }

function layout(text: string, size: number, bold: boolean, family: string): Layout {
  const font = `${bold ? "bold " : ""}${size}px ${family}`;
  const m = document.createElement("canvas").getContext("2d")!;
  m.font = font;
  const t = normalize(text);
  const lines = t === "" ? [] : wrapLines(t, WIDTH, (s) => m.measureText(s).width);
  return { font, size, lh: Math.round(size * 1.35), lines };
}

/** `from` 行目から `count` 行を描いて二値にする。★プレビューも印字も同じ絵を使う。 */
function drawChunk(L: Layout, from: number, count: number, c = document.createElement("canvas")): HTMLCanvasElement {
  c.width = WIDTH;
  c.height = Math.max(1, count * L.lh);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#000";
  ctx.font = L.font;
  ctx.textBaseline = "top";
  const pad = Math.round((L.lh - L.size) / 2);
  for (let i = 0; i < count; i++) ctx.fillText(L.lines[from + i], 0, i * L.lh + pad);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const p = img.data;
  for (let i = 0; i < p.length; i += 4) {
    const v = p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114 < 128 ? 0 : 255;
    p[i] = p[i + 1] = p[i + 2] = v;
    p[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** 1 回に描く行数（★高さ 2,400 ドット前後 ＝ canvas の上限から十分遠い）。 */
const chunkLines = (L: Layout) => Math.max(1, Math.floor(2400 / L.lh));

/**
 * 「レシートに印字」を組み立てる。`getText` は印字する本文を返す。
 * 戻り値の `refresh()` は、本文が変わったときに呼ぶ（プレビューを描き直す）。
 */
export function setupPrinter(getText: () => string): { refresh(): void } {
  const box = $<HTMLDetailsElement>("qr-print");
  const status = $<HTMLParagraphElement>("qr-print-status");
  const usbBtn = $<HTMLButtonElement>("qr-print-usb");
  const bleBtn = $<HTMLButtonElement>("qr-print-ble");
  const goBtn = $<HTMLButtonElement>("qr-print-go");
  const cancelBtn = $<HTMLButtonElement>("qr-print-cancel");
  const sizeEl = $<HTMLInputElement>("qr-print-size");
  const sizeVal = $<HTMLElement>("qr-print-size-val");
  const boldEl = $<HTMLInputElement>("qr-print-bold");
  const paceEl = $<HTMLInputElement>("qr-print-pace");
  const feedEl = $<HTMLInputElement>("qr-print-feed");
  const preview = $<HTMLCanvasElement>("qr-print-preview");
  const lenEl = $<HTMLElement>("qr-print-len");
  const family = getComputedStyle(document.body).fontFamily || "sans-serif";

  let link: Link | null = null;
  let busy = false;
  let cancel = false;

  const say = (msg: string, cls = "") => {
    status.textContent = msg;
    status.className = `qr-print-status ${cls}`;
  };
  const sync = () => {
    goBtn.disabled = !link || busy || normalize(getText()) === "";
    usbBtn.disabled = bleBtn.disabled = busy;
    cancelBtn.hidden = !busy;
  };

  const p = loadPrefs();
  sizeEl.value = String(p.size);
  boldEl.checked = p.bold;
  paceEl.value = String(p.pace);
  feedEl.value = String(p.feed);
  const prefs = (): Prefs => ({
    size: Number(sizeEl.value) || DEFAULTS.size,
    bold: boldEl.checked,
    pace: Math.max(0, Math.min(3000, Number(paceEl.value) || 0)),
    feed: Math.max(0, Math.min(20, Number(feedEl.value) || 0)),
  });

  /* ★★**どちらの経路も無いブラウザ**（iPhone / iPad の Safari など）では、押せるものを出さない */
  usbBtn.hidden = !nav.usb;
  bleBtn.hidden = !nav.bluetooth;
  if (!nav.usb && !nav.bluetooth) {
    say("このブラウザからは印字できません（Android・ChromeOS・PC の Chrome / Edge で使えます。iPhone / iPad の Safari は非対応です）。", "err");
  }

  function refresh(): void {
    if (!box.open) return;
    const { size, bold } = prefs();
    sizeVal.textContent = String(size);
    const L = layout(getText(), size, bold, family);
    const n = Math.min(L.lines.length, chunkLines(L));
    drawChunk(L, 0, n, preview);
    const mm = (L.lines.length * L.lh) / 8; /* 203dpi ≒ 8 ドット/mm */
    lenEl.textContent = L.lines.length
      ? `${L.lines.length} 行 ／ 約 ${mm >= 1000 ? `${(mm / 1000).toFixed(1)} m` : `${Math.ceil(mm / 10)} cm`}` +
        (n < L.lines.length ? `（プレビューは先頭 ${n} 行）` : "")
      : "本文が空です";
    sync();
  }

  const lost = () => {
    link = null;
    if (busy) cancel = true;
    say("プリンタとの接続が切れました。");
    sync();
  };

  async function connect(kind: "usb" | "ble"): Promise<void> {
    link?.close();
    link = null;
    sync();
    try {
      say("プリンタを選んでください…");
      link = kind === "usb" ? await openUsb(lost) : await openBle(lost);
      say(`接続しました: ${link.name}`, "ok");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      /* ★選ぶ画面を閉じただけ（NotFoundError）は失敗として騒がない */
      say(e instanceof DOMException && e.name === "NotFoundError" ? "接続をやめました。" : `接続できませんでした —— ${msg}`, "err");
    }
    sync();
  }

  async function print(): Promise<void> {
    if (!link || busy) return;
    const pr = prefs();
    savePrefs(pr);
    const L = layout(getText(), pr.size, pr.bold, family);
    if (!L.lines.length) return;
    busy = true;
    cancel = false;
    sync();
    /* ★長いと何分もかかる。その間に画面が消えると送信が止まるので、点けておく */
    let wake: { release(): Promise<void> } | null = null;
    try {
      wake = (await nav.wakeLock?.request("screen")) ?? null;
    } catch {
      wake = null;
    }
    const total = Math.ceil((L.lines.length * L.lh) / BAND);
    let sent = 0;
    try {
      await link.send(INIT);
      const step = chunkLines(L);
      outer: for (let from = 0; from < L.lines.length; from += step) {
        const n = Math.min(step, L.lines.length - from);
        const c = drawChunk(L, from, n);
        const px = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
        for (const band of bandsFromRgba(px, c.width, c.height)) {
          if (cancel || !link) break outer;
          await link.send(band);
          sent++;
          say(`印字中… ${Math.min(100, Math.round((sent / total) * 100))}%`);
          /* ★★流量制御が無いので、帯ごとに印字が追いつくのを待つ（あふれると黙って欠ける） */
          if (pr.pace) await sleep(pr.pace);
        }
      }
      if (link) await link.send(feed(pr.feed));
      if (!link) say("接続が切れたので、途中で止まりました。", "err");
      else say(cancel ? "途中で止めました。" : "印字しました。", cancel ? "" : "ok");
    } catch (e) {
      say(`印字できませんでした —— ${e instanceof Error ? e.message : String(e)}`, "err");
    }
    void wake?.release().catch(() => {});
    busy = false;
    sync();
  }

  usbBtn.addEventListener("click", () => void connect("usb"));
  bleBtn.addEventListener("click", () => void connect("ble"));
  goBtn.addEventListener("click", () => void print());
  cancelBtn.addEventListener("click", () => {
    cancel = true;
  });
  for (const el of [sizeEl, boldEl]) el.addEventListener("input", refresh);
  for (const el of [sizeEl, boldEl, paceEl, feedEl]) el.addEventListener("change", () => savePrefs(prefs()));
  box.addEventListener("toggle", refresh);
  document.fonts?.ready.then(refresh);
  sync();
  return { refresh };
}
