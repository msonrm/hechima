# 組み込みガイド（最小版）

hechima のエンジンは**ビルド済みの UMD バンドル**として本リポジトリに同梱してあり、
自分のページへ組み込んで使えます（自作部分 MIT。変換エンジンは **powered by Mozc**）。

このドキュメントは「動かすまで」に必要な最小限だけを扱います。各 API の網羅的な仕様は
同梱の型定義 [`site/public/vendor/hechima/hechima.d.ts`](site/public/vendor/hechima/hechima.d.ts)
（cb 契約の明文化を兼ねる手書き d.ts）を参照してください。

> **安定性について**: hechima はまだ実験段階のプロジェクトです。バージョンは SemVer で
> 付けていますが、層をまたぐ破壊的変更（下記「版の組み合わせ」）は現在も起きています。
> より詳しい組み込みガイド（配列定義フォーマット・へちま蔓プロトコル・KeyAction 仕様等）は
> **要望に応じて公開**します。必要になったら Issue でお知らせください。

## 1. 何が配られているか

すべて `site/public/vendor/` 以下にあります（版の正典は
[`site/public/vendor/VENDOR.md`](site/public/vendor/VENDOR.md)）。

| ディレクトリ | 中身 | 役割 |
|---|---|---|
| `hechima/` | `hechima.js` / `hechima-worker.js` / `hechima.d.ts` | 変換セッション層。よみ合成 → 変換 → 文節候補選択 → 確定 → 学習 / 確定アンドゥ / 再変換の状態機械。**UI は持たない** |
| `keymap-engine/` | `keymap-engine.js` | 配列エンジン。キーイベント → かな。論理配列は JSON 定義（ローマ字・薙刀式・NICOLA 等）。同時打鍵/相互シフト/SandS 対応 |
| `hechima-wasm/` | `hechima-wasm.js` / `.wasm` / `mozc.data` | 変換エンジン本体（Mozc の Emscripten ビルド）。かな列 → 文節/候補 |
| `flick/` | `flick-engine.js` / `flick_standard.json` | 12 キーフリック入力フロント（タッチ端末向け） |
| `gamepad/` | `gamepad-engine.js` | ゲームパッド日本語入力フロント |
| `keymaps/` | `naginata_jis.json` / `naginata_us.json` | 配列定義（薙刀式）のサンプル |

`hechima.js` + `keymap-engine.js` は約 29KB / 62KB。`mozc.data`（辞書）が 18.9MB あり、
初回だけダウンロードが走ります（以後はブラウザキャッシュ）。

> 辞書を縮めたい場合: worker（v0.15.0+）は `<dataUrl>.gz` を先に取りにいき、あれば
> `DecompressionStream` で展開します（12.8MB / -33%）。無ければ素の `mozc.data` に落ちるので、
> **置かなくても動きます**。`.gz` は同梱していないので、必要なら配信側で作ってください
> （本リポジトリではビルド時に生成 = [`site/scripts/gzip-dict.mjs`](site/scripts/gzip-dict.mjs)）。
> CDN の自動圧縮は content-type の許可リストで決まり、`.data` は対象外になりがち、というのが背景です。

いずれも **UMD**（グローバル名 `Hechima` / `KeymapEngine` / `FlickEngine` / `GamepadEngine`）で、
素の `<script>`・Worker の `importScripts`・node の `require` の 3 通りで読めます。
バンドラは不要です。

> node で `require` する場合の注意: `package.json` に `"type": "module"` が効いている
> ディレクトリ配下だと UMD が ESM 扱いになり、`require()` の戻り値が空になります
> （エクスポートは `globalThis.Hechima` 等に付く）。テストスクリプトを置く場所に注意するか、
> `globalThis` 側を見てください。

## 2. 先に知っておくべき制約 — 特別なヘッダは要りません

**2026-07-25 以降、COOP/COEP は不要になりました。**

以前の `hechima-wasm` は pthreads ビルドで `SharedArrayBuffer` を要求したため、組み込み先の
ページを cross-origin isolated にする（= `Cross-Origin-Opener-Policy: same-origin` と
`Cross-Origin-Embedder-Policy: require-corp` をレスポンスヘッダで配る）必要がありました。
これはサーバ側の権限が要るうえ、**COEP がページ全体に効いて CORP 無しの外部リソース
（他ドメインの iframe・画像・スクリプト等）を同居させられなくなる**という強い制約でした。

現在の `hechima-wasm` は**単スレッドビルド**（`-pthread` なし）で、`SharedArrayBuffer` を
一切使いません。したがって:

- **静的ファイルを置けるだけのホストならどこでも動きます**（GitHub Pages 等のカスタムヘッダを
  設定できない環境、既存ページへの後付け、ブラウザ拡張の中など）
- ページの他の部分に外部リソースを埋めていても影響しません
- 検証したい場合は、`window.crossOriginIsolated` が `false` のまま変換が動くことを確認してください
  （ラボの診断ページ = `/coi-test/` が参照実装です）

移行時の実測では、`SharedArrayBuffer` の参照がグルーコードから消え（0 件）、起動が速くなり
（init 737ms → 156ms）、変換速度は同等でした。iPad Safari の実機でも確認済みです。

> 単スレッドなので重い変換中はその実行コンテキストを占有します。ただし配布物は Worker で
> 動かす前提（`hechima-worker.js`）なので、UI スレッドはブロックされません。

## 3. 最小構成

`site/public/vendor/` の中身を自分のサイトへコピーし、以下のように配線します。

```html
<script src="/vendor/keymap-engine/keymap-engine.js"></script>
<script src="/vendor/hechima/hechima.js"></script>
<script>
  // 1) 変換エンジン（Worker）に接続する
  const worker = new Worker("/vendor/hechima/hechima-worker.js");
  const conn = Hechima.connectWorker(worker, {
    maxCands: 50,                                   // 候補数（既定 9）
    onProgress: (loaded, total) => showProgress(loaded, total),  // 初回の辞書 DL 進捗
  });
  conn.init({
    wasmJs:  "/vendor/hechima-wasm/hechima-wasm.js",
    dataUrl: "/vendor/hechima-wasm/mozc.data",
  });   // await しなくてよい（変換要求は ready まで待機する）

  // 2) セッションを作る（cb = ホスト側の差し替え点）
  const fep = Hechima.createFep({
    show(segments) { renderInline(segments); },     // 未確定表示を描く
    hide()         { clearInline(); },              // 未確定表示を消す
    commit(text)   { clearInline(); insert(text); },// 確定文字列を文書へ（hide → 注入の順）
    hostKey(name)  { injectRealKey(name); },        // 空バッファ時の矢印/BS をホスト文書へ委譲
    ...conn.callbacks(),                            // convert / resize / learn / unlearn を配線
  });
  fep.setActive(true);

  // 3) キーイベントを流す
  addEventListener("keydown", (e) => { if (fep.feed(e)) e.preventDefault(); });
  addEventListener("keyup",   (e) => { fep.feedUp(e); });
</script>
```

`show(segments)` が受け取る文節には、候補選択中なら `candidates` / `candidateIndex` が
載ります。候補ウィンドウをどう描くかは**ホストの自由**です（本リポジトリのラボサイトでは
PC = ポップアップ、スマホ = 横スクロールの候補バー、縦書きページ = 縦組の近接アンカー、と
同じセッション層の上で 3 通りの UI を出しています）。

### cb 契約

`createFep(cb)` に渡すコールバックは**必須 3 点 + 省略可 7 点**です。

| | 必須 | 省略時の挙動 |
|---|---|---|
| `show` / `hide` / `commit` | ✅ | — |
| `hostKey` | | 空バッファ時の矢印/BS が飲まれる |
| `convert` | | フォールバック変換（カナ/かな巡回） |
| `resize` | | 文節伸縮が無害に飲まれる |
| `reconvert` | | `reconvert()` が不成立 |
| `retract` / `unlearn` | | 確定アンドゥが不成立 / 学習が巻き戻らない |
| `learn` | | 学習しない |

`...conn.callbacks()` を展開すれば `convert` / `resize` / `reconvert` / `learn` / `unlearn` は
Mozc に配線されます。各コールバックの正確な型と契約は `hechima.d.ts` にあります。

### 配列（キーマップ）を差し替える

配列を JSON で与えると、ローマ字以外の配列で打てるようになります。

```js
const raw = await (await fetch("/vendor/keymaps/naginata_jis.json")).json();
const engine = new KeymapEngine.InputEngine(KeymapEngine.decodeKeymap(raw));
engine.onStateChange = () => fep.pumpEngine();      // 同時打鍵の窓満了通知（配線は必須）
fep.setEngine(engine, (tap) => KeymapEngine.keyEventFromBrowser(tap));

fep.setEngine(null);                                // null で内蔵ローマ字に戻る
```

## 4. 実装上の注意（実機で踏んだもの）

- **worker のロード失敗は沈黙する**。`connectWorker` は `error` イベントを見ないため、
  worker スクリプトが 404 だと `init()` が返らないままハングします。
  `worker.addEventListener("error", ...)` をホスト側で必ず付けてください。
- **iOS Safari の COI × キャッシュ事象**。cross-origin isolated なサイトで、URL 欄からの
  再 navigation 後にキャッシュ済み応答が誤ってブロックされ、CSS や worker だけ読めなくなる
  事象を実機で踏んでいます。**単スレッド化（2026-07-25）で COOP/COEP を撤去したため、
  この事象の前提そのものが消えました**。当時の多層防御のうち小型アセットの `Cache-Control:
  no-store` は撤去し、worker の `?t=` キャッシュバストと各 HTML のインライン復旧スクリプトだけ
  残してあります（経緯は [`site/public/_headers`](site/public/_headers) のコメント）。
  **COOP/COEP を配らない組み込み先では、そもそも踏みません**。
- **タッチ端末では OS のソフトキーボードを抑止する**。エディタ要素に `inputmode="none"` を
  立てると、フォーカスしても OS キーボードが出ません（物理キーボードの keydown は影響を
  受けません）。フリック/ゲームパッド入力フロントを使う場合は必須です。

## 5. 版の組み合わせ

層をまたいで最低版の要求があります。**セットで差し替えてください**。**検証済みの組み合わせは
同梱のもの**（[`VENDOR.md`](site/public/vendor/VENDOR.md) の表）だけです。片方だけ新しくすると、
下記のように「動くが挙動が壊れる」形で出ます。

- `hechima` v0.16.0+ → **KeymapEngine >= 1.6.0** 必須。混ぜると逐次系の配列 JSON で
  **Space が「よみのまま確定」になります**（v0.16.0 で Space の意味は状態で分かれた =
  composing 中は変換 / 空バッファなら空白コミット）
- chord 系の配列（薙刀式・NICOLA 等）を使うなら **KeymapEngine >= 1.8.0**。それ未満だと
  **配列によっては Space が死にキーになります**（v1.7.0 = 役に無い Space、v1.8.0 = 役に載って
  いるが `singleTapAction` の宣言が無い Space。どちらも実機で踏んだもの）
- `hechima` v0.13.0+ → KeymapEngine >= 1.4.0（上の条件を満たしていれば自動的に満たされます）
- `flick-engine` / `gamepad-engine` → **hechima >= 0.13.0**（`insertKana`）必須
- タッチ入力フロントの作法（**打ちながら候補 / 候補タップで文節確定 / 配列を通さない機能キー**）を
  使うなら **hechima >= 0.22.0**。それ未満だと `cb.suggest` / `commitSuggestion` /
  `commitFocused` / `feedDirect` / `setSuggest` が無く、**chord 系の配列を選んだページでは
  フリックの「変換」がシフト役に食われて変換できません**（薙刀式の Space = holder1）。
  **追加のみなので、使わないページは差し替えるだけで無変更です**
- `hechima-worker` → `hechima-wasm` v0.7.1 とセット推奨（学習は v0.4.0+。旧 wasm では
  文節伸縮・学習が機能検出で段階的に無効化される）
- **候補の二層化**（v0.14.0 の `createFep(cb, { fold })`）を使う場合のみ、変換コストを返す
  wasm が要ります。`FoldOptions` を渡さなければ候補は従来どおり 1 つの流れなので、
  **二層化を使わないなら wasm は据え置きで構いません**（v0.14.0 への差し替えは単体で完結）

現在同梱している版は [`site/public/vendor/VENDOR.md`](site/public/vendor/VENDOR.md) が正典です。
実行時は `Hechima.version` / `KeymapEngine.version` を記録しておくと事故を追いやすくなります。

## 6. ライセンス

自作部分は MIT（[LICENSE](LICENSE)）。変換エンジンと辞書は Mozc に由来します
（BSD-3-Clause + NAIST License + Public Domain）— **powered by Mozc**。
第三者ライセンスの全文は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) にあります。
組み込んで配布する場合は、この帰属表示を引き継いでください。
