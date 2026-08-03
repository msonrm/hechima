// 配列JSONダウンロード一覧（/keymaps/list/）
//
// `/keymaps/` の実験ページに読ませる JSON を落とすためだけのページ。
// 一覧そのものは `/vendor/keymaps/` を走査するのではなく **ここに列挙する**
// （静的サイトなのでディレクトリ一覧は取れない）。配列を増やしたらここに 1 行足す。
//
// 説明文は JSON から読む。二重管理にすると必ず腐るため、
// name / description / author / requires / behavior はファイルから取り出す。

const FILES = [
  "romaji.json",
  "romaji_colemak.json",
  "azik.json",
  "tsuki2-263.json",
  "nicola.json",
  "naginata.json",
  "oyayubi_pyun_1key.json",
] as const;

type Engine = {
  decodeKeymap(json: unknown, opts?: Record<string, unknown>): { definition: unknown };
  requiredInputLevel(def: unknown): "L1" | "L2" | "L3";
};
declare const KeymapEngine: Engine;

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** JSON から「どういう方式か」を 1 行に畳む */
function kindOf(json: Record<string, unknown>): string {
  const behavior = (json.behavior ?? {}) as Record<string, unknown>;
  const cfg = (behavior.config ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (behavior.type === "chord") {
    parts.push("同時打鍵");
    if (cfg.judgment === "mutual") parts.push("相互シフト");
    else if (cfg.judgment === "window") parts.push("時間窓");
  } else {
    parts.push("逐次入力");
    if (json.inputBase === "romaji") parts.push("ローマ字ベース");
    if (Array.isArray(json.prefixShiftKeys) && json.prefixShiftKeys.length > 0) parts.push("前置シフト");
    if (json.keyRemap) parts.push("キーリマップ");
  }
  if (json.base === "positional") parts.push("物理キー位置で照合");
  return parts.join("・");
}

async function main(): Promise<void> {
  const list = document.getElementById("kml-list");
  if (!list) return;

  const rows = await Promise.all(
    FILES.map(async (file) => {
      try {
        const res = await fetch(`/vendor/keymaps/${file}`);
        if (!res.ok) return null;
        const json = (await res.json()) as Record<string, unknown>;
        let level = "";
        try {
          const km = KeymapEngine.decodeKeymap(json);
          level = KeymapEngine.requiredInputLevel(km.definition);
        } catch {
          level = "";
        }
        return { file, json, level };
      } catch {
        return null;
      }
    }),
  );

  const html = rows
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .map(({ file, json, level }) => {
      const author = json.author ? `<span class="kml-author">${esc(json.author)}</span>` : "";
      const lv = level
        ? `<span class="kml-lv" title="${level === "L3" ? "キーを離したことが分かる環境が要ります" : "打鍵の列だけで決まります"}">${esc(level)}</span>`
        : "";
      return `<li class="kml-row">
        <div class="kml-head"><b>${esc(json.name)}</b> ${author} ${lv}</div>
        <p class="kml-kind">${esc(kindOf(json))}</p>
        ${json.description ? `<p class="kml-desc">${esc(json.description)}</p>` : ""}
        <p class="kml-dl"><a href="/vendor/keymaps/${esc(file)}" download="${esc(file)}">⤓ ${esc(file)} をダウンロード</a></p>
      </li>`;
    })
    .join("");

  list.innerHTML = html || "<li>一覧を取得できませんでした。</li>";
}

void main();
