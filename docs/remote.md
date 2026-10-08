# 別の端末をキーボードにする（`/remote/`）

タブレットやスマホに出したキーボードで打つと、**別の端末（Chromebook など）のページに文字が入り、
そちらの Mozc で変換される**。変換エンジンは受け手、キーボードは送り手、という分け方。

- 受け手: https://luffa-lang-labo.dev/remote/ （QR を出す）
- 送り手: https://luffa-lang-labo.dev/remote/keyboard/#r=<room> （QR から開く）
- どちらも隠しページ（noindex・TOP から張らない）

## 何を作らなかったか

「変換エンジンを遠くに置く」（へちま蔓 = かな → 文節/候補 をネットワークに延ばす）は**採らなかった**。
受け手はブラウザだけで IME を丸ごと持てる（単スレッドの Mozc wasm がどこでも動く）ので、
1 打鍵ごとに往復してまで遠くのエンジンを使う理由が無い。ネットワークでしかできないのは
**入力する端末と、文字が入る端末を分ける**ことだけで、運ぶのは入力の側。

## 構成

```
送り手（キーボードだけ）                    受け手（変換エンジンはこちら）
  フリック: FlickEngine → かな/機能キー/文字 ─┐      initLabPage の flickMount に「回線」を挿す
  配列図:   押した・離した（KeyTap）        ─┼─ DataChannel ─→ フリック → onOp（/flick/ と同じ配線）
  配列の宣言（layout）                      ─┘   （LAN 直結）    配列図   → onKeyControl（物理キーボードと同じ feed / feedUp）
  ←────────────── 状態（合成中か・末尾）──────────────────────     配列     → onKeymapControl.load
```

- **フリックは送り手でかなまで解く**（盤面そのものが配列なので）。受け手は `insertKana` / `feedDirect` に注ぐだけ
- **配列図は「理想的な物理キーボード」**。押した・離したをそのまま送り、配列エンジンは受け手で動く。
  打ちかけの文字の表示・同時打鍵・編集操作・確定アンドゥが、物理キーボードと同じ実装のまま効く。
  多指は down / up の順として届くので、時間を見ない配列（薙刀式の相互シフト・AZIK の逐次）は
  回線の揺れに判定が左右されない
- **どの配列で打つかはキーボード側が決める**（`layout` の宣言）。受け手の物理キーボードも同じ配列になる
  （配列エンジンが受け手に 1 つしかないため）
- 候補: フリックは帯（`/flick/` と同じ・打ちながら候補つき）、配列図は物理キーボードと同じポップアップ

## 回線

**WebRTC DataChannel**（順序保証・再送あり・DTLS で暗号化）。同じ LAN ならホスト候補で直結する。
STUN（`stun.cloudflare.com`）は候補を足すだけで、TURN は持たない = **打った文字は必ず端末間を直接流れる**。

最初の SDP の受け渡しだけ、Worker の中継を通す（`worker/index.js`）:

- `/api/pair/<room>`（WebSocket）。部屋 = Durable Object 1 個 = **2 人まで**・**何も保存しない**・
  1 メッセージ 16KB まで。入退室のたびに `{ t: "peers", n }` を全員へ
- 部屋の名前は受け手が乱数（16 バイト・base64url）で作り、QR の URL のフラグメント（`#r=`）に載せる。
  知らなければ入れない。受け手は localStorage に覚えるので、**どちらを読み込み直しても再接続の手続きは要らない**
- シグナリングは非トリクル（候補を集め切ってから SDP を 1 通で）。受け手が offer、送り手が answer

### メッセージ（DataChannel の上・JSON）

| 向き | メッセージ | 意味 |
|---|---|---|
| 送り手 → 受け手 | `{ t: "op", seq, op }` | `op` = `kana` / `key` / `text`（フリック）、`keydown` / `keyup`（配列図。`tap` = KeyTap、`code` 必須）。`seq` は回線ごとに 1 から |
| 送り手 → 受け手 | `{ t: "layout", keymap, layout }` | 配列の宣言。`keymap` = `/vendor/keymaps/<id>.json`（`REMOTE_KEYMAPS` にあるものだけ）、`null` = フリック。`layout` = `jis` / `us` |
| 受け手 → 送り手 | `{ t: "state", ack, composing, tail }` | フリックのキー表示（空白 ⇄ 変換）と ゛゜小 のため。候補は送らない |

★`tail` は回線を往復するので、打った直後の ゛ に間に合わないことがある。送り手は **ack より後に送ったかな**
を足して先回りする。

受け手は届いたものを文書へ注ぐので、**形を検査してから通す**（`site/src/remote/link.ts` の `parseOp` / `parsePeerMsg`）。
回線が切れたら、押されたまま届いているキーを離したことにする（同時打鍵の状態を残さない）。

## ファイル

| | |
|---|---|
| `worker/index.js` | シグナリング中継（Durable Object `PairRoom`） |
| `site/src/remote/link.ts` | 接続（シグナリング・WebRTC）とメッセージの型・検査 |
| `site/src/remote/keys.ts` | 配列図の code → key（物理配列ごとの文字表。JIS の Shift+2 は `"`、US は `@`） |
| `site/src/pages/remote.ts` | 受け手 |
| `site/src/pages/remote-keyboard.ts` | 送り手（フリック = FlickEngine、配列図 = ReplayEngine の `mountKeyboard` + `keyCapLabels`） |
| `site/src/app.ts` | `onKeyControl`（キーの押下・解放と候補の出し方）を足した |

## 検査

`site/scripts/browser/check-remote.mjs`（ヘッドレス Chromium の 2 ページ）。接続・フリック・゛゜小・変換と確定・
双方の再接続・配列図（薙刀式の単打 / 親指を押しながら / 同時押し / 変換と確定、AZIK の待っている打鍵）・
連打で拡大しない・候補の出し方。本番に向けて回すのが基本で、ローカルでは Worker の代役 `relay-local.mjs` を使う
（`wrangler dev` が動かない機械があるため。DEPLOY.md）。

**見えないもの**: 同じ機械の中の 2 ページなので、2 台が同じ Wi-Fi で直結できるか（mDNS・クライアント分離）は
実機でしか分からない。実機の結果（2026-10-08、iPad + Chromebook・家の Wi-Fi）: **体感のラグはゼロ**。

## 実機で踏んだもの

- 配列図の BS 連打がダブルタップの拡大に化け、`touch-action: none` のせいでピンチでも戻せなかった
  → 盤面で `touchend` の既定動作を止め（FlickEngine v1.1.1 と同じ）、ページ全体は `manipulation`
