/* 別の端末をキーボードにする — 送り手（iPad 等。キーボードだけ）。
 *
 * 変換エンジンは持たない（wasm も辞書も読まない）。フリックの盤面を出し、FlickEngine が
 * 解決した操作（かな / 機能キー / 文字）をそのまま受け手へ送る。変換・候補は受け手の画面で
 * 起き、候補の選択もこちらの「変換」「←→」「確定」キーで受け手に効く。
 *
 * 受け手からは「合成中か」「合成中の末尾」だけが返ってくる:
 *   - 合成中か … キーの表示の切り替え（空白 ⇄ 変換、改行 ⇄ 確定）
 *   - 末尾     … ゛゜小（直前の文字を濁点・半濁点・小書きにする）が何を置き換えるかの計算
 * ★末尾は回線を往復するので、打った直後の ゛ に間に合わないことがある。だから**まだ受け手が
 *   受け取ったと言っていない分**（ack より後に送ったかな）をこちらで足して先回りする。
 */
import { connect, roomFromHash, type LinkStatus, type WireOp } from "../remote/link";
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

const STATUS_TEXT: Record<LinkStatus, string> = {
  signal: "中継につないでいます…",
  waiting: "受け手（変換する側のページ）を待っています",
  connecting: "直接つないでいます…",
  open: "つながりました",
  failed: "直接つながりませんでした。同じ Wi-Fi にいるか確かめてください",
};

const statusEl = document.querySelector<HTMLElement>(".pad-status");
const areaEl = document.querySelector<HTMLElement>(".pad-area");
const room = roomFromHash();

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

async function main(): Promise<void> {
  if (!statusEl || !areaEl) return;
  if (!room) {
    statusEl.textContent = "部屋がわかりません。受け手のページに出ている QR から開いてください";
    statusEl.dataset.state = "failed";
    return;
  }

  // ---- 受け手の状態（＋まだ届いていない分の先回り） ----
  let seq = 0;
  let ack = 0;
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

  const res = await fetch("/vendor/flick/flick_standard.json");
  const map = FlickEngine.decodeFlickmap(await res.json());
  const kbd = FlickEngine.mount(areaEl, map, {
    getComposingTail: tail,
    onOp(op) {
      if (op.type === "layer") return; // 盤面の切り替えはこちらの中で閉じる
      seq += 1;
      if (!link.send({ t: "op", seq, op })) {
        seq -= 1;
        flash();
        return;
      }
      inflight.push({ seq, op });
      kbd.setComposing(composingNow());
      void keepAwake();
    },
  });

  function onStatus(s: LinkStatus): void {
    if (!statusEl) return;
    statusEl.textContent = STATUS_TEXT[s];
    statusEl.dataset.state = s;
    if (s === "open") {
      // 回線ごとに番号を振り直す（受け手も回線ごとに 0 から数える）
      seq = 0;
      ack = 0;
      inflight.length = 0;
      void keepAwake();
    }
  }

  /** つながっていないのに打った */
  function flash(): void {
    statusEl?.classList.remove("is-flash");
    void statusEl?.offsetWidth;
    statusEl?.classList.add("is-flash");
  }

  const link = connect(room, "pad", {
    onStatus,
    onMessage(m) {
      if (m.t !== "state") return;
      ack = m.ack;
      while (inflight.length && inflight[0].seq <= ack) inflight.shift();
      remoteTail = m.tail;
      remoteComposing = m.composing;
      kbd.setComposing(composingNow());
    },
  });
  onStatus("signal");
}

void main();
