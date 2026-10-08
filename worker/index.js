// へちま言語ラボの Worker。
//
// 静的アセットはこれまでどおり Workers の assets がそのまま配る（wrangler.jsonc の
// run_worker_first で、この Worker が呼ばれるのは /api/* だけ）。
//
// /api/pair/<room> = 別の端末をキーボードにする（/remote/）ための**シグナリング中継**。
// WebRTC は最初に接続情報（SDP）を 1 往復だけ交換する必要があり、ブラウザ同士では
// その受け渡し役が居ないので、ここで部屋ごとに WebSocket を 2 本つないで中身を相手へ流す。
//   - 中継が見るのは SDP だけ。打った文字は DataChannel で端末間を直接流れる（LAN の中）
//   - 部屋は Durable Object 1 個 = 2 人まで。何も保存しない（storage を使わない）
//   - 部屋の名前は受け手が乱数で作り、QR で送り手に渡す（知らなければ入れない）

import { DurableObject } from "cloudflare:workers";

const ROOM_PATH = /^\/api\/pair\/([A-Za-z0-9_-]{16,64})$/;
const MAX_PEERS = 2;
/** 1 メッセージの上限。SDP は数 KB に収まる */
const MAX_MESSAGE = 16 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = ROOM_PATH.exec(url.pathname);
    if (!m) return env.ASSETS.fetch(request);
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket で接続してください", { status: 426 });
    }
    const stub = env.PAIR_ROOM.get(env.PAIR_ROOM.idFromName(m[1]));
    return stub.fetch(request);
  },
};

export class PairRoom extends DurableObject {
  async fetch() {
    if (this.ctx.getWebSockets().length >= MAX_PEERS) {
      return new Response("この部屋はもう 2 台つながっています", { status: 409 });
    }
    const pair = new WebSocketPair();
    // ハイバネーション API で受ける（待っている間は DO が眠れる）
    this.ctx.acceptWebSocket(pair[1]);
    this.announce();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > MAX_MESSAGE) {
      ws.close(1009, "message too large");
      return;
    }
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws) other.send(message);
    }
  }

  webSocketClose(ws) {
    this.announce(ws);
  }

  webSocketError(ws) {
    this.announce(ws);
  }

  /** 部屋にいる数を全員に知らせる（gone = いま抜けたソケット。数から除く） */
  announce(gone) {
    const peers = this.ctx.getWebSockets().filter((s) => s !== gone);
    const msg = JSON.stringify({ t: "peers", n: peers.length });
    for (const s of peers) {
      try {
        s.send(msg);
      } catch {
        // 閉じかけのソケット。次の announce で数え直される
      }
    }
  }
}
