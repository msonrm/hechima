// 標準IME（ローマ字入力）ページ: 配列 JSON の romaji 固定。物理キーボードで打鍵を試す
// 場所なのでフリックは出さない（トグルはノイズ）。旧トップページの実験部を移設。
import { initLabPage } from "../app";

initLabPage({ keymap: "romaji", flick: "off" });
