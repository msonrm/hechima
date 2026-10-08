/* 別の端末をキーボードにする — 送り手（タブレット・スマホ等。キーボードだけ）。
 *
 * 変換エンジンは持たない（wasm も辞書も読まない）。キーボードは 2 種類:
 *
 *   - **フリック** … FlickEngine が解決した操作（かな / 機能キー / 文字）をそのまま送る。
 *     盤面そのものが配列なので、かなまでこちらで解決する
 *   - **配列図**（薙刀式・AZIK・NICOLA…） … 「理想的な物理キーボード」として、押した・離したを
 *     送るだけ。配列エンジンは受け手で動き、物理キーボードと同じ経路に入る。こちらは
 *     どの配列で打つかを宣言し（{ t: "layout" }）、キーに刻む文字を配列 JSON から起こす
 *
 * 受け手からは「合成中か」「合成中の末尾」だけが返ってくる（フリックのキー表示の切り替えと
 * ゛゜小 のため）。★末尾は回線を往復するので、**まだ受け手が受け取ったと言っていない分**
 * （ack より後に送ったかな）をこちらで足して先回りする。
 */
import { connect, roomFromHash, REMOTE_KEYMAPS, type LinkStatus, type WireOp } from "../remote/link";
import { keymapLayoutFor, modOf, tapFor, type Mods } from "../remote/keys";
import type { FlickOp } from "../app";
import "./remote.css";

declare const FlickEngine: {
  decodeFlickmap(json: unknown): unknown;
  mount(
    container: HTMLElement,
    map: unknown,
    opts: { onOp(op: FlickOp): void; getComposingTail?: () => string },
  ): { setComposing(on: boolean): void; destroy(): void };
};

interface KeyGeom { code: string; x: number; y: number; w: number; h: number }
interface KeyboardProfile { id: string; name: string; width: number; height: number; keys: KeyGeom[] }

declare const ReplayEngine: {
  KEYBOARD_PROFILES: KeyboardProfile[];
  findProfile(id: string): KeyboardProfile | undefined;
  mountKeyboard(
    container: HTMLElement,
    opts: { profile: KeyboardProfile; labels?: Map<string, string> | null },
  ): {
    element: SVGSVGElement;
    update(pressed: Set<string>): void;
    setLabels(m: Map<string, string> | null): void;
    destroy(): void;
  };
};

declare const KeymapEngine: {
  decodeKeymap(json: unknown, opts?: { layout?: string }): unknown;
  keyCapLabels(km: unknown, opts?: { layout?: string }): Map<string, string>;
};

const STATUS_TEXT: Record<LinkStatus, string> = {
  signal: "中継につないでいます…",
  waiting: "受け手（変換する側のページ）を待っています",
  connecting: "直接つないでいます…",
  open: "つながりました",
  failed: "直接つながりませんでした。同じ Wi-Fi にいるか確かめてください",
};

const MODE_KEY = "lll-remote-kbd-mode";
const PROFILE_KEY = "lll-remote-kbd-profile";
const FLICK = "flick";

const $ = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
const statusEl = $<HTMLElement>(".kb-status");
const areaEl = $<HTMLElement>(".kb-area");
const modeSel = $<HTMLSelectElement>(".kb-mode");
const profileSel = $<HTMLSelectElement>(".kb-profile");
const room = roomFromHash();

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 覚えられないだけ
  }
}

/** 画面を消さない（打っている間にスリープしないように）。対応していなければ何もしない */
let wakeLock: { release(): Promise<void> } | null = null;
async function keepAwake(): Promise<void> {
  const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };
  if (wakeLock || !nav.wakeLock || document.visibilityState !== "visible") return;
  try {
    wakeLock = await nav.wakeLock.request("screen");
  } catch {
    wakeLock = null;
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    wakeLock = null; // 裏へ回ると OS が解く
    void keepAwake();
  }
});

/** 配列 JSON（一度読んだら覚えておく） */
const keymapJson = new Map<string, unknown>();
async function fetchKeymap(id: string): Promise<unknown> {
  const hit = keymapJson.get(id);
  if (hit) return hit;
  const res = await fetch(`/vendor/keymaps/${id}.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json: unknown = await res.json();
  keymapJson.set(id, json);
  return json;
}

async function main(): Promise<void> {
  if (!statusEl || !areaEl || !modeSel || !profileSel) return;
  if (!room) {
    statusEl.textContent = "部屋がわかりません。受け手のページに出ている QR から開いてください";
    statusEl.dataset.state = "failed";
    return;
  }

  // ---- 選択肢 ----
  modeSel.innerHTML = [`<option value="${FLICK}">フリック</option>`,
    ...REMOTE_KEYMAPS.map((id) => `<option value="${id}">${id}</option>`)].join("");
  profileSel.innerHTML = ReplayEngine.KEYBOARD_PROFILES.map(
    (p) => `<option value="${p.id}">${p.name}</option>`,
  ).join("");
  const savedMode = load(MODE_KEY);
  modeSel.value = savedMode && [...modeSel.options].some((o) => o.value === savedMode) ? savedMode : FLICK;
  const savedProfile = load(PROFILE_KEY);
  profileSel.value = savedProfile && ReplayEngine.findProfile(savedProfile) ? savedProfile : "jis";
  // 表示名は配列 JSON の name から（読めたものから差し替える）
  for (const id of REMOTE_KEYMAPS) {
    void fetchKeymap(id).then((json) => {
      const name = (json as { name?: unknown }).name;
      const opt = [...modeSel.options].find((o) => o.value === id);
      if (opt && typeof name === "string") opt.textContent = name;
    }).catch(() => { /* 読めない配列は id のまま */ });
  }

  // ---- 受け手の状態（＋まだ届いていない分の先回り） ----
  let seq = 0;
  let remoteTail = "";
  let remoteComposing = false;
  const inflight: { seq: number; op: WireOp }[] = [];

  function tail(): string {
    let t = remoteTail;
    for (const p of inflight) {
      if (p.op.type !== "kana") continue;
      const chars = Array.from(t);
      t = (p.op.replace > 0 ? chars.slice(0, -p.op.replace).join("") : t) + p.op.text;
    }
    return t;
  }
  const composingNow = () => remoteComposing || inflight.some((p) => p.op.type === "kana");

  /** 1 操作を送る。つながっていなければ false */
  function send(op: WireOp): boolean {
    seq += 1;
    if (!link.send({ t: "op", seq, op })) {
      seq -= 1;
      flash();
      return false;
    }
    inflight.push({ seq, op });
    void keepAwake();
    return true;
  }

  /** つながっていないのに打った */
  function flash(): void {
    statusEl?.classList.remove("is-flash");
    void statusEl?.offsetWidth;
    statusEl?.classList.add("is-flash");
  }

  /** どの配列で打つかを受け手へ（フリックは null = かなで送るので配列は要らない） */
  function declareLayout(): void {
    const mode = modeSel?.value ?? FLICK;
    link.send({
      t: "layout",
      keymap: mode === FLICK ? null : mode,
      layout: keymapLayoutFor(profileSel?.value ?? "jis"),
    });
  }

  // ---- 盤面 ----
  let board: { setComposing(on: boolean): void; destroy(): void } | null = null;
  const flickMap = FlickEngine.decodeFlickmap(await (await fetch("/vendor/flick/flick_standard.json")).json());

  function mountFlick(area: HTMLElement): NonNullable<typeof board> {
    area.style.setProperty("--kb-ratio", String(5 / 3.2));
    const kbd = FlickEngine.mount(area, flickMap, {
      getComposingTail: tail,
      onOp(op) {
        if (op.type === "layer") return; // 盤面の切り替えはこちらの中で閉じる
        if (send(op)) kbd.setComposing(composingNow());
      },
    });
    return kbd;
  }

  /**
   * 配列図。多指で押せる（指ごとに pointerId で追う）。押した瞬間に keydown、離したら keyup。
   * 押したあと指が滑っても別のキーにはしない（物理キーボードと同じく、押したキーが離れるまで続く）
   */
  function mountKeys(area: HTMLElement, keymapId: string): NonNullable<typeof board> {
    const profile = ReplayEngine.findProfile(profileSel?.value ?? "jis") ?? ReplayEngine.KEYBOARD_PROFILES[0];
    const layout = keymapLayoutFor(profile.id);
    const top = Math.min(...profile.keys.map((k) => k.y));
    area.style.setProperty("--kb-ratio", String(profile.width / (profile.height - top)));
    const kbd = ReplayEngine.mountKeyboard(area, { profile });
    void fetchKeymap(keymapId).then((json) => {
      try {
        const labels = KeymapEngine.keyCapLabels(KeymapEngine.decodeKeymap(json, { layout }), { layout });
        kbd.setLabels(labels.size > 0 ? labels : null);
      } catch {
        // 刻印は物理のまま（打つ分には困らない）
      }
    }).catch(() => { /* 同上 */ });

    const pointers = new Map<number, { code: string; tap: Hechima.KeyTap }>();
    const mods: Mods = { shift: false, ctrl: false, alt: false };
    const refresh = () => {
      for (const m of ["shift", "ctrl", "alt"] as const) {
        mods[m] = [...pointers.values()].some((p) => modOf(p.code) === m);
      }
      kbd.update(new Set([...pointers.values()].map((p) => p.code)));
    };

    /** 画面上の点 → キー（盤面の座標系 u に直して、矩形に入るキーを探す） */
    function hit(clientX: number, clientY: number): string | null {
      const svg = kbd.element;
      const r = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;
      if (!r.width || !vb.width) return null;
      const u = vb.width / profile.width; // 1u のピクセル数（viewBox 内）
      const x = (vb.x + (clientX - r.left) * vb.width / r.width) / u;
      const y = (vb.y + (clientY - r.top) * vb.height / r.height) / u;
      const k = profile.keys.find((k) => x >= k.x && x < k.x + k.w && y >= k.y && y < k.y + k.h);
      return k ? k.code : null;
    }

    const onDown = (e: PointerEvent) => {
      const code = hit(e.clientX, e.clientY);
      if (!code) return;
      e.preventDefault();
      if ([...pointers.values()].some((p) => p.code === code)) return; // 同じキーを別の指で
      try {
        area.setPointerCapture(e.pointerId);
      } catch {
        // 取れなくても up は area に来る
      }
      const tap = tapFor(code, profile.id, mods);
      pointers.set(e.pointerId, { code, tap });
      refresh();
      send({ type: "keydown", tap });
    };
    const onUp = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      pointers.delete(e.pointerId);
      refresh();
      send({ type: "keyup", tap: p.tap });
    };
    area.addEventListener("pointerdown", onDown);
    area.addEventListener("pointerup", onUp);
    area.addEventListener("pointercancel", onUp);
    // 長押しのメニューや拡大鏡を出さない
    const noMenu = (e: Event) => e.preventDefault();
    area.addEventListener("contextmenu", noMenu);
    // ★**連打がダブルタップの拡大に化ける**（iPad の実機で BS を連打して拡大され、戻せなくなった）。
    // touch-action だけでは止まらないので、FlickEngine（v1.1.1）と同じく touchend の既定動作を止める。
    // 配列図は pointer イベントだけで動いていて click を使わないので、止めても失うものは無い
    const noZoom = (e: Event) => {
      if (e.cancelable) e.preventDefault();
    };
    area.addEventListener("touchend", noZoom, { passive: false });
    area.addEventListener("dblclick", noZoom);

    return {
      setComposing() { /* 配列図は表示を切り替えない */ },
      destroy() {
        // 押しっぱなしのまま盤面を替えたら、離したことにする
        for (const p of pointers.values()) send({ type: "keyup", tap: p.tap });
        pointers.clear();
        area.removeEventListener("pointerdown", onDown);
        area.removeEventListener("pointerup", onUp);
        area.removeEventListener("pointercancel", onUp);
        area.removeEventListener("contextmenu", noMenu);
        area.removeEventListener("touchend", noZoom);
        area.removeEventListener("dblclick", noZoom);
        kbd.destroy();
      },
    };
  }

  function remount(): void {
    if (!areaEl || !modeSel || !profileSel) return;
    board?.destroy();
    areaEl.replaceChildren();
    const mode = modeSel.value;
    document.body.dataset.mode = mode === FLICK ? "flick" : "keys";
    profileSel.hidden = mode === FLICK; // 物理配置はフリックには関係ない
    board = mode === FLICK ? mountFlick(areaEl) : mountKeys(areaEl, mode);
    board.setComposing(composingNow());
  }

  modeSel.addEventListener("change", () => {
    save(MODE_KEY, modeSel.value);
    remount();
    declareLayout();
  });
  profileSel.addEventListener("change", () => {
    save(PROFILE_KEY, profileSel.value);
    remount();
    declareLayout();
  });

  function onStatus(s: LinkStatus): void {
    if (!statusEl) return;
    statusEl.textContent = STATUS_TEXT[s];
    statusEl.dataset.state = s;
    if (s === "open") {
      // 回線ごとに番号を振り直す（受け手も回線ごとに 0 から数える）
      seq = 0;
      inflight.length = 0;
      declareLayout();
      void keepAwake();
    }
  }

  const link = connect(room, "keyboard", {
    onStatus,
    onMessage(m) {
      if (m.t !== "state") return;
      while (inflight.length && inflight[0].seq <= m.ack) inflight.shift();
      remoteTail = m.tail;
      remoteComposing = m.composing;
      board?.setComposing(composingNow());
    },
  });
  onStatus("signal");
  remount();
}

void main();
