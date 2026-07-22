// ゲームパッド入力ページ（隠しページ: TOP からのリンクなし・noindex）。
// 内蔵ローマ字は使わず gamepad-engine が直接かなを解決 → hechima セッションで変換。
// 物理キーボードとも併用できる（OS キーボードは封じない）。
import { initLabPage } from "../app";

initLabPage({ gamepad: "on" });
