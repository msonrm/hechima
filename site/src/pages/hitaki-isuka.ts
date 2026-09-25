// ひたき配列といすか配列（/hitaki-isuka/）: 五十音図とフリック入力の並びをキーボードに広げた
// ふたつのかな配列を、説明図を見ながら切り替えて試すページ。
//
// 細かいキー定義は見せない（説明図と、触って確かめるので足りる）。配列は `/vendor/keymaps/` の
// 同梱 JSON をタブで差し替える。差し替えの口は /keymaps/ と同じ `onKeymapControl`。
// `#isuka` で開けばいすか配列から始まる（リンクで片方を指せるように）。
import { initLabPage } from "../app";

type LayoutId = "hitaki" | "isuka";
const IDS: readonly LayoutId[] = ["hitaki", "isuka"];
const NAMES: Record<LayoutId, string> = { hitaki: "ひたき配列", isuka: "いすか配列" };

const initial: LayoutId = location.hash === "#isuka" ? "isuka" : "hitaki";
const tabs = IDS.map((id) => document.getElementById(`hi-tab-${id}`) as HTMLButtonElement);
const status = document.getElementById("hi-status") as HTMLSpanElement;

/** タブと説明図だけを切り替える（配列の差し替えは別。エンジンの準備前でも図は見られる） */
function show(id: LayoutId): void {
  for (const other of IDS) {
    const on = other === id;
    document.getElementById(`hi-tab-${other}`)!.setAttribute("aria-selected", String(on));
    (document.getElementById(`hi-panel-${other}`) as HTMLElement).hidden = !on;
  }
}

show(initial);
for (const tab of tabs) tab.disabled = true; // 配列を差し替えられるのはエンジンの準備後
status.textContent = "準備しています…";

initLabPage({
  keymap: initial,
  flick: "off",
  keepScrollOnStart: true, // 説明図が上にあるので、起動時のフォーカスでページを下へ飛ばさない
  onKeymapControl(control) {
    const cache = new Map<LayoutId, unknown>();
    let current = initial;

    async function select(id: LayoutId): Promise<void> {
      show(id);
      history.replaceState(null, "", `#${id}`);
      if (id === current) return;
      try {
        let json = cache.get(id);
        if (json === undefined) {
          const res = await fetch(`/vendor/keymaps/${id}.json`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          json = await res.json();
          cache.set(id, json);
        }
        await control.load(json);
        current = id;
        status.textContent = `${NAMES[id]}で打てます。`;
      } catch (e) {
        status.textContent = `${NAMES[id]}を読み込めませんでした: ${(e as Error).message}`;
        show(current);
      }
      document.getElementById("editor")?.focus({ preventScroll: true }); // 図を見たまま打ち続けられるように
    }

    for (const tab of tabs) {
      tab.disabled = false;
      tab.addEventListener("click", () => void select(tab.dataset.id as LayoutId));
    }
    status.textContent = `${NAMES[initial]}で打てます。`;
  },
});
