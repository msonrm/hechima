// 動くフリック入力（/scroll-flick/）: 指ではなく盤面を動かす、どうでもいい新キーボードのご提案。
//
// フリックは「指がキーの上を動いた向き」で文字を選ぶ。ここでは盤面（中央 3 列）が全体で
// スクロールし続けるので、指を止めたままでも「盤面に対する指の動き」が生まれてフリックになる。
// 判定は **盤面の座標**で行う: 押した瞬間と離した瞬間に「指の下にあった盤面上の点」を求め、
// その差を `FlickEngine.classifyGesture` に渡す。かな表・濁点トグル・レイヤ切替は
// `FlickEngine.createResolver` がそのまま面倒を見るので、このページが持つのは
// 「動く盤面」と「盤面座標での判定」だけ。差し替えの口は app.ts の `flickMount`。
import { initLabPage, type FlickMount, type FlickOp } from "../app";
import "./scroll-flick.css";

type Dir = "up" | "down" | "left" | "right";
type Gesture = { row: number; col: number; kind: "tap" | "flick"; dir?: Dir };

interface FlickKey {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  label: string;
  composingLabel?: string;
  tap: unknown;
  flick: Partial<Record<Dir, unknown>>;
  repeat?: boolean;
}
interface FlickLayer {
  rows: number;
  cols: number;
  keys: FlickKey[];
}
interface FlickMap {
  threshold: number;
  repeatDelayMs: number;
  repeatIntervalMs: number;
  layers: Record<string, FlickLayer>;
}
interface Resolver {
  readonly layer: string;
  keyAt(row: number, col: number): FlickKey | null;
  resolve(g: Gesture): FlickOp[];
}

declare const FlickEngine: {
  createResolver(map: FlickMap, host: { getComposingTail?: () => string }): Resolver;
  classifyGesture(dx: number, dy: number, cellWidth: number, threshold: number): { kind: "tap" | "flick"; dir?: Dir };
};

/** 盤面の動き。単位は「マス」で、速さは 1 マス/秒。盤面の模様は横 3 マス・縦 4 マスで一周するので、
 *  横は 3 秒、縦は 4 秒で元の位置に戻る。vx>0 は盤面が右へ、vy>0 は下へ動く（= 指から見て左・上へフリック） */
const SCHEDULE: readonly { sec: number; vx: number; vy: number }[] = [
  { sec: 3, vx: 0, vy: 0 },
  { sec: 3, vx: 1, vy: 0 },
  { sec: 3, vx: 0, vy: 0 },
  { sec: 4, vx: 0, vy: 1 },
  { sec: 3, vx: 0, vy: 0 },
  { sec: 3, vx: -1, vy: 0 },
  { sec: 3, vx: 0, vy: 0 },
  { sec: 4, vx: 0, vy: -1 },
];
const CYCLE_SEC = SCHEDULE.reduce((sum, p) => sum + p.sec, 0);
const COLS = 3; // 動く部分の列数（左右の機能列は固定）
const ROWS = 4;

/** 周期の中の時刻 t（秒）での盤面のずれ（マス単位）。各フェーズの終わりは整数マスなので継ぎ目なくつながる */
function boardOffset(t: number): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let rest = t % CYCLE_SEC;
  for (const p of SCHEDULE) {
    const dt = Math.min(rest, p.sec);
    x += p.vx * dt;
    y += p.vy * dt;
    rest -= dt;
    if (rest <= 0) break;
  }
  return { x, y };
}

const wrap = (v: number, period: number): number => ((v % period) + period) % period;

function div(cls: string, text?: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

const mountScrollFlick: FlickMount = (container, rawMap, opts) => {
  const map = rawMap as FlickMap;
  const resolver = FlickEngine.createResolver(map, opts);
  const root = div("sf-root");
  container.appendChild(root);

  let composing = false;
  let fixedKeys: [HTMLElement, FlickKey][] = [];
  let field: HTMLElement | null = null;
  let viewport: HTMLElement | null = null;
  let pressBox: HTMLElement | null = null;
  let bubble: HTMLElement | null = null;

  /** 押している指（1 本だけ受ける）。center = 動く盤面のキー、fixed = 左右の固定キー */
  type Center = { pointerId: number; key: FlickKey; bx: number; by: number; cellBx: number; cellBy: number };
  type Fixed = {
    pointerId: number; key: FlickKey; el: HTMLElement; startX: number; startY: number;
    cellW: number; repeatTimer: number | null; repeatFired: boolean;
  };
  let center: Center | null = null;
  let fixed: Fixed | null = null;
  let lastX = 0;
  let lastY = 0;
  const t0 = performance.now();
  let raf = 0;

  const labelFor = (key: FlickKey): string =>
    composing && key.composingLabel !== undefined ? key.composingLabel : key.label;

  function emit(ops: FlickOp[]): void {
    for (const op of ops) {
      if (op.type === "layer") render();
      opts.onOp(op);
    }
  }

  /** 盤面のずれ（px）。左右・上下とも、盤面は枠の大きさで一周する */
  function offsetPx(rect: DOMRect): { x: number; y: number } {
    const o = boardOffset((performance.now() - t0) / 1000);
    return { x: (o.x / COLS) * rect.width, y: (o.y / ROWS) * rect.height };
  }

  /** 指の位置（画面）→ 盤面座標。盤面が動いていても、盤面に張り付いた点は同じ座標のまま */
  function boardPoint(rect: DOMRect, clientX: number, clientY: number): { x: number; y: number } {
    const o = offsetPx(rect);
    return { x: clientX - rect.left - o.x, y: clientY - rect.top - o.y };
  }

  function gestureOf(c: Center, rect: DOMRect, clientX: number, clientY: number): Gesture {
    const b = boardPoint(rect, clientX, clientY);
    const g = FlickEngine.classifyGesture(b.x - c.bx, b.y - c.by, rect.width / COLS, map.threshold);
    return { row: c.key.row, col: c.key.col, kind: g.kind, dir: g.dir };
  }

  function previewText(c: Center, g: Gesture): string {
    const v = g.kind === "tap" ? c.key.tap : g.dir ? c.key.flick[g.dir] : null;
    return typeof v === "string" ? v : "";
  }

  function frame(): void {
    raf = requestAnimationFrame(frame);
    if (!field || !viewport) return;
    const o = boardOffset((performance.now() - t0) / 1000);
    // field は枠の 3 倍の大きさ（模様 3×3 枚）で、真ん中の 1 枚が枠に重なる。
    // translate の % は field 自身の大きさ基準なので、枠基準の割合を 3 で割る
    field.style.transform =
      `translate(${(wrap(o.x / COLS, 1) / 3) * 100}%, ${(wrap(o.y / ROWS, 1) / 3) * 100}%)`;
    if (center && pressBox && bubble) {
      const rect = viewport.getBoundingClientRect();
      const off = offsetPx(rect);
      const cw = rect.width / COLS;
      const ch = rect.height / ROWS;
      // 押したキーは盤面と一緒に流れていく（指の下には残らない）
      pressBox.style.cssText =
        `display:block;width:${cw}px;height:${ch}px;transform:translate(${center.cellBx + off.x}px,${center.cellBy + off.y}px)`;
      const text = previewText(center, gestureOf(center, rect, lastX, lastY));
      bubble.textContent = text;
      bubble.hidden = text === "";
    } else if (pressBox && bubble) {
      pressBox.style.display = "none";
      bubble.hidden = true;
    }
  }

  function onCenterDown(e: PointerEvent): void {
    if (center || fixed || !viewport) return;
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const b = boardPoint(rect, e.clientX, e.clientY);
    const cw = rect.width / COLS;
    const ch = rect.height / ROWS;
    // 模様は枠の大きさで一周するので、盤面座標を一周ぶんに畳めば押したマスが分かる
    const col = 1 + Math.floor(wrap(b.x, rect.width) / cw);
    const row = Math.floor(wrap(b.y, rect.height) / ch);
    const key = resolver.keyAt(row, col);
    if (!key) return;
    viewport.setPointerCapture(e.pointerId);
    lastX = e.clientX;
    lastY = e.clientY;
    center = {
      pointerId: e.pointerId, key, bx: b.x, by: b.y,
      cellBx: Math.floor(b.x / cw) * cw, cellBy: Math.floor(b.y / ch) * ch,
    };
  }
  function onCenterMove(e: PointerEvent): void {
    if (!center || e.pointerId !== center.pointerId) return;
    lastX = e.clientX;
    lastY = e.clientY;
  }
  function onCenterUp(e: PointerEvent): void {
    if (!center || e.pointerId !== center.pointerId || !viewport) return;
    const c = center;
    center = null;
    emit(resolver.resolve(gestureOf(c, viewport.getBoundingClientRect(), e.clientX, e.clientY)));
  }
  function onCenterCancel(e: PointerEvent): void {
    if (center && e.pointerId === center.pointerId) center = null;
  }

  // ---- 左右の固定キー（FlickEngine.mount と同じ動き: タップ・上下フリック・長押しリピート） ----
  function clearFixed(): void {
    if (!fixed) return;
    if (fixed.repeatTimer !== null) clearTimeout(fixed.repeatTimer);
    fixed.el.classList.remove("sf-down");
    fixed = null;
  }
  function onFixedDown(e: PointerEvent, key: FlickKey, el: HTMLElement): void {
    if (center || fixed) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add("sf-down");
    const f: Fixed = {
      pointerId: e.pointerId, key, el, startX: e.clientX, startY: e.clientY,
      cellW: root.clientWidth / 5, repeatTimer: null, repeatFired: false,
    };
    fixed = f;
    if (key.repeat && key.tap !== null) {
      const fire = (): void => {
        if (fixed !== f) return;
        f.repeatFired = true;
        emit(resolver.resolve({ row: key.row, col: key.col, kind: "tap" }));
        f.repeatTimer = window.setTimeout(fire, map.repeatIntervalMs);
      };
      f.repeatTimer = window.setTimeout(fire, map.repeatDelayMs);
    }
  }
  function onFixedUp(e: PointerEvent): void {
    if (!fixed || e.pointerId !== fixed.pointerId) return;
    const { key, startX, startY, cellW, repeatFired } = fixed;
    clearFixed();
    if (repeatFired) return;
    const g = FlickEngine.classifyGesture(e.clientX - startX, e.clientY - startY, cellW, map.threshold);
    emit(resolver.resolve({ row: key.row, col: key.col, kind: g.kind, dir: g.dir }));
  }
  function onFixedCancel(e: PointerEvent): void {
    if (fixed && e.pointerId === fixed.pointerId) clearFixed();
  }

  function render(): void {
    clearFixed();
    center = null;
    root.replaceChildren();
    fixedKeys = [];
    const layer = map.layers[resolver.layer];
    root.dataset.layer = resolver.layer;

    for (const key of layer.keys) {
      if (key.col >= 1 && key.col <= COLS) continue;
      const el = div("sf-key sf-fn", labelFor(key));
      el.style.gridRow = `${key.row + 1} / span ${key.rowSpan}`;
      el.style.gridColumn = `${key.col + 1} / span ${key.colSpan}`;
      el.addEventListener("pointerdown", (e) => onFixedDown(e, key, el));
      el.addEventListener("pointerup", onFixedUp);
      el.addEventListener("pointercancel", onFixedCancel);
      fixedKeys.push([el, key]);
      root.appendChild(el);
    }

    viewport = div("sf-viewport");
    field = div("sf-field");
    for (let i = 0; i < 9; i++) {
      const tile = div("sf-tile");
      for (const key of layer.keys) {
        if (key.col < 1 || key.col > COLS) continue;
        const el = div(Array.from(key.label).length >= 3 ? "sf-key sf-long" : "sf-key", labelFor(key));
        el.style.gridRow = `${key.row + 1} / span ${key.rowSpan}`;
        el.style.gridColumn = `${key.col} / span ${key.colSpan}`;
        tile.appendChild(el);
      }
      field.appendChild(tile);
    }
    pressBox = div("sf-press");
    bubble = div("sf-bubble");
    bubble.hidden = true;
    viewport.append(field, pressBox, bubble);
    viewport.addEventListener("pointerdown", onCenterDown);
    viewport.addEventListener("pointermove", onCenterMove);
    viewport.addEventListener("pointerup", onCenterUp);
    viewport.addEventListener("pointercancel", onCenterCancel);
    root.append(viewport);
  }

  root.addEventListener("mousedown", (e) => e.preventDefault()); // エディタのフォーカスを奪わない
  root.addEventListener("touchend", (e) => e.preventDefault(), { passive: false });
  render();
  raf = requestAnimationFrame(frame);

  return {
    setComposing(on) {
      on = !!on;
      if (composing === on) return;
      composing = on;
      for (const [el, key] of fixedKeys) el.textContent = labelFor(key);
    },
    destroy() {
      cancelAnimationFrame(raf);
      clearFixed();
      root.remove();
    },
  };
};

initLabPage({
  keymap: "romaji",
  flick: "on",
  flickMount: mountScrollFlick,
  keepScrollOnStart: true, // 説明文が上にあるので、起動時のフォーカスでページを下へ飛ばさない
});
