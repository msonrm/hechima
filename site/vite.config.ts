import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// COOP/COEP: hechima-wasm（-pthread = SharedArrayBuffer）に必須。
// 本番は public/_headers（Cloudflare Workers 静的アセット）が付与する。
// dev / preview はここで同じヘッダを付ける。
const coopCoep = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
};

export default defineConfig({
  server: { headers: coopCoep },
  preview: { headers: coopCoep },
  build: {
    // vendor の wasm/辞書はハッシュ改名せずそのまま配る（public/ 配下なので対象外だが明示）
    assetsInlineLimit: 0,
    // マルチページ（実験ページ = ディレクトリ + index.html。新ページはここに 1 行足す）
    rollupOptions: {
      input: {
        home: fileURLToPath(new URL("./index.html", import.meta.url)),
        naginata: fileURLToPath(new URL("./naginata/index.html", import.meta.url)),
        flick: fileURLToPath(new URL("./flick/index.html", import.meta.url)),
        tategaki: fileURLToPath(new URL("./tategaki/index.html", import.meta.url)),
      },
    },
  },
});
