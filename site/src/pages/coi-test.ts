// 単スレッド wasm（-pthread なし）の検証ページ（隠しページ: TOP リンクなし・noindex）。
// public/_headers と vite.config.ts の両方で /coi-test/* だけ COOP/COEP を外してある。
// ここで変換が動けば「COOP/COEP なしで hechima が成立する」= COI 非依存化の実ブラウザ実証。
// 本番の pthread 版（/vendor/hechima-wasm/）はそのまま残し、単スレッド版は
// /vendor/hechima-wasm-st/ に併存させている（辞書 mozc.data は共有）。
import { initLabPage } from "../app";

const WASM_JS = "/vendor/hechima-wasm-st/hechima-wasm.js";
const t0 = performance.now();

const put = (id: string, text: string): void => {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
};

// iPad ではコンソールが見えないので、判定材料はすべてページに出す
const coi = typeof crossOriginIsolated !== "undefined" ? crossOriginIsolated : null;
put("d-coi", coi === null ? "不明（このブラウザは未対応）" : coi ? "true ← 外れていません" : "false ← 期待どおり");
put(
  "d-sab",
  typeof SharedArrayBuffer === "undefined"
    ? "undefined（この環境では使えない）"
    : "定義あり（ただし COI でないので共有はできない）",
);
put("d-wasm", `${WASM_JS}（単スレッド版）`);

initLabPage({
  flick: "off",
  wasmJs: WASM_JS,
  expectNoCoi: true,
});

// initLabPage は同期で #status を生成するので、この時点から監視できる。
// 「準備完了」= conn.init() の解決を待って所要時間を出す（辞書のダウンロード込み）
const statusEl = document.getElementById("status");
if (statusEl) {
  const observer = new MutationObserver(() => {
    const s = statusEl.textContent ?? "";
    if (s.includes("準備完了")) {
      put("d-init", `${Math.round(performance.now() - t0)} ms（辞書のダウンロード込み）`);
      observer.disconnect();
    } else if (s.includes("初期化失敗")) {
      put("d-init", "初期化に失敗（下のステータス欄を参照）");
      observer.disconnect();
    }
  });
  observer.observe(statusEl, { childList: true, characterData: true, subtree: true });
}
