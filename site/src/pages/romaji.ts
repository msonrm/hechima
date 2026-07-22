// 標準IME（ローマ字入力）ページ: 内蔵ローマ字固定。フリックはタッチ端末でボタン出現
// （X 経由などスマホ閲覧者がそのまま試せるように。旧トップページの実験部を移設）
import { initLabPage } from "../app";

initLabPage({ flick: "auto" });
