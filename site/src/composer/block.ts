// 経路コンポーザ: 矩形と1行欄の DOM（docs/composer.md §2.1 寸法 / §2.3 上詰めと窓）。
//
// **高さは固定で、可変にしない**（§2.1 の最重要決定）。3 文が 6 行を超えるのは 2.4% だが、
// 可変にすると 100% の場面で「どこまで覆うか」が読めなくなる。溢れは高さではなく
// 窓で処理する（バッファ 3 文 ≠ 表示 6 行。§2.3）。

import type { FlowView } from "./flow";

/** 矩形の行数 = 窓の高さ（§2.1。連続 3 文がすべて見える率 97.6%） */
export const RECT_LINES = 6;

/** 矩形と1行欄の幅（全角字）。16px 等幅で約 640px（§2.1） */
export const RECT_COLS = 40;

export class Block {
  readonly el: HTMLDivElement;
  private readonly rect: HTMLDivElement;
  private readonly inner: HTMLDivElement;
  private readonly tail: HTMLSpanElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "cmp-block";
    // ホストの本文をクリックできるようにする。ホバー検出は index.ts が座標で行う
    this.el.style.pointerEvents = "none";
    this.el.setAttribute("aria-hidden", "true");
    this.el.style.setProperty("--cmp-cols", String(RECT_COLS));
    this.el.style.setProperty("--cmp-lines", String(RECT_LINES));

    this.rect = document.createElement("div");
    this.rect.className = "cmp-rect";
    this.inner = document.createElement("div");
    this.inner.className = "cmp-rect-inner";
    this.rect.appendChild(this.inner);

    const tailRow = document.createElement("div");
    tailRow.className = "cmp-tail";
    this.tail = document.createElement("span");
    this.tail.className = "cmp-tail-text";
    const caret = document.createElement("span");
    caret.className = "cmp-caret";
    tailRow.append(this.tail, caret);

    this.el.append(this.rect, tailRow);
  }

  render(view: FlowView): void {
    // 要素数は最大でも 3（バッファ 3 文）なので毎回作り直してよい
    this.inner.textContent = "";
    for (const line of view.lines) {
      const p = document.createElement("p");
      p.className = line.settled ? "cmp-line cmp-settled" : "cmp-line cmp-current";
      p.textContent = line.text;
      this.inner.appendChild(p);
    }
    this.tail.textContent = view.tail;
    // 内容は上詰め（§2.3）。6 行に収まっている間はここが効かず、溢れたときだけ
    // 最新 6 行の窓になる。0.04% の「窓を空にしても入らない 1 文」も末尾が出る
    this.rect.scrollTop = this.rect.scrollHeight;
  }

  /** 隠す操作（§2.6）。表示だけを消す。バッファは生きたまま */
  setDimmed(on: boolean): void {
    this.el.classList.toggle("cmp-dimmed", on);
  }
}
