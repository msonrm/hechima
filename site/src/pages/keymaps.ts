// 配列JSON実験ページ（/keymaps/）: 利用者が持ってきた JSON をその場で読ませて即打てるようにする
//
// 他の実験ページが「この配列がブラウザで動く」を見せるのに対し、ここは
// **JSON そのもの**が主役。同梱プルダウンを置かず、必ず外から持ってこさせるのは
// 「配列は持ち運べる成果物である」を体験にするため（DL 元 = /keymaps/list/）。
//
// 出す情報:
//   1. 配列の属性  — JSON にそのまま書いてあるもの
//   2. 動く条件    — 必要な入力段 ↔ **いまの環境の実測値**を隣に並べる。L1/L3 の定義も併記
//   3. シフトの割当 — 役ごとにプルダウン。選ぶと roleOverrides で**実際に切り替わる**
//   4. 配列の特徴  — analyzeKeymap()
//
// **環境の可否を「OS の表」で語らない。** 実測した環境が 4 つしかないので誇大になる。
// 代わりに「配列が要求する段（機械的に確実）」と「見ている人の環境をその場で測った値」を出す。
import { initLabPage } from "../app";

type FeatureItem =
  | { type: "feature"; inputLabel: string; output: string; highlightKeys: string[] }
  | { type: "group"; prefixLabel: string; prefixKey: string | null; children: FeatureItem[] };

type Diag = { code: string; message: string; where?: string; key?: string };

type Engine = {
  decodeKeymap(
    json: unknown,
    opts?: { layout?: string; roleOverrides?: Map<string, string[]>; onDiagnostic?: (d: Diag) => void },
  ): { definition: { roles?: Record<string, { label?: string; keys?: string[] }> } };
  analyzeKeymap(km: unknown): { title: string; items: FeatureItem[] }[];
  requiredInputLevel(def: unknown): "L1" | "L2" | "L3";
  SUPPORTED_SEMANTICS: ReadonlySet<string> | string[];
  version: string;
};
declare const KeymapEngine: Engine;

/**
 * 役に割り当てられる物理キーの候補。
 *
 * ラベルは短く保つ（注意書きを選択肢に入れると横幅がそれに引きずられる。
 * Obsidian プラグインで iPad の実機報告あり）。注意は選んだものについてだけ出す。
 * 値は keymap v2 の `keyName`（JSON の `roles[].keys` と同じ空間）。
 */
const ROLE_CHOICES: [value: string, label: string, note: string][] = [
  ["", "配列の既定にまかせる", ""],
  ["space", "Space", ""],
  ["international5", "無変換", "iPad では届きません"],
  ["international4", "変換", "iPad では届きません"],
  ["lang2", "英数", "iPad では届きません"],
  ["lang1", "かな", "iPad では届きません"],
  ["rightAlt", "右 Alt / Option", "OS が文字キーとの同時押しを奪うことがあります"],
];
const ROLE_NOTE = new Map(ROLE_CHOICES.map(([v, , n]) => [v, n]));

const INPUT_LEVELS: [level: string, title: string, detail: string][] = [
  ["L1", "文字だけ届く", "「何の文字が入力されたか」しか分からない環境。逐次入力の配列だけが動きます"],
  ["L2", "押したことが届く", "キーを押したことは分かるが、離したことが分からない環境"],
  ["L3", "押下と離鍵が届く", "いま押しているキーの集合が作れる環境。同時打鍵の配列はここが要ります"],
];

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} がありません`);
  return e as T;
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// ---- 見ている人の環境を測る（推測しない） ----
//
// 同時打鍵は押下集合が要る = keyup が届くかどうかで決まる。届くなら L3。
// keydown しか来ない環境では「D をホールド中の x」と「D 単打後の x」が同じ列になり、
// 相互シフトも親指シフトも原理的に判定できない。
let envLevel: "L3" | "未測定" = "未測定";
const envListeners: (() => void)[] = [];

function startProbe(): void {
  addEventListener("keyup", () => {
    if (envLevel === "L3") return;
    envLevel = "L3";
    for (const f of envListeners) f();
  }, { capture: true, passive: true });
}

// ---- 情報の組み立て ----

function renderProps(json: Record<string, unknown>): string {
  const rows: [string, unknown][] = [
    ["配列名", json.name],
    ["説明", json.description],
    ["作者", json.author],
    ["改変者", json.contributor],
    ["派生元", json.basedOn],
    ["ライセンス", json.license],
    ["対象文字体系", json.targetScript],
  ];
  const body = rows
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(Array.isArray(v) ? v.join(" / ") : v)}</td></tr>`)
    .join("");
  return `<h3>配列の属性</h3><table class="km-card">${body}</table>`;
}

function renderRuns(json: Record<string, unknown>, level: string, diags: Diag[]): string {
  const behavior = (json.behavior ?? {}) as Record<string, unknown>;
  const cfg = (behavior.config ?? {}) as Record<string, unknown>;
  const kind = behavior.type === "chord" ? "同時打鍵" : "逐次入力";
  const judgment = cfg.judgment === "mutual" ? "相互シフト（時間を見ない状態ベース）"
    : cfg.judgment === "window" ? "時間窓" : null;

  // requires は名前を並べても大半の人には意味が無い。**結論だけ**を出し、名前は畳む
  const supported = new Set(
    Array.isArray(KeymapEngine.SUPPORTED_SEMANTICS)
      ? KeymapEngine.SUPPORTED_SEMANTICS
      : [...(KeymapEngine.SUPPORTED_SEMANTICS as Set<string>)],
  );
  const requires = (json.requires as string[] | undefined) ?? [];
  const unknown = requires.filter((r) => !supported.has(r));
  const verdict = unknown.length === 0
    ? '<span class="ok">この配列が要求する機能は、すべてこのエンジンが持っています</span>'
    : `<span class="ng">このエンジンが理解できない機能を要求しています: ${unknown.map(esc).join(", ")}</span>`;
  const reqDetail = requires.length === 0
    ? ""
    : `<details><summary>要求している機能の名前（${requires.length}）</summary>
         <ul class="km-req">${requires.map((r) => `<li><code>${esc(r)}</code></li>`).join("")}</ul>
         <p class="note">配列は「動かすために理解している必要がある機能」を自分で宣言します。
           理解できない実装は、黙って半分動かす代わりに読み込みを拒否します。</p>
       </details>`;

  const levelRows = INPUT_LEVELS.map(([lv, title, detail]) => {
    const need = lv === level;
    return `<tr${need ? ' class="km-hit"' : ""} data-level="${lv}"><th>${lv}</th><td>${esc(title)} — ${esc(detail)}</td><td class="km-mark">${
      need ? "<b>この配列に必要</b>" : ""}<span class="km-you"></span></td></tr>`;
  }).join("");

  const envLine = `<p id="km-env" class="note"></p>`;

  const diagHtml = diags.length === 0
    ? '<p class="ok">なし（全エントリが有効です）</p>'
    : `<ul class="km-diag">${diags
        .map((d) => `<li><code>${esc(d.code)}</code> ${esc(d.message)}${d.where ? ` <span class="where">(${esc(d.where)})</span>` : ""}</li>`)
        .join("")}</ul>`;

  return `
    <h3>動く条件</h3>
    <table class="km-card">
      <tr><th>方式</th><td>${esc(kind)}${judgment ? ` / ${esc(judgment)}` : ""}</td></tr>
      <tr><th>キーの読み方</th><td>${json.base === "positional" ? "物理キーの位置（JIS / US の刻印差を吸収します）" : "OS が報告する文字"}</td></tr>
    </table>
    <h4>必要な入力の細かさ</h4>
    <table class="km-card km-levels">${levelRows}</table>
    ${envLine}
    <h4>このエンジンで動くか</h4>
    <p>${verdict}</p>
    ${reqDetail}
    <h4>読み込み診断</h4>
    <p class="note">「読めたが、ここは効かない」を報告します。読めなかった場合はそもそもエラーになります。</p>
    ${diagHtml}`;
}

/** シフトの役 → 物理キー。プルダウンで選ぶと実際に切り替わる（roleOverrides） */
function renderRoles(
  roles: Record<string, { label?: string; keys?: string[] }>,
  current: Map<string, string[]>,
): string {
  const names = Object.keys(roles);
  if (names.length === 0) return "";
  const rows = names
    .map((name) => {
      const label = roles[name]?.label ?? name;
      const chosen = current.get(name)?.[0] ?? "";
      const opts = ROLE_CHOICES.map(([v, l]) => {
        const def = v === "" && (roles[name]?.keys?.length ?? 0) > 0
          ? `配列の既定にまかせる（${roles[name]!.keys!.join(" / ")}）`
          : l;
        return `<option value="${esc(v)}"${v === chosen ? " selected" : ""}>${esc(def)}</option>`;
      }).join("");
      const note = ROLE_NOTE.get(chosen) ?? "";
      return `<tr>
        <th>${esc(label)}</th>
        <td><select class="km-role" data-role="${esc(name)}">${opts}</select></td>
        <td class="note">${esc(note)}</td>
      </tr>`;
    })
    .join("");
  return `
    <h3>シフトの割り当て</h3>
    <p class="note">配列が決めるのは<b>役</b>で、それをどのキーに置くかは環境の関心事です
      （キーボードが違う・OS がキーを奪う・単に好み）。ここで変えると、同じJSONのまま割り当てだけが変わります。</p>
    <table class="km-card km-roles">${rows}</table>`;
}

/** 環境の実測値を「動く条件」へ描き込む（再 decode はしない） */
function paintEnv(out: HTMLElement, needed: string): void {
  const line = out.querySelector<HTMLElement>("#km-env");
  if (line) {
    if (envLevel === "L3") {
      line.className = needed === "L3" || needed === "L1" ? "ok" : "note";
      line.innerHTML = `いまの環境は <b>L3</b> です（キーを離したことが届いています）。${
        needed === "L3" ? "この配列は動きます。" : needed === "L1" ? "この配列は動きます。" : ""}`;
    } else {
      line.className = "note";
      line.innerHTML = "いまの環境: <b>測定中</b> — 下のエディタで何かキーを押して離すと判定します。";
    }
  }
  for (const cell of out.querySelectorAll<HTMLElement>("tr[data-level] .km-you")) {
    const row = cell.closest("tr")!;
    const hit = envLevel !== "未測定" && row.dataset.level === envLevel;
    cell.textContent = hit ? (row.querySelector("b") ? " / いまの環境" : "いまの環境") : "";
  }
}

function renderItems(items: FeatureItem[]): string {
  return items
    .map((it) =>
      it.type === "feature"
        ? `<li><code>${esc(it.inputLabel)}</code> → ${esc(it.output)}</li>`
        : `<li><b>${esc(it.prefixLabel)}</b><ul>${renderItems(it.children)}</ul></li>`,
    )
    .join("");
}

function renderFeatures(km: unknown): string {
  let sections: { title: string; items: FeatureItem[] }[] = [];
  try {
    sections = KeymapEngine.analyzeKeymap(km);
  } catch {
    return "";
  }
  // シフト操作は専用 UI（renderRoles）で出すので、ここからは外す
  sections = sections.filter((s) => s.title !== "シフト操作");
  if (sections.length === 0) return "";
  return `<h3>配列の特徴</h3>${sections
    .map((s) => {
      const list = `<ul class="km-feat">${renderItems(s.items)}</ul>`;
      return s.items.length > 12
        ? `<details><summary>${esc(s.title)}</summary>${list}</details>`
        : `<section class="km-sec"><h4>${esc(s.title)}</h4>${list}</section>`;
    })
    .join("")}`;
}

// ---- 起動 ----

initLabPage({
  flick: "off",
  keymap: "romaji", // 読み込み前の初期状態。JSON を読ませると差し替わる
  onKeymapControl(control) {
    const fileInput = el<HTMLInputElement>("km-file");
    const layoutSel = el<HTMLSelectElement>("km-layout");
    const out = el<HTMLDivElement>("km-info");
    const status = el<HTMLParagraphElement>("km-status");
    let lastJson: Record<string, unknown> | null = null;
    let lastLevel = "";
    const overrides = new Map<string, string[]>();

    async function apply(json: Record<string, unknown>): Promise<void> {
      const diags: Diag[] = [];
      let km: ReturnType<Engine["decodeKeymap"]>;
      try {
        km = KeymapEngine.decodeKeymap(json, {
          layout: layoutSel.value || undefined,
          roleOverrides: overrides.size > 0 ? overrides : undefined,
          onDiagnostic: (d) => diags.push(d),
        });
      } catch (e) {
        status.className = "ng";
        status.textContent = `読み込めませんでした: ${(e as Error).message}`;
        out.innerHTML = "";
        return;
      }
      const level = KeymapEngine.requiredInputLevel(km.definition);
      lastLevel = level;
      const roles = km.definition.roles ?? {};
      out.innerHTML =
        renderProps(json) +
        renderRuns(json, level, diags) +
        renderRoles(roles, overrides) +
        renderFeatures(km);

      paintEnv(out, level);

      for (const sel of out.querySelectorAll<HTMLSelectElement>("select.km-role")) {
        sel.addEventListener("change", () => {
          const role = sel.dataset.role!;
          if (sel.value) overrides.set(role, [sel.value]);
          else overrides.delete(role);
          if (lastJson) void apply(lastJson);
        });
      }

      try {
        await control.load(json, layoutSel.value || undefined, overrides);
        status.className = "ok";
        status.textContent = `「${json.name ?? "名前なし"}」を読み込みました。下のエディタで打てます。`;
        lastJson = json;
      } catch (e) {
        status.className = "ng";
        status.textContent = `エンジンに載せられませんでした: ${(e as Error).message}`;
      }
    }

    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        let json: Record<string, unknown>;
        try {
          json = JSON.parse(String(reader.result));
        } catch (e) {
          status.className = "ng";
          status.textContent = `JSON として読めませんでした: ${(e as Error).message}`;
          return;
        }
        overrides.clear(); // 配列が変われば役の割り当ても仕切り直し
        void apply(json);
      };
      reader.readAsText(file);
    });

    // レイアウトを変えたら同じ JSON を読み直す（役 → 物理キーの割り当てだけが変わる）
    layoutSel.addEventListener("change", () => {
      if (lastJson) void apply(lastJson);
    });

    // 環境判定が決まったら **DOM だけ**更新する。
    // apply() を呼び直すとエンジンが作り直され、打鍵中の未確定文字が消える
    envListeners.push(() => paintEnv(out, lastLevel));
    startProbe();

    el<HTMLSpanElement>("km-engine").textContent = KeymapEngine.version;
  },
});
