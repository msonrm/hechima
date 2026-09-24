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
    // キャレットを置く場所（打鍵中の文の途中を直しているとき）。null = 未確定表示の直後
    let caretAt: { node: Text; offset: number } | null = null;
    if (view.typing) {
      const span = document.createElement("span");
      span.className = "cmp-typing";
      const chars = [...view.typing];
      const midCaret = view.caret < chars.length;
      // 誤打マーク（§2.4(a)）。**色は付けず、その区間だけ下線を波線にする**（目立たせない）。
      // 区切り目 = マークの端とキャレット。文字列をそこで割って、マークの区間だけ span に包む
      const cuts = new Set<number>([0, chars.length]);
      for (const m of view.typingMarks) { cuts.add(m.start); cuts.add(m.end); }
      if (midCaret) cuts.add(view.caret);
      const points = [...cuts].sort((a, b) => a - b);
      for (let i = 0; i + 1 < points.length; i++) {
        const a = points[i]!, b = points[i + 1]!;
        const text = document.createTextNode(chars.slice(a, b).join(""));
        if (view.typingMarks.some((m) => m.start <= a && b <= m.end)) {
          const mark = document.createElement("span");
          mark.className = "cmp-typo";
          mark.append(text);
          span.append(mark);
        } else {
          span.append(text);
        }
        // キャレットは区切り目の直後の文字の手前 = この断片の先頭
        if (midCaret && a === view.caret) caretAt = { node: text, offset: 0 };
      }
      parts.push(span);
    }
    el.replaceChildren(...parts);
    if (caretAt) {
      // 途中を直している。キャレットをかなカーソルの位置へ（§2.4 / 4b-0）
      this.setCaretIn(caretAt.node, caretAt.offset);
    } else {
      // 打鍵中はキャレットを未確定表示の直後に置き直す
      this.setCaretAfter(el);
    }
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

  private setCaretIn(node: Text, offset: number): void {
    const sel = window.getSelection();
    if (!sel) return;
    const r = document.createRange();
    r.setStart(node, offset);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
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
