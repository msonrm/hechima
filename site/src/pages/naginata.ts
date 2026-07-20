// 薙刀式ページ: 物理キーボード専用（フリックなし）。JIS/US は物理配列の選択
import { initLabPage } from "../app";

initLabPage({
  flick: "off",
  keymapLabel: "キーボード:",
  keymapChoices: [
    { value: "naginata_jis", label: "JIS（日本語配列）" },
    { value: "naginata_us", label: "US（英語配列）" },
  ],
});
