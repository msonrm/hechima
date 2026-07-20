// トップページ: 内蔵ローマ字固定。フリックはタッチ端末でボタン出現（X 経由の
// スマホ閲覧者がそのまま試せるように、自動出現はトップだけ）
import { initLabPage } from "../app";

initLabPage({ flick: "auto" });
