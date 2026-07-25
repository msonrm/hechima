import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from "vite";
import { fileURLToPath } from "node:url";

// COOP/COEP: hechima-wasm が単スレッドビルドになった（2026-07-25）ので本来もう不要だが、
// 段階を踏むため当面は本番（public/_headers）と揃えて付けておく。
// dev / preview で本番と同じ状態を再現するためのもの。
//
// ただし /coi-test/* だけは意図的に COOP/COEP を付けない = 単スレッド wasm の検証ページ。
// _headers 側の `!`（ヘッダ削除）と等価にしておかないとローカルで検証にならないので、
// server.headers（全パス一律）ではなく middleware で条件分岐する。
const applyCoiHeaders = (server: ViteDevServer | PreviewServer): void => {
  server.middlewares.use((req, res, next) => {
    if (!req.url?.startsWith("/coi-test")) {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    }
    // CORP は COI の要件ではない（iPad Safari のキャッシュ誤ブロック対策）ので全パスに付ける
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    next();
  });
};

const coiHeaders: Plugin = {
  name: "lll-coi-headers",
  configureServer: applyCoiHeaders,
  configurePreviewServer: applyCoiHeaders,
};

export default defineConfig({
  plugins: [coiHeaders],
  build: {
    // vendor の wasm/辞書はハッシュ改名せずそのまま配る（public/ 配下なので対象外だが明示）
    assetsInlineLimit: 0,
    // マルチページ（実験ページ = ディレクトリ + index.html。新ページはここに 1 行足す）
    rollupOptions: {
      input: {
        home: fileURLToPath(new URL("./index.html", import.meta.url)),
        romaji: fileURLToPath(new URL("./romaji/index.html", import.meta.url)),
        naginata: fileURLToPath(new URL("./naginata/index.html", import.meta.url)),
        flick: fileURLToPath(new URL("./flick/index.html", import.meta.url)),
        tategaki: fileURLToPath(new URL("./tategaki/index.html", import.meta.url)),
        gamepad: fileURLToPath(new URL("./gamepad/index.html", import.meta.url)),
        coiTest: fileURLToPath(new URL("./coi-test/index.html", import.meta.url)),
      },
    },
  },
});
