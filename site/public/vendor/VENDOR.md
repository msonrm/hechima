# vendored 成果物の pin 記録

すべて logical-layout-labo（開発本家）のタグ付き成果物を pin して同梱する。
差し替えるときは必ずこのファイルも更新すること。

| ディレクトリ | 版 | 取得元 |
|---|---|---|
| `hechima/`（hechima.js / hechima-worker.js / hechima.d.ts） | **v0.14.0** | labo main `cc2d7c8` の `web/public/hechima/`。**v0.14.0 = 候補の二層化**（`FoldOptions` / `expandCandidates` / `collapseCandidates` / `setFold` + `WireSegment.costs`）。**追加のみで、渡さなければ挙動は従来どおり** = 二層化を使わないページは差し替えるだけで無変更（golden で固定済み）。使うには costs を返す wasm が要る（`hechima-wasm-cost/`）。v0.13.1 = BS で素通しローマ字まで戻ったときの pending 復帰、v0.13.0 = `insertKana`（フリック入力の配線先） |
| `flick/`（flick-engine.js / flick_standard.json） | **v1.1.1** | labo main `98cd721` の `web/public/flick/` + `web/public/flickmaps/`（v1.1.0 = 配置改訂・戻す/カーソルフリック・composingLabel・ペタル抑制、v1.1.1 = root touchend preventDefault のズーム対策。hechima v0.13.0+ とセット） |
| `gamepad/`（gamepad-engine.js） | **v1.7.0** | labo main の `web/public/gamepad/`（ゲームパッド日本語入力フロント。日本語のみ。GamepadOp = flick と同じ kana/key 二語彙。v1.1.0 左スティック nav、v1.2.0 文節伸縮 RT+←→ / 確定アンドゥ Start、v1.3.0 未入力時 L🕹↓=カーソル下 + 句読点連打窓 600ms、v1.3.1 ビジュアライザ調整、v1.4.0 RT 連打サイクル ん→を→んを + 拗音後の濁点 きゃ→ぎゃ、v1.5.0 非合成時 RT+LS 上下左右=範囲選択（Shift+矢印）、v1.6.0 非合成の LS カーソル移動/範囲選択にキーリピート（400ms→85ms）、**v1.7.0 RT+Start=やり直し（Ctrl+y を emit）**。hechima v0.13.0+（insertKana）必須。範囲削除=BS で選択削除・再変換=Start・**文書 redo=Ctrl+y** は hechima ホスト側 app.ts で対応） |
| `keymap-engine/`（keymap-engine.js） | **v1.4.0** | labo main `84199d5` の `web/public/engine/`（英数モードの chord 解釈 = H+J 日本語復帰 / space+X 大文字 + mutual 再入バグ修正） |
| `hechima-wasm/`（hechima-wasm.js / .wasm / mozc.data） | **v0.7.1 + 単スレッド化**（2026-07-25） | 機能は Release `hechima-wasm-v0.7.1`（ユーザー辞書 + よみの Mozc 純正検証）と同じで、**`-pthread` なしで焼き直したもの**。js/wasm = labo `verify/wasm-single-thread` `c0e13b9` の CI artifact `hechima-wasm-singlethread`（run 30134214247）／provenance: fcitx5-mozc `522a5f2` / emsdk 3.1.69 / `patches/single_thread.patch` 適用（同梱 BUILD_INFO.txt）。**SharedArrayBuffer / pthread の参照ゼロ = COOP/COEP 不要**（init 737→156ms・js -19%・変換速度は同等）。`mozc.data` は v0.7.1 のものをそのまま継続使用（ビルド設定と無関係のため）。**pthread 版へ戻すときは git 履歴から**（`site/public/vendor/hechima-wasm/` の 1 世代前）。詳細 = labo `hechima-wasm/README.md`「単スレッドビルド」節 |
| `hechima-wasm-cost/`（hechima-wasm.js / .wasm） | **v0.8.0 相当 + 単スレッド**（2026-07-28、実験用） | **候補の二層化 実験ページ専用**。変換結果 JSON に `costs`（candidates と並走する Mozc コスト。小さいほど上位）を足しただけで、機能は上の `hechima-wasm/` と同じ。labo main `c3cbc20` の CI artifact `hechima-wasm-singlethread`（run 30326743811）／provenance: fcitx5-mozc `522a5f2` / emsdk 3.1.69 / 単スレッド（**PThread 参照ゼロ = COOP/COEP 不要**、同梱 BUILD_INFO.txt）。**`mozc.data` は同梱しない** — `hechima-wasm/mozc.data` を共有する（init の `dataUrl` で `/vendor/hechima-wasm/mozc.data` を指す）。**既存ページはこのディレクトリを読まない**ので影響ゼロ。既定値が固まったら `hechima-wasm/` 本体へ統合してこのディレクトリは消す。設計 = labo `docs/hechima-candidate-fold-design.md` |
| `keymaps/`（naginata_jis / naginata_us） | 薙刀式 v18 + `judgment: mutual` | labo main `c434c6b` の `web/public/keymaps/`（同時押しを本家仕様の相互シフト = ミリ秒を見ない状態ベース判定に切替。keymap-engine v1.3.0 とセット差し替え必須） |

## 互換性の要点

- hechima v0.13.0 は **KeymapEngine >= 1.4.0 必須**（セット差し替え）
- flick-engine は **hechima v0.13.0+（insertKana）必須**
- hechima-worker は hechima-wasm v0.7.1 とセット推奨（学習は v0.4.0+。旧 wasm では resize/learn が機能検出で段階的に無効）
- `mozc.data` は Mozc の辞書（名前と帰属を保つため改名しない）

## 帰属 / powered by Mozc

- Mozc: Copyright (c) Google LLC, BSD-3-Clause
- fcitx5-mozc（ビルドハーネス）: fcitx-contrib, BSD-3-Clause
- 辞書: mozc システム辞書（BSD-3-Clause + NAIST License + Public Domain。CC BY-SA の Mozc UT は不同梱）
- **ライセンス全文はリポジトリルートの THIRD_PARTY_NOTICES.md に再掲**
