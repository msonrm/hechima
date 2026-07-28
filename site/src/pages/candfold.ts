// 候補の二層化 実験ページ: 変換候補を「選ぶ層（一層目）」と「探す層（二層目）」に分ける。
//
// 一層目 = 1 位からのコスト差が Δ 以内（下限・上限でクランプ）。候補巡回はこの中で循環し、
// 二層目は Tab で開くグリッドに送る。パラメータは画面のパネルから実行時に変えられる。
//
// **costs を返す wasm が必要**なので、このページだけ vendor/hechima-wasm-cost/ を読む
// （既定の wasm は costs を返さない = 二層化が起きない）。辞書は容量が大きいので
// 既存の vendor/hechima-wasm/mozc.data を共有する。
//
// 設計と実測: labo docs/hechima-candidate-fold-design.md
import { initLabPage } from "../app";

initLabPage({
  flick: "off",
  wasmJs: "/vendor/hechima-wasm-cost/hechima-wasm.js",
  // dataUrl は既定（/vendor/hechima-wasm/mozc.data）のまま = 辞書を共有する
  candidateFold: {
    // 実測から置いた初期値。「こうせい」94→13 件、「ひろし」179→15 件になる線
    costDelta: 3000,
    minCandidates: 5,  // コストが急に開くよみ（「かんしん」）で 2 件まで削れる事故を防ぐ
    maxCandidates: 15, // 候補が拮抗するよみ（人名）で出しすぎないための上限
    pageSize: 5,       // 一層目の 1 ページ件数（一度に視界へ入る数）
    gridRows: 9,       // 二層目の列の高さ = 数字キー 1-9 と一致させる
    gridCols: 8,       // 1 ページ 72 件
  },
});
