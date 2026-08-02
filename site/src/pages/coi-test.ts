// 環境診断ページ（隠しページ: TOP リンクなし・noindex）。
//
// もとは「単スレッド wasm が COOP/COEP なしで動くか」の検証ページだった。
// 2026-07-25 にサイト全体から COOP/COEP を撤去したので、いまはラボ全体が
// この条件（crossOriginIsolated = false）で動いている。
// このページは、外部ホストへ組み込むときの参照実装と、実機（iPad 等でコンソールが
// 見えない環境）の状態確認のために残してある。
import { initLabPage } from "../app";

const WASM_JS = "/vendor/hechima-wasm/hechima-wasm.js";
const t0 = performance.now();

const put = (id: string, text: string): void => {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
};

// iPad ではコンソールが見えないので、判定材料はすべてページに出す
const coi = typeof crossOriginIsolated !== "undefined" ? crossOriginIsolated : null;
put("d-coi", coi === null ? "不明（このブラウザは未対応）" : coi ? "true（COOP/COEP が付いている）" : "false ← 現在の既定");
put(
  "d-sab",
  typeof SharedArrayBuffer === "undefined"
    ? "undefined（この環境では使えない）"
    : "定義あり（COI でなければ共有はできない。単スレッド版は使わないので無関係）",
);
put("d-wasm", `${WASM_JS}（単スレッド版 = 全ページ共通）`);

initLabPage({ keymap: "romaji", flick: "off" });

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
