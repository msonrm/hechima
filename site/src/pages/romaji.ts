// 標準IME（ローマ字入力）ページ: 内蔵ローマ字固定。物理キーボードで打鍵を試す場所なので
// フリックは出さない（トグルはノイズ）。旧トップページの実験部を移設。
import { initLabPage } from "../app";

initLabPage({ flick: "off" });
