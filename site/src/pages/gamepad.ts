// ゲームパッド入力ページ（公開済み: TOP の実験ページ一覧・対比表「入力デバイス」行から導線あり）。
// 内蔵ローマ字は使わず gamepad-engine が直接かなを解決 → hechima セッションで変換。
// 物理キーボードとも併用できる（OS キーボードは封じない）。
import { initLabPage } from "../app";

// フリックは出さない（ゲームパッド自体がタッチ代替の入力手段なのでトグルは不要）。
// ソフトキーボード抑止は enableGamepad 側で inputmode="none" を立てて行う。
initLabPage({ keymap: "romaji", gamepad: "on", flick: "off" });
