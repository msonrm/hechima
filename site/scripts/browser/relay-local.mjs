// worker/index.js の代役（ローカル検証用）: site/dist を配り、/api/pair/<room> を同じ規則で中継する。
//
// なぜ代役が要るか: wrangler dev が使う workerd は tcmalloc が 48 ビットの仮想アドレス空間を
// 前提にしていて、39 ビットの環境（aarch64 の Chromebook など）では起動直後に落ちる。
// 規則（部屋 = 2 人まで / 入退室で { t: "peers", n } を全員に / 16KB までの文字列を相手へ）は
// worker/index.js と同じにしてあるが、**Worker そのものの検査ではない**。本番は check-remote.mjs を
// 本番の URL に向けて見る。
//
//   PW_DIR=/tmp/pw node site/scripts/browser/relay-local.mjs site/dist 8791
import http from "node:http";
import { createRequire } from "node:module";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const { WebSocketServer } = createRequire(join(process.env.PW_DIR ?? process.cwd(), "_"))("ws");
const DIST = process.argv[2] ?? "site/dist";
const PORT = Number(process.argv[3] ?? 8791);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".webp": "image/webp" };
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const f = join(DIST, p);
  try { await stat(f); res.writeHead(200, { "content-type": TYPES[extname(f)] ?? "application/octet-stream" }); res.end(await readFile(f)); }
  catch { res.writeHead(404); res.end("404"); }
});
const rooms = new Map();
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, sock, head) => {
  const m = /^\/api\/pair\/([A-Za-z0-9_-]{16,64})$/.exec(new URL(req.url, "http://x").pathname);
  if (!m) return sock.destroy();
  const set = rooms.get(m[1]) ?? new Set(); rooms.set(m[1], set);
  if (set.size >= 2) { sock.write("HTTP/1.1 409 Conflict\r\n\r\n"); return sock.destroy(); }
  wss.handleUpgrade(req, sock, head, (ws) => {
    set.add(ws);
    const announce = () => { const msg = JSON.stringify({ t: "peers", n: set.size }); for (const s of set) s.send(msg); };
    announce();
    ws.on("message", (data, isBinary) => { const s = data.toString(); if (isBinary || s.length > 16384) return ws.close(1009); for (const o of set) if (o !== ws) o.send(s); });
    ws.on("close", () => { set.delete(ws); announce(); });
  });
});
server.listen(PORT, "127.0.0.1", () => console.log("relay on", PORT));
