import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// COOP/COEP は 2026-07-25 に撤去（hechima-wasm の単スレッド化で SharedArrayBuffer が不要に
// なったため。詳細は public/_headers のコメント）。本番と揃えて dev / preview でも付けない。
// CORP だけは本番同様に付ける（外部サイトからの埋め込み防止 + iPad Safari 対策の経緯）。
const corp = { "Cross-Origin-Resource-Policy": "same-origin" };

export default defineConfig({
  server: { headers: corp },
  preview: { headers: corp },
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
        candfold: fileURLToPath(new URL("./candfold/index.html", import.meta.url)),
        coiTest: fileURLToPath(new URL("./coi-test/index.html", import.meta.url)),
        theme: fileURLToPath(new URL("./theme/index.html", import.meta.url)),
      },
    },
  },
});
