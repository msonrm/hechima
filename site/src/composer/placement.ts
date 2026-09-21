// 経路コンポーザ: 配置（docs/composer.md §2.6 / §4.4）。
//
// **配置は未決のまま作る。** 案 A（画面中央固定）と案 B（キャレット追従）を両方持ち、
// 既定は実地の比較（§4.4）で決める。ブロック内部のレイアウトはどちらでも同じなので、
// ここは外枠の座標だけを扱う。

export type Placement = "center" | "caret";

/** 画面端とキャレットから空ける余白 */
const GAP = 8;

export interface CaretSource {
  /** キャレットの画面座標（案 B が使う）。取れないときは null */
  caretRect(): DOMRect | null;
}

export function applyPlacement(el: HTMLElement, mode: Placement, src: CaretSource): void {
  const w = el.offsetWidth;
  const h = el.offsetHeight;

  if (mode === "center") {
    // 案 A: 画面中央固定。視線が動かないこと自体が利点なので、キャレットは参照しない
    el.style.left = `${Math.round((window.innerWidth - w) / 2)}px`;
    el.style.top = `${Math.round((window.innerHeight - h) / 2)}px`;
    return;
  }

  const r = src.caretRect();
  if (!r) {
    // キャレットが取れない（フォーカスが外れた等）ときは動かさない。
    // 位置を原点に飛ばすとブロックが画面の隅へ跳ねて比較の邪魔になる
    return;
  }

  // 案 B: **キャレットの上に出す**（§2.6）。ブロックは「矩形（上）＋1行欄（下）」なので、
  // 上に出すと 1行欄がキャレットに隣接する。打鍵中の目は1行欄にあり、ホストのキャレットは
  // 「テキストが着地する場所」を示す静止したアンカーなので、この二つは近いほうがよい。
  // 上に余裕がないときだけ、やむなく下に出す
  const left = clamp(r.left, GAP, Math.max(GAP, window.innerWidth - w - GAP));
  const above = r.top - GAP - h;
  const top = above >= GAP ? above : Math.min(r.bottom + GAP, window.innerHeight - h - GAP);
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(Math.max(GAP, top))}px`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
