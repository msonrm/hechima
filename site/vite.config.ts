import { defineConfig } from "vite";

// COOP/COEP: hechima-wasm（-pthread = SharedArrayBuffer）に必須。
// 本番は public/_headers（Cloudflare Workers 静的アセット）が付与する。
// dev / preview はここで同じヘッダを付ける。
const coopCoep = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  server: { headers: coopCoep },
  preview: { headers: coopCoep },
  build: {
    // vendor の wasm/辞書はハッシュ改名せずそのまま配る（public/ 配下なので対象外だが明示）
    assetsInlineLimit: 0,
  },
});
