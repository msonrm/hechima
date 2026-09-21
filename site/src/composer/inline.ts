// 経路コンポーザ: 本文の中への描画（docs/composer.md §2.1 全体の形）。
//
// **オーバーレイを持たない。** 標準 IME の未確定表示と同じく、ホストの contenteditable の
// キャレット位置に span を一つ挿し、その中に三層のうち二層（変換済み未確定 / 打鍵中）を描く。
// 確定した文はホストのものなので、この span の**手前**へ素のテキストとして落とす。
//
//   … 会議は来週に延びた。 [ 今日は雨だ。 昨日は晴れだった。 でもきょうはあめ ] ▍
//     └ ホストのもの ────┘ └───────── この span ──────────┘
//
// 旧案の block.ts（矩形）と placement.ts（配置）を置き換えたもの。配置の問題は消えた。

import type { FlowView } from "./flow";

export class Inline {
  private el: HTMLSpanElement | null = null;

  constructor(private readonly host: HTMLElement) {}

  /** 未確定の span。無ければキャレット位置に作る */
  private ensure(): HTMLSpanElement {
    if (this.el?.isConnected) return this.el;
    const span = document.createElement("span");
    span.className = "cmp-composition";
    const range = this.caretRange();
    range.insertNode(span);
    this.el = span;
    return span;
  }

  /** 確定した文をホストへ落とす。**未確定の span より手前**に入れて本文の順序を保つ */
  flush(text: string): void {
    const node = document.createTextNode(text);
    if (this.el?.isConnected && this.el.parentNode) {
      this.el.parentNode.insertBefore(node, this.el);
    } else {
      this.caretRange().insertNode(node);
      this.setCaretAfter(node);
    }
    this.host.normalize();
  }

  render(view: FlowView): void {
    if (!view.settled.length && !view.typing) {
      // 何も抱えていない = 未確定表示は無い。span を畳んでホストを素の本文へ戻す
      if (this.el?.isConnected) {
        const marker = document.createTextNode("");
        this.el.replaceWith(marker);
        this.setCaretAfter(marker);
        this.host.normalize();
      }
      this.el = null;
      return;
    }
    const el = this.ensure();
    const parts: HTMLSpanElement[] = [];
    for (const s of view.settled) {
      const span = document.createElement("span");
      // filled=false は変換待ちのかな。1〜5ms なので普段は目に入らない
      span.className = s.filled ? "cmp-unconfirmed" : "cmp-unconfirmed cmp-pending";
      span.textContent = s.text;
      parts.push(span);
    }
    if (view.typing) {
      const span = document.createElement("span");
      span.className = "cmp-typing";
      span.textContent = view.typing;
      parts.push(span);
    }
    el.replaceChildren(...parts);
    // 打鍵中はキャレットを未確定表示の直後に置き直す。
    // 矢印でキャレットが離れても次の打鍵でここへ戻る（マーク走査は §2.4 = 4b）
    this.setCaretAfter(el);
  }

  private caretRange(): Range {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && this.host.contains(sel.getRangeAt(0).startContainer)) {
      const r = sel.getRangeAt(0).cloneRange();
      r.collapse(false);
      return r;
    }
    const r = document.createRange();
    r.selectNodeContents(this.host);
    r.collapse(false);
    return r;
  }

  private setCaretAfter(node: Node): void {
    const sel = window.getSelection();
    if (!sel) return;
    const r = document.createRange();
    r.setStartAfter(node);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }
}
