// 薙刀式ページ: 物理キーボード専用（フリックなし）。JIS/US は物理配列の選択
//
// keymap v2 で配列が 1 本に統合されたので、選ぶのは**配列**ではなく**レイアウト**になった。
// 役（センターシフト）→ 物理キーの対応が layouts で決まる（薙刀式は space 固定なので
// 実際の差は modeKeys の かな/英数 キーだけ）。
import { initLabPage } from "../app";

initLabPage({
  flick: "off",
  keymapLabel: "キーボード:",
  keymap: "naginata",
  keymapChoices: [
    { value: "jis", label: "JIS（日本語配列）" },
    { value: "us", label: "US（英語配列）" },
  ],
});
