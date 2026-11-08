/* 配列図キーボードの「自由配置」— 画面のどこにでもキーを置ける盤面。
 *
 * 発端: キースイッチを iPad の画面に貼ると「押すとタッチになる」物理キーになる（銅線とアルミホイルで
 * 指の静電容量を画面へつなぐ）。それを並べれば、基板もマイコンも無い自作キーボードになる。
 * 足りないのは「画面のこの座標は、このキー」という対応だけなので、それを登録して打つ。
 *
 * - **登録**: 配列で使うキーを左上から横へ順に促し、押された点をそのキーの位置にする。
 *   画面はスイッチで覆われて図が見えないので、図ではなく**手順**として作る（飛ばす・戻る・段ごと飛ばす）
 * - **調整**: iOS のホーム画面のアイコン編集と同じ所作。キーが揺れて「−」が付き、ドラッグで動かす・
 *   「−」で外す。**スイッチを貼り替えたあと**のために「キーを押す → 新しい場所を押す」でも動かせる
 *   （画面はスイッチで覆われていて、指でドラッグできるとは限らない）
 * - **打つ**: 押された点に一番近いキー（の半径の内側）をそのキーとして送る。押したあと指が滑っても
 *   別のキーにはしない（物理キーボードと同じ）
 *
 * ★押したキーの真上には物理キーが乗るので、キーそのものの色だけでは押したことが見えない。
 *   **キーの外側へ広がる波紋と発光**で返す。キーを四角でなく円で描くのも同じ理由（四角は向きを持ち、
 *   置いた角度と食い違うと目障り）。
 *
 * 位置はビューポートの CSS ピクセル（キーの中心）。スイッチは画面に物理的に貼ってあるので、
 * 拡大縮小して合わせるのは間違い —— 画面の大きさが登録時と違えば（向き・ツールバー）知らせるだけにする。
 *
 * ★長押しで調整に入る、は**しない**（iOS の作法だが、打っている間の長押し＝親指シフトの保持が正しい
 *   入力なので）。調整はバーのボタンからだけ入る。
 */

export interface KeyGeom { code: string; x: number; y: number; w: number; h: number; label?: string }
export interface KeyboardProfile { id: string; name: string; width: number; height: number; keys: KeyGeom[] }

/** 置いたキー 1 個（中心・ビューポートの CSS ピクセル） */
export interface FreeKey { code: string; x: number; y: number }

/** 自由配置（書き出す JSON の形でもある） */
export interface FreeLayout {
  format: "lll-free-1";
  /** 物理配置（jis / us / ortho）。キーが出す文字の表（JIS の Shift+2 は `"`…）がこれで決まる */
  profile: string;
  /** キーの直径（CSS ピクセル） */
  size: number;
  /** 登録したときのビューポート（違えば知らせる） */
  viewport: { w: number; h: number };
  keys: FreeKey[];
}

export const FREE_SIZE_MIN = 40;
export const FREE_SIZE_MAX = 160;
export const FREE_SIZE_DEFAULT = 80;

/** 登録の 1 手 */
export interface Step {
  code: string;
  /** 文字キー（配列が文字を割り当てているキー）か、機能キー（親指・BS・Enter…）か */
  phase: "char" | "func";
  /** 段（「この段を飛ばす」の単位） */
  row: number;
}

/** 配列が使っていなくても文字キーとして登録する 30 キー（英字と ; , . /） */
const ALPHA_BLOCK = new Set([
  ..."QWERTYUIOPASDFGHJKLZXCVBNM".split("").map((c) => `Key${c}`),
  "Semicolon", "Comma", "Period", "Slash",
]);

/** 機能キー（並びは大事な順。親指の役のあとに置く） */
const FUNC_ORDER = [
  "Space", "Backspace", "Enter", "Escape",
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "ShiftLeft",
];

/**
 * 配列 JSON の役（roles）が使う物理キー → KeyboardEvent.code。
 * keymap v2: `roles.<役>.keys` が既定、`layouts.<layout>.<役>` はその**追加**
 */
export function roleCodes(
  keymapJson: unknown,
  layout: string,
  toCode: (hidName: string) => string | undefined,
): string[] {
  const j = keymapJson as {
    roles?: Record<string, { keys?: unknown }>;
    layouts?: Record<string, Record<string, unknown>>;
  };
  const names: string[] = [];
  const add = (v: unknown) => {
    if (Array.isArray(v)) for (const n of v) if (typeof n === "string") names.push(n);
  };
  for (const [role, def] of Object.entries(j.roles ?? {})) {
    add(def?.keys);
    add(j.layouts?.[layout]?.[role]);
  }
  const out: string[] = [];
  for (const n of names) {
    const c = toCode(n);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/**
 * 登録する順。文字キー（30 キー＋配列が文字を割り当てているキー）を左上から横へ、
 * そのあと機能キー（親指の役 → 空白 → BS → Enter → Esc → 矢印 → Shift）。
 * 物理配置に無いキーは出さない
 */
export function registrationSteps(
  profile: KeyboardProfile,
  labels: ReadonlyMap<string, string>,
  roles: readonly string[],
): Step[] {
  const has = new Map(profile.keys.map((k) => [k.code, k]));
  const rowOf = (code: string) => Math.floor(has.get(code)?.y ?? 0);
  const chars = profile.keys
    .filter((k) => ALPHA_BLOCK.has(k.code) || labels.has(k.code))
    .sort((a, b) => Math.floor(a.y) - Math.floor(b.y) || a.x - b.x)
    .map((k): Step => ({ code: k.code, phase: "char", row: rowOf(k.code) }));
  const taken = new Set(chars.map((s) => s.code));
  const funcs: Step[] = [];
  for (const code of [...roles, ...FUNC_ORDER]) {
    if (!has.has(code) || taken.has(code)) continue;
    taken.add(code);
    funcs.push({ code, phase: "func", row: rowOf(code) });
  }
  return [...chars, ...funcs];
}

/** 読み込んだ JSON を検査して通す（形が違えば null） */
export function parseFreeLayout(data: unknown): FreeLayout | null {
  const d = data as Partial<FreeLayout> | null;
  if (!d || d.format !== "lll-free-1" || typeof d.profile !== "string" || !Array.isArray(d.keys)) return null;
  const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  const keys: FreeKey[] = [];
  const seen = new Set<string>();
  for (const k of d.keys as unknown[]) {
    const kk = k as Partial<FreeKey> | null;
    if (!kk || typeof kk.code !== "string" || !num(kk.x) || !num(kk.y) || seen.has(kk.code)) continue;
    seen.add(kk.code);
    keys.push({ code: kk.code, x: kk.x, y: kk.y });
  }
  const size = num(d.size) ? Math.min(FREE_SIZE_MAX, Math.max(FREE_SIZE_MIN, d.size)) : FREE_SIZE_DEFAULT;
  const vp = d.viewport && num(d.viewport.w) && num(d.viewport.h) ? { w: d.viewport.w, h: d.viewport.h } : { w: 0, h: 0 };
  return { format: "lll-free-1", profile: d.profile, size, viewport: vp, keys };
}

// ---------------------------------------------------------------------------
// 盤面

export interface FreeBoardOpts {
  profile: KeyboardProfile;
  steps: Step[];
  /** 保存してあった配置（無ければ登録から始める） */
  saved: FreeLayout | null;
  /** キーに刻む文字（配列の刻印。無ければ物理の刻印） */
  labels: ReadonlyMap<string, string>;
  /** 操作（登録の案内・調整の道具）を出す場所。バーの中 */
  tools: HTMLElement;
  onSave(layout: FreeLayout): void;
  /** キーを押した。false = 受け付けなかった（同じキーを別の指で） */
  onDown(pointerId: number, code: string): boolean;
  onUp(pointerId: number): void;
  /** 登録・調整・打つ、が替わった（バーの見た目のため） */
  onMode?(mode: FreeMode): void;
}

export type FreeMode = "type" | "register" | "edit";

export interface FreeBoard {
  readonly mode: FreeMode;
  /** 調整に入る / 出る */
  edit(on: boolean): void;
  /** 登録しなおす */
  register(): void;
  destroy(): void;
}

const MOVE_SLOP = 10; // これ以上動いたらドラッグ（タップではない）

export function mountFree(area: HTMLElement, opts: FreeBoardOpts): FreeBoard {
  const { profile, steps, tools } = opts;
  const geom = new Map(profile.keys.map((k) => [k.code, k]));
  const vp = () => ({ w: window.innerWidth, h: window.innerHeight });

  let layout: FreeLayout = opts.saved && opts.saved.profile === profile.id
    ? { ...opts.saved, keys: opts.saved.keys.filter((k) => geom.has(k.code)) }
    : { format: "lll-free-1", profile: profile.id, size: FREE_SIZE_DEFAULT, viewport: vp(), keys: [] };

  const layer = document.createElement("div");
  layer.className = "fx-layer";
  area.appendChild(layer);
  const els = new Map<string, HTMLElement>();

  const mainLabel = (code: string) => {
    const l = opts.labels.get(code);
    if (l) return l;
    const g = geom.get(code)?.label ?? "";
    return code === "Space" ? "空白" : g || code;
  };
  /** 配列の刻印と物理の刻印が違えば、物理を小さく添える（登録のときにどのキーか分かるように） */
  const subLabel = (code: string) => {
    const g = code === "Space" ? "Space" : geom.get(code)?.label ?? "";
    return opts.labels.has(code) && g !== mainLabel(code) ? g : "";
  };

  function save(): void {
    layout = { ...layout, viewport: vp() };
    opts.onSave(layout);
  }

  function applySize(): void {
    layer.style.setProperty("--d", `${layout.size}px`);
  }

  function keyEl(k: FreeKey): HTMLElement {
    let el = els.get(k.code);
    if (!el) {
      el = document.createElement("div");
      el.className = "fx-key";
      el.dataset.code = k.code;
      // 揺れの位相をキーごとにずらす（iOS のアイコンと同じく、揃って揺れると機械っぽい）
      el.style.setProperty("--jd", `${-Math.random() * 0.3}s`);
      const body = document.createElement("div");
      body.className = "fx-body";
      const glow = document.createElement("div");
      glow.className = "fx-glow";
      const cap = document.createElement("div");
      cap.className = "fx-cap";
      const main = document.createElement("span");
      main.className = "fx-main";
      main.textContent = mainLabel(k.code);
      const len = Array.from(main.textContent).length;
      if (len > 1) main.dataset.len = String(Math.min(len, 4));
      cap.appendChild(main);
      const sub = subLabel(k.code);
      if (sub) {
        const s = document.createElement("span");
        s.className = "fx-sub";
        s.textContent = sub;
        cap.appendChild(s);
      }
      const del = document.createElement("div");
      del.className = "fx-del";
      del.textContent = "−";
      del.setAttribute("aria-label", "外す");
      body.append(cap, del);
      el.append(glow, body);
      layer.appendChild(el);
      els.set(k.code, el);
    }
    el.style.left = `${k.x}px`;
    el.style.top = `${k.y}px`;
    return el;
  }

  function render(): void {
    applySize();
    const live = new Set(layout.keys.map((k) => k.code));
    for (const [code, el] of els) {
      if (!live.has(code)) {
        el.remove();
        els.delete(code);
      }
    }
    for (const k of layout.keys) keyEl(k);
  }

  /** 押した手応え: 波紋を 2 重に（2 つ目は少し遅れて・薄く） */
  function ripple(code: string): void {
    const el = els.get(code);
    if (!el) return;
    for (const late of [false, true]) {
      const r = document.createElement("div");
      r.className = late ? "fx-ripple is-late" : "fx-ripple";
      r.addEventListener("animationend", () => r.remove(), { once: true });
      el.insertBefore(r, el.firstChild);
    }
  }

  const findKey = (code: string) => layout.keys.find((k) => k.code === code);

  /** 点 (x, y) に一番近いキー。`within` = 中心からの距離の上限（直径に対する比） */
  function nearest(x: number, y: number, within: number): FreeKey | null {
    let best: FreeKey | null = null;
    let bestD = Infinity;
    for (const k of layout.keys) {
      const d = Math.hypot(k.x - x, k.y - y);
      if (d < bestD) {
        best = k;
        bestD = d;
      }
    }
    return best && bestD <= layout.size * within ? best : null;
  }

  // ---- バーの道具 ----
  const btn = (label: string, onClick: () => void, cls = "") => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener("click", onClick);
    return b;
  };

  let mode: FreeMode = "type";
  let note = ""; // 一時的な知らせ（重なり・読み込みの失敗など）
  let noteTimer = 0;
  function say(msg: string): void {
    note = msg;
    clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => {
      note = "";
      drawTools();
    }, 2500);
    drawTools();
  }

  function setMode(m: FreeMode): void {
    mode = m;
    layer.dataset.mode = m;
    selected = null;
    pending = null;
    syncMarks();
    drawTools();
    opts.onMode?.(m);
  }

  // ---- 登録 ----
  let idx = 0;
  let history: { code: string; placed: boolean }[] = [];

  function startRegister(): void {
    layout = { ...layout, keys: [] };
    idx = 0;
    history = [];
    render();
    setMode("register");
  }

  function finishRegister(): void {
    save();
    setMode("type");
  }

  function advance(): void {
    if (idx >= steps.length) finishRegister();
    else drawTools();
  }

  function registerAt(x: number, y: number): void {
    const step = steps[idx];
    if (!step) return;
    const near = nearest(x, y, 0.75);
    if (near) {
      say(`そこには「${mainLabel(near.code)}」があります`);
      ripple(near.code);
      return;
    }
    layout.keys.push({ code: step.code, x, y });
    history.push({ code: step.code, placed: true });
    render();
    ripple(step.code);
    idx += 1;
    save(); // 途中で閉じても、置いたところまでは残す
    advance();
  }

  function skip(): void {
    const step = steps[idx];
    if (!step) return;
    history.push({ code: step.code, placed: false });
    idx += 1;
    advance();
  }

  function skipRow(): void {
    const step = steps[idx];
    if (!step) return;
    while (steps[idx] && steps[idx].row === step.row && steps[idx].phase === step.phase) skip();
  }

  function back(): void {
    const h = history.pop();
    if (!h) return;
    idx -= 1;
    if (h.placed) {
      layout.keys = layout.keys.filter((k) => k.code !== h.code);
      render();
      save();
    }
    drawTools();
  }

  // ---- 調整 ----
  let selected: string | null = null; // 「押して → 新しい場所を押す」で動かすキー
  let pending: string | null = null; // 置き場の空いたキー（トレイから選んだもの）

  function syncMarks(): void {
    for (const [code, el] of els) el.classList.toggle("is-sel", code === selected);
  }

  function unplaced(): Step[] {
    const placed = new Set(layout.keys.map((k) => k.code));
    return steps.filter((s) => !placed.has(s.code));
  }

  function moveTo(code: string, x: number, y: number): void {
    const k = findKey(code);
    if (k) {
      k.x = x;
      k.y = y;
    } else {
      layout.keys.push({ code, x, y });
    }
    render();
    ripple(code);
    save();
  }

  function removeKey(code: string): void {
    const el = els.get(code);
    layout.keys = layout.keys.filter((k) => k.code !== code);
    if (selected === code) selected = null;
    save();
    if (el) {
      // iOS と同じく、すぼんで消える
      el.classList.add("is-gone");
      el.addEventListener("animationend", () => render(), { once: true });
      window.setTimeout(render, 400); // animationend が来ない環境の保険
    } else {
      render();
    }
    drawTools();
  }

  function resize(delta: number): void {
    layout.size = Math.min(FREE_SIZE_MAX, Math.max(FREE_SIZE_MIN, layout.size + delta));
    applySize();
    save();
    drawTools();
  }

  function exportJson(): void {
    const blob = new Blob([JSON.stringify(layout, null, 2) + "\n"], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `free-layout-${layout.profile}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function importJson(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      void file.text().then((text) => {
        let parsed: FreeLayout | null = null;
        try {
          parsed = parseFreeLayout(JSON.parse(text));
        } catch {
          parsed = null;
        }
        if (!parsed) {
          say("配置の JSON として読めませんでした");
          return;
        }
        if (parsed.profile !== profile.id) {
          say(`この配置は「${parsed.profile}」用です。物理配置を切り替えてから読み込んでください`);
          return;
        }
        layout = { ...parsed, keys: parsed.keys.filter((k) => geom.has(k.code)) };
        render();
        save();
        say(`${layout.keys.length} キーを読み込みました`);
      });
    });
    input.click();
  }

  // ---- バーの描き直し ----
  function drawTools(): void {
    const parts: HTMLElement[] = [];
    const text = (s: string, cls: string) => {
      const e = document.createElement("span");
      e.className = cls;
      e.textContent = s;
      return e;
    };
    if (mode === "register") {
      const step = steps[idx];
      if (step) {
        const inPhase = steps.filter((s) => s.phase === step.phase);
        const n = inPhase.indexOf(step) + 1;
        const prompt = document.createElement("span");
        prompt.className = "fx-prompt";
        const sub = subLabel(step.code);
        prompt.append(
          text(step.phase === "char" ? `文字キー ${n} / ${inPhase.length}` : `機能キー ${n} / ${inPhase.length}`, "fx-phase"),
          text(`「${mainLabel(step.code)}」`, "fx-target"),
          text(sub ? `（${sub}）を押してください` : "を押してください", "fx-ask"),
        );
        parts.push(prompt);
      }
      parts.push(
        btn("ひとつ戻る", back),
        btn("飛ばす", skip),
        btn("この段を飛ばす", skipRow),
        btn("ここで終える", finishRegister, "is-primary"),
      );
    } else if (mode === "edit") {
      const sizeBox = document.createElement("span");
      sizeBox.className = "fx-size";
      sizeBox.append(btn("−", () => resize(-8)), text(`大きさ ${layout.size}`, "fx-size-val"), btn("＋", () => resize(8)));
      parts.push(sizeBox);
      parts.push(
        btn("登録しなおす", startRegister),
        btn("書き出す", exportJson),
        btn("読み込む", importJson),
        btn("完了", () => setMode("type"), "is-primary"),
      );
      const help = pending
        ? `「${mainLabel(pending)}」を置く場所を押してください`
        : selected
          ? `「${mainLabel(selected)}」の新しい場所を押してください`
          : "ドラッグで動かす・− で外す。キーを押してから別の場所を押しても動かせます";
      parts.push(text(help, "fx-help"));
      const rest = unplaced();
      if (rest.length) {
        const tray = document.createElement("span");
        tray.className = "fx-tray";
        tray.append(text("置いていないキー", "fx-tray-title"));
        for (const s of rest) {
          const chip = btn(mainLabel(s.code), () => {
            pending = pending === s.code ? null : s.code;
            selected = null;
            syncMarks();
            drawTools();
          }, s.code === pending ? "fx-chip is-on" : "fx-chip");
          chip.dataset.code = s.code;
          tray.append(chip);
        }
        parts.push(tray);
      }
    } else {
      parts.push(btn("調整", () => setMode("edit")));
      const now = vp();
      if (layout.viewport.w && (Math.abs(layout.viewport.w - now.w) > 2 || Math.abs(layout.viewport.h - now.h) > 2)) {
        parts.push(text(
          `登録したときと画面の大きさが違います（${layout.viewport.w}×${layout.viewport.h} → ${now.w}×${now.h}）`,
          "fx-warn",
        ));
      }
    }
    if (note) parts.push(text(note, "fx-note"));
    tools.replaceChildren(...parts);
  }

  // ---- 指 ----
  interface Drag { code: string; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  const drags = new Map<number, Drag | null>(); // 調整中: キーを掴んだ指（null = 空いた場所を押した指）
  const typing = new Map<number, string>(); // 打っている指 → キー

  const onDown = (e: PointerEvent) => {
    e.preventDefault();
    try {
      layer.setPointerCapture(e.pointerId);
    } catch {
      // 取れなくても up は layer に来る
    }
    const x = e.clientX;
    const y = e.clientY;
    if (mode === "type") {
      // 中心から直径の 0.8 倍まで（キーの外側へ少しはみ出した指も拾う。手のひらは拾わない）
      const k = nearest(x, y, 0.8);
      if (!k || !opts.onDown(e.pointerId, k.code)) return;
      typing.set(e.pointerId, k.code);
      els.get(k.code)?.classList.add("is-on");
      ripple(k.code);
      return;
    }
    if (mode === "register") {
      registerAt(x, y);
      return;
    }
    // 調整: 「−」は押した瞬間に外す（touchend を止めているので click は来ない）
    const del = (e.target as Element | null)?.closest?.(".fx-del");
    const delCode = del?.closest<HTMLElement>(".fx-key")?.dataset.code;
    if (delCode) {
      removeKey(delCode);
      return;
    }
    const k = nearest(x, y, 0.5);
    drags.set(e.pointerId, k ? { code: k.code, sx: x, sy: y, ox: k.x, oy: k.y, moved: false } : null);
  };

  const onMove = (e: PointerEvent) => {
    const d = drags.get(e.pointerId);
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < MOVE_SLOP) return;
    if (!d.moved) {
      d.moved = true;
      els.get(d.code)?.classList.add("is-lift");
    }
    const k = findKey(d.code);
    if (!k) return;
    k.x = d.ox + dx;
    k.y = d.oy + dy;
    keyEl(k);
  };

  const onUp = (e: PointerEvent) => {
    const code = typing.get(e.pointerId);
    if (code !== undefined) {
      typing.delete(e.pointerId);
      if (![...typing.values()].includes(code)) els.get(code)?.classList.remove("is-on");
      opts.onUp(e.pointerId);
      return;
    }
    if (!drags.has(e.pointerId)) return;
    const d = drags.get(e.pointerId) ?? null;
    drags.delete(e.pointerId);
    if (e.type === "pointercancel") return;
    if (d?.moved) {
      els.get(d.code)?.classList.remove("is-lift");
      save();
      return;
    }
    if (d) {
      // キーを押した（指でもスイッチでも）。トレイから選んでいたら置き場の重なりなので知らせる
      if (pending) {
        say(`そこには「${mainLabel(d.code)}」があります`);
        return;
      }
      selected = selected === d.code ? null : d.code;
      syncMarks();
      ripple(d.code);
      drawTools();
      return;
    }
    // 空いた場所を押した
    const target = pending ?? selected;
    if (!target) return;
    pending = null;
    selected = null;
    syncMarks();
    moveTo(target, e.clientX, e.clientY);
    drawTools();
  };

  layer.addEventListener("pointerdown", onDown);
  layer.addEventListener("pointermove", onMove);
  layer.addEventListener("pointerup", onUp);
  layer.addEventListener("pointercancel", onUp);
  const noMenu = (e: Event) => e.preventDefault();
  layer.addEventListener("contextmenu", noMenu);
  // 連打がダブルタップの拡大に化けない（配列図と同じ）
  const noZoom = (e: Event) => {
    if (e.cancelable) e.preventDefault();
  };
  layer.addEventListener("touchend", noZoom, { passive: false });
  layer.addEventListener("dblclick", noZoom);
  const onResize = () => {
    if (mode === "type") drawTools();
  };
  window.addEventListener("resize", onResize);

  render();
  if (layout.keys.length === 0) startRegister();
  else setMode("type");

  return {
    get mode() {
      return mode;
    },
    edit(on) {
      setMode(on ? "edit" : "type");
    },
    register: startRegister,
    destroy() {
      for (const id of typing.keys()) opts.onUp(id);
      typing.clear();
      clearTimeout(noteTimer);
      layer.removeEventListener("pointerdown", onDown);
      layer.removeEventListener("pointermove", onMove);
      layer.removeEventListener("pointerup", onUp);
      layer.removeEventListener("pointercancel", onUp);
      layer.removeEventListener("contextmenu", noMenu);
      layer.removeEventListener("touchend", noZoom);
      layer.removeEventListener("dblclick", noZoom);
      window.removeEventListener("resize", onResize);
      tools.replaceChildren();
      layer.remove();
    },
  };
}
