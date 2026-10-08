/* 別の端末をキーボードにする — 受け手（Chromebook 等。変換エンジンはこちら）。
 *
 * ラボの通常ページ（initLabPage）に、フリックキーボードの代わりに「回線」を挿す。
 * initLabPage の flickMount はフリックの盤面を差し替える口で、onOp に FlickOp を流せば
 * 変換・候補・確定までラボの配線がそのまま動く（/flick/ と同じ経路）。ここでは盤面を
 * 描く代わりに、送り手から届いた FlickOp を onOp に流す。
 *
 * 盤面の場所には、つなぐための QR と状態を出す。送り手（タブレットやスマホ）がカメラでこの QR を読むと
 * /remote/keyboard/ が開いて、そのままつながる。部屋の名前は localStorage に覚えておくので、
 * こちらを読み込み直しても送り手はつなぎ直せる。
 */
import qrcode from "qrcode-generator";
import { initLabPage, type FlickMount } from "../app";
import { connect, isRoom, newRoom, keyboardUrl, type Link, type LinkStatus } from "../remote/link";
import "./remote.css";

const ROOM_KEY = "lll-remote-room";

function loadRoom(): string {
  try {
    const r = localStorage.getItem(ROOM_KEY);
    if (isRoom(r)) return r;
  } catch {
    // storage 不可環境 = 読み込み直すたびに新しい部屋
  }
  return saveRoom(newRoom());
}

function saveRoom(room: string): string {
  try {
    localStorage.setItem(ROOM_KEY, room);
  } catch {
    // 同上
  }
  return room;
}

const STATUS_TEXT: Record<LinkStatus, string> = {
  signal: "中継につないでいます…",
  waiting: "キーボード側を待っています。キーボードにする端末のカメラで QR を読んでください",
  connecting: "キーボード側が来ました。直接つないでいます…",
  open: "つながりました。キーボード側で打つと、ここに入ります",
  failed: "直接つながりませんでした。2 台が同じ Wi-Fi にいるか確かめてください",
};

const remoteMount: FlickMount = (container, _map, opts) => {
  container.classList.add("remote-host");
  container.innerHTML = `
    <div class="remote-status" role="status"></div>
    <div class="remote-pair">
      <div class="remote-qr"></div>
      <div class="remote-pair-text">
        <p>キーボード側の端末で、この QR を読むか、次の URL を開いてください。</p>
        <p class="remote-url"><a target="_blank" rel="noopener"></a></p>
        <p><button type="button" class="remote-renew">別の部屋にする</button>
          <small>（いまつながっている端末は切れます）</small></p>
      </div>
    </div>`;
  const statusEl = container.querySelector<HTMLElement>(".remote-status");
  const qrEl = container.querySelector<HTMLElement>(".remote-qr");
  const urlEl = container.querySelector<HTMLAnchorElement>(".remote-url a");
  const renewEl = container.querySelector<HTMLButtonElement>(".remote-renew");

  let link: Link | null = null;
  // 受け取った最後の操作の番号（送り手は回線ごとに 1 から振る）
  let lastSeq = 0;
  let composing = false;
  let stateQueued = false;

  /** いまの状態を送り手へ（表示の更新 1 回ぶんにまとめる） */
  function sendState(): void {
    if (stateQueued) return;
    stateQueued = true;
    queueMicrotask(() => {
      stateQueued = false;
      link?.send({ t: "state", ack: lastSeq, composing, tail: opts.getComposingTail?.() ?? "" });
    });
  }

  function onStatus(s: LinkStatus): void {
    if (statusEl) statusEl.textContent = STATUS_TEXT[s];
    container.classList.toggle("is-open", s === "open");
    if (s === "open") {
      lastSeq = 0;
      sendState();
    }
  }

  function start(room: string): void {
    link?.close();
    const url = keyboardUrl(room);
    if (urlEl) {
      urlEl.href = url;
      urlEl.textContent = url;
    }
    if (qrEl) {
      const qr = qrcode(0, "M");
      qr.addData(url);
      qr.make();
      qrEl.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    }
    onStatus("signal");
    link = connect(room, "host", {
      onStatus,
      onMessage(m) {
        if (m.t !== "op" || m.seq <= lastSeq) return; // 重複・古い回線の残り
        lastSeq = m.seq;
        opts.onOp(m.op);
        sendState();
      },
    });
  }

  renewEl?.addEventListener("click", () => start(saveRoom(newRoom())));
  start(loadRoom());

  return {
    setComposing(on) {
      composing = on;
      sendState();
    },
    destroy() {
      link?.close();
      link = null;
      container.replaceChildren();
      container.classList.remove("remote-host", "is-open");
    },
  };
};

initLabPage({ keymap: "romaji", flick: "on", flickMount: remoteMount });
