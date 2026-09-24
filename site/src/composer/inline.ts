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

/** 候補一覧（§2.5。見た目は標準 IME の候補ポップアップ、中身は経路の並列） */
export interface PopupView {
  items: string[];
  selected: number;
  /** 候補に添える一言（表記の揺れ: 「この文書では『乱用』（3 文前）」。§2.5） */
  note?: string | null;
}

export class Inline {
  private el: HTMLSpanElement | null = null;
  private popupEl: HTMLDivElement | null = null;

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

  render(view: FlowView, reviewing = false, popup: PopupView | null = null): void {
    if (!view.settled.length && !view.typing) {
      // 何も抱えていない = 未確定表示は無い。span を畳んでホストを素の本文へ戻す
      this.renderPopup(null, null);
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
    let focusedMark: HTMLElement | null = null;
    for (const s of view.settled) {
      const span = document.createElement("span");
      // filled=false は変換待ちのかな。1〜5ms なので普段は目に入らない
      span.className = s.filled ? "cmp-unconfirmed" : "cmp-unconfirmed cmp-pending";
      appendMarked(span, [...s.text], s.marks.map((m) => ({
        ...m, cls: `cmp-${m.kind}${m.focused ? " cmp-focus" : ""}`,
      })));
      focusedMark ??= span.querySelector(".cmp-focus");
      parts.push(span);
    }
    // キャレットを置く場所（打鍵中の文の途中を直しているとき）。null = 未確定表示の直後
    let caretAt: { node: Text; offset: number } | null = null;
    if (view.typing) {
      const span = document.createElement("span");
      span.className = reviewing ? "cmp-typing cmp-reviewing" : "cmp-typing";
      const chars = [...view.typing];
      const midCaret = view.caret < chars.length;
      // 誤打マーク（§2.4(a)）。**色は付けず、その区間だけ背景を薄く塗る**（目立たせすぎない）。
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
    if (focusedMark) {
      // 印に吸い付いている（§2.4「マークへの到達」）。キャレットは印の直後に置く
      this.setCaretAfter(focusedMark);
      this.renderPopup(popup, focusedMark);
      return;
    }
    this.renderPopup(null, null);
    if (caretAt) {
      // 途中を直している。キャレットをかなカーソルの位置へ（§2.4 / 4b-0）
      this.setCaretIn(caretAt.node, caretAt.offset);
    } else {
      // 打鍵中はキャレットを未確定表示の直後に置き直す
      this.setCaretAfter(el);
    }
  }

  /** 候補一覧を印の真下に出す。popup = null なら畳む */
  private renderPopup(popup: PopupView | null, anchor: HTMLElement | null): void {
    if (!popup || !anchor) {
      this.popupEl?.remove();
      this.popupEl = null;
      return;
    }
    if (!this.popupEl) {
      this.popupEl = document.createElement("div");
      this.popupEl.className = "cmp-popup";
      this.popupEl.setAttribute("role", "listbox");
      document.body.append(this.popupEl);
    }
    const rows = popup.items.map((text, i) => {
      const row = document.createElement("div");
      row.className = i === popup.selected ? "cmp-cand cmp-cand-sel" : "cmp-cand";
      row.setAttribute("role", "option");
      const num = document.createElement("span");
      num.className = "cmp-cand-num";
      num.textContent = String(i + 1);
      row.append(num, text);
      return row;
    });
    if (popup.note) {
      const note = document.createElement("div");
      note.className = "cmp-cand-note";
      note.textContent = popup.note;
      rows.push(note);
    }
    this.popupEl.replaceChildren(...rows);
    const r = anchor.getBoundingClientRect();
    this.popupEl.style.left = `${Math.max(8, Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - this.popupEl.offsetWidth - 8))}px`;
    this.popupEl.style.top = `${r.bottom + window.scrollY + 6}px`;
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

/**
 * 文字列を印の区間で割って parent に積む。印の区間だけ cls の span に包む。
 * marks は chars の中の位置（コードポイント）。重ならないこと
 */
function appendMarked(parent: HTMLElement, chars: string[], marks: { start: number; end: number; cls: string }[]): void {
  let at = 0;
  for (const m of [...marks].sort((a, b) => a.start - b.start)) {
    if (m.start > at) parent.append(chars.slice(at, m.start).join(""));
    const mark = document.createElement("span");
    mark.className = m.cls;
    mark.textContent = chars.slice(m.start, m.end).join("");
    parent.append(mark);
    at = m.end;
  }
  if (at < chars.length) parent.append(chars.slice(at).join(""));
}
