/* 別の端末をキーボードにする（/remote/）の接続層。
 *
 * 受け手（Chromebook 等。変換エンジンを持つ）と送り手（タブレット・スマホ等。キーボードだけ）を
 * WebRTC DataChannel で直接つなぐ。最初の接続情報（SDP）の受け渡しだけ、ラボの Worker の
 * 中継（/api/pair/<room>。worker/index.js）を通す。打った文字は中継を通らない。
 *
 * 流れるもの（DataChannel の上）:
 *   送り手 → 受け手  { t: "op", seq, op }
 *     op は 2 系統ある:
 *       - フリック = FlickOp（kana / key / text）。**盤面そのものが配列**なので、送り手で
 *         かなまで解決して送る
 *       - 配列図   = keydown / keyup（KeyTap）。送り手は「理想的な物理キーボード」として
 *         押した・離したを送るだけで、**配列エンジンは受け手で動く**。未確定の途中の表示・
 *         同時打鍵・編集操作が、物理キーボードと同じ実装のまま効く
 *   送り手 → 受け手  { t: "layout", keymap, layout }
 *     配列図で打つ配列の宣言（keymap = /vendor/keymaps/<id>.json、null = フリック）。
 *     どの配列で打つかはキーボード側が決め、受け手はそれに従う
 *   受け手 → 送り手  { t: "state", ack, composing, tail }
 *     キーボードの表示と ゛゜小 のための状態。候補は送らない（候補を見るのは受け手の画面）
 *
 * シグナリングは非トリクル（候補を集め切ってから SDP を 1 通で送る）。同じ LAN なら
 * ホスト候補だけで直結するので、集めるのは一瞬で済む。
 */

import type { FlickOp } from "../app";

/**
 * 回線に載せる操作。FlickOp のうち layer を除いたもの（layer は送り手の盤面の中で閉じる）と、
 * 配列図のキーの押下・解放
 */
export type WireOp =
  | Exclude<FlickOp, { type: "layer" }>
  | { type: "keydown"; tap: Hechima.KeyTap }
  | { type: "keyup"; tap: Hechima.KeyTap };

export type PeerMsg =
  | { t: "op"; seq: number; op: WireOp }
  | { t: "layout"; keymap: string | null; layout: string }
  | { t: "state"; ack: number; composing: boolean; tail: string };

/**
 * 配列図で打てる配列（`/vendor/keymaps/<id>.json`）。受け手はここに無いものを読まない。
 * 表示名は JSON の name から取る
 */
export const REMOTE_KEYMAPS = [
  "naginata", "azik", "romaji", "nicola", "tsuki2-263", "oyayubi_pyun_1key", "hitaki", "isuka",
] as const;

export function isRemoteKeymap(id: unknown): id is (typeof REMOTE_KEYMAPS)[number] {
  return typeof id === "string" && (REMOTE_KEYMAPS as readonly string[]).includes(id);
}

export type Role = "host" | "keyboard";

export type LinkStatus =
  | "signal" // 中継へつないでいる
  | "waiting" // 中継にはつながった。相手を待っている
  | "connecting" // 相手が来た。直接の回線を張っている
  | "open" // 直接つながった
  | "failed"; // 直接つながらなかった（同じ Wi-Fi に居ない等）

export interface Link {
  send(msg: PeerMsg): boolean;
  close(): void;
}

const ICE: RTCConfiguration = {
  // 同じ LAN ならホスト候補だけでつながる。STUN は LAN の外側の住所も候補に足すだけで、
  // 回線が中継を通るわけではない（TURN は持たない = 文字は必ず端末間を直接流れる）
  iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
};

/** 候補を集め切るまで待つ（上限つき。上限に達したら集まった分で出す） */
const GATHER_TIMEOUT_MS = 3000;

// ---- 部屋 ------------------------------------------------------------------

/** 部屋の名前 = 16 バイトの乱数（base64url）。知らなければ入れない */
export function newRoom(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isRoom(s: string | null | undefined): s is string {
  return !!s && /^[A-Za-z0-9_-]{16,64}$/.test(s);
}

/** 送り手のページの URL（部屋はフラグメントに置く = サーバーのログに残らない） */
export function keyboardUrl(room: string): string {
  return `${location.origin}/remote/keyboard/#r=${room}`;
}

export function roomFromHash(): string | null {
  const r = new URLSearchParams(location.hash.slice(1)).get("r");
  return isRoom(r) ? r : null;
}

// ---- 受け取ったものの検査 ----------------------------------------------------
//
// 受け手は届いた操作をそのまま文書へ注ぐので、形が正しいものだけを通す。

function str(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length <= max;
}

/** KeyTap の検査（知らないフィールドは落とす） */
function parseTap(x: unknown): Hechima.KeyTap | null {
  if (!x || typeof x !== "object") return null;
  const t = x as Record<string, unknown>;
  if (!str(t.key, 32) || !t.key) return null;
  const tap: Hechima.KeyTap = { key: t.key };
  if (str(t.code, 32)) tap.code = t.code;
  if (t.shiftKey === true) tap.shiftKey = true;
  if (t.ctrlKey === true) tap.ctrlKey = true;
  if (t.altKey === true) tap.altKey = true;
  if (t.metaKey === true) tap.metaKey = true;
  return tap;
}

/** 操作の検査。形が違えば null */
export function parseOp(x: unknown): WireOp | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (o.type === "kana" && str(o.text, 8) && o.text &&
      typeof o.replace === "number" && Number.isInteger(o.replace) && o.replace >= 0 && o.replace <= 8) {
    return { type: "kana", text: o.text, replace: o.replace };
  }
  if (o.type === "text" && str(o.text, 64) && o.text) {
    return { type: "text", text: o.text };
  }
  if (o.type === "key" || o.type === "keydown" || o.type === "keyup") {
    const tap = parseTap(o.tap);
    if (!tap) return null;
    // 配列図のキーは code が要る（配列エンジンは code で引く）
    if (o.type !== "key" && !tap.code) return null;
    return { type: o.type, tap };
  }
  return null;
}

/** DataChannel のメッセージの検査 */
function parsePeerMsg(data: unknown): PeerMsg | null {
  if (typeof data !== "string" || data.length > 4096) return null;
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!m || typeof m !== "object") return null;
  if (m.t === "op" && typeof m.seq === "number" && Number.isInteger(m.seq)) {
    const op = parseOp(m.op);
    return op ? { t: "op", seq: m.seq, op } : null;
  }
  if (m.t === "layout" && (m.keymap === null || isRemoteKeymap(m.keymap)) &&
      (m.layout === "jis" || m.layout === "us")) {
    return { t: "layout", keymap: m.keymap, layout: m.layout };
  }
  if (m.t === "state" && typeof m.ack === "number" && typeof m.composing === "boolean" && str(m.tail, 1024)) {
    return { t: "state", ack: m.ack, composing: m.composing, tail: m.tail };
  }
  return null;
}

// ---- 接続 ------------------------------------------------------------------

function waitGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const timer = setTimeout(done, GATHER_TIMEOUT_MS);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

/**
 * 部屋につなぐ。host（受け手）は相手が来たら offer を出し、keyboard（送り手）はそれに answer で応える。
 * 中継の WebSocket は切れたらつなぎ直す（相手が読み込み直したときの再接続もこれで回る）。
 */
export function connect(
  room: string,
  role: Role,
  handlers: { onMessage(m: PeerMsg): void; onStatus(s: LinkStatus): void },
): Link {
  let ws: WebSocket | null = null;
  let pc: RTCPeerConnection | null = null;
  let dc: RTCDataChannel | null = null;
  let closed = false;
  let peers = 0;
  let retry = 0;
  let status: LinkStatus = "signal";

  const setStatus = (s: LinkStatus) => {
    if (s === status) return;
    status = s;
    handlers.onStatus(s);
  };

  const signal = (m: Record<string, unknown>) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };

  function teardown(): void {
    dc?.close();
    pc?.close();
    dc = null;
    pc = null;
  }

  function wire(ch: RTCDataChannel): void {
    dc = ch;
    ch.onopen = () => setStatus("open");
    ch.onclose = () => {
      if (dc !== ch) return; // 張り直しで捨てた古い回線
      teardown();
      if (closed) return;
      setStatus(peers >= 2 ? "connecting" : "waiting");
      // 中継には 2 人とも残っている（= peers の通知が来ない）ので、受け手から張り直す
      if (role === "host" && peers >= 2) void offer();
    };
    ch.onmessage = (ev) => {
      const m = parsePeerMsg(ev.data);
      if (m) handlers.onMessage(m);
    };
  }

  function newPc(): RTCPeerConnection {
    teardown();
    const p = new RTCPeerConnection(ICE);
    p.onconnectionstatechange = () => {
      if (pc !== p) return;
      if (p.connectionState === "failed") setStatus("failed");
    };
    pc = p;
    return p;
  }

  async function offer(): Promise<void> {
    const p = newPc();
    wire(p.createDataChannel("hechima", { ordered: true }));
    setStatus("connecting");
    await p.setLocalDescription(await p.createOffer());
    await waitGathering(p);
    if (pc !== p || !p.localDescription) return;
    signal({ t: "offer", sdp: p.localDescription.sdp });
  }

  async function answer(sdp: string): Promise<void> {
    const p = newPc();
    p.ondatachannel = (ev) => wire(ev.channel);
    setStatus("connecting");
    await p.setRemoteDescription({ type: "offer", sdp });
    await p.setLocalDescription(await p.createAnswer());
    await waitGathering(p);
    if (pc !== p || !p.localDescription) return;
    signal({ t: "answer", sdp: p.localDescription.sdp });
  }

  function onSignal(data: unknown): void {
    if (typeof data !== "string") return;
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (m.t === "peers" && typeof m.n === "number") {
      peers = m.n;
      const live = dc?.readyState === "open";
      if (peers >= 2 && !live) {
        if (role === "host") void offer().catch(() => setStatus("failed"));
        else setStatus("connecting");
      } else if (peers < 2 && !live) {
        teardown();
        setStatus("waiting");
      }
      // 直接の回線が生きていれば、中継から相手が抜けても（iOS が裏で WS を切った等）そのまま使う
    } else if (m.t === "offer" && role === "keyboard" && str(m.sdp, 16384)) {
      void answer(m.sdp).catch(() => setStatus("failed"));
    } else if (m.t === "answer" && role === "host" && str(m.sdp, 16384)) {
      if (pc && pc.signalingState === "have-local-offer") {
        void pc.setRemoteDescription({ type: "answer", sdp: m.sdp }).catch(() => setStatus("failed"));
      }
    }
  }

  function openSignal(): void {
    if (closed) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const s = new WebSocket(`${proto}://${location.host}/api/pair/${room}`);
    ws = s;
    s.onopen = () => {
      retry = 0;
      if (status === "signal") setStatus("waiting");
    };
    s.onmessage = (ev) => onSignal(ev.data);
    s.onclose = () => {
      if (ws !== s || closed) return;
      ws = null;
      if (dc?.readyState !== "open") setStatus("signal");
      // 1 秒から倍々で 10 秒まで
      const wait = Math.min(10_000, 1000 * 2 ** retry++);
      setTimeout(openSignal, wait);
    };
  }

  openSignal();

  return {
    send(msg) {
      if (!dc || dc.readyState !== "open") return false;
      dc.send(JSON.stringify(msg));
      return true;
    },
    close() {
      closed = true;
      teardown();
      ws?.close();
      ws = null;
    },
  };
}
