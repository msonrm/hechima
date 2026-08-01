# vendored 成果物の pin 記録

すべて logical-layout-labo（開発本家）のタグ付き成果物を pin して同梱する。
差し替えるときは必ずこのファイルも更新すること。

| ディレクトリ | 版 | 取得元 |
|---|---|---|
| `hechima/`（hechima.js / hechima-worker.js / hechima.d.ts） | **v0.19.0** | labo main `1634f8e` の `web/public/hechima/`。**v0.18.0 = Shift+Space 前候補（engine 挿し時も）**、**v0.17.0 = Shift+英字の英字合成（engine 挿し時も。JSON 逐次配列で綴りバリエーションが出る。chord 配列は対象外）**。どちらも Obsidian プラグインの実機フィードバックから。v0.16.0 = Space の意味論の整理（空バッファの convert / insertSpace = 文書へ空白をコミット・候補選択中の insertSpace = 次候補。Obsidian プラグインの実機フィードバックから。**keymap-engine v1.6.0 とセット差し替え**）。v0.15.0 = 辞書の事前圧縮配信 — worker が `<dataUrl>.gz` を先に試し `DecompressionStream` で展開する（無ければ素の辞書に戻るので配信側・worker のどちらが古くても動く）。`.gz` は site のビルド時に生成する（`site/scripts/gzip-dict.mjs`。リポジトリには原本だけを置く）。v0.14.0 = 候補の二層化（`FoldOptions` / `expandCandidates` / `collapseCandidates` / `setFold` + `WireSegment.costs`）。**追加のみで、渡さなければ挙動は従来どおり** = 二層化を使わないページは差し替えるだけで無変更（golden で固定済み）。使うには costs を返す wasm が要る（`hechima-wasm-cost/`）。v0.13.1 = BS で素通しローマ字まで戻ったときの pending 復帰、v0.13.0 = `insertKana`（フリック入力の配線先） |
| `flick/`（flick-engine.js / flick_standard.json） | **v1.1.1** | labo main `98cd721` の `web/public/flick/` + `web/public/flickmaps/`（v1.1.0 = 配置改訂・戻す/カーソルフリック・composingLabel・ペタル抑制、v1.1.1 = root touchend preventDefault のズーム対策。hechima v0.13.0+ とセット） |
| `gamepad/`（gamepad-engine.js） | **v1.7.0** | labo main の `web/public/gamepad/`（ゲームパッド日本語入力フロント。日本語のみ。GamepadOp = flick と同じ kana/key 二語彙。v1.1.0 左スティック nav、v1.2.0 文節伸縮 RT+←→ / 確定アンドゥ Start、v1.3.0 未入力時 L🕹↓=カーソル下 + 句読点連打窓 600ms、v1.3.1 ビジュアライザ調整、v1.4.0 RT 連打サイクル ん→を→んを + 拗音後の濁点 きゃ→ぎゃ、v1.5.0 非合成時 RT+LS 上下左右=範囲選択（Shift+矢印）、v1.6.0 非合成の LS カーソル移動/範囲選択にキーリピート（400ms→85ms）、**v1.7.0 RT+Start=やり直し（Ctrl+y を emit）**。hechima v0.13.0+（insertKana）必須。範囲削除=BS で選択削除・再変換=Start・**文書 redo=Ctrl+y** は hechima ホスト側 app.ts で対応） |
| `keymap-engine/`（keymap-engine.js） | **v2.0.0** | labo main の `web/public/engine/`。**v2.0.0 = keymap v2（役と物理キーの分離・JIS/US 統合）。v1 のキーマップは読めない**（版ゲートが明確なエラーで弾く）。配列は `roles` で役を宣言し、物理キーへの割当は `roles[].keys` + `layouts`（レイアウト固有の追加）+ ホストの実行時上書き（`roleOverrides`）で決まる。`base: positional` でかな配列の JIS/US 文字ずれが 1 本化。v1.16.0 = 後置変調 `postModify`、v1.15.0 = アクションの局面ガード（`{action, when}`）、v1.14.0 = 局面の問い合わせ（`hostPhase`）、v1.13.0 = 入力段 `requiredInputLevel`、v1.12.0 = 未知フィールドの拒否、v1.11.0 = `requires`（必須セマンティクスの宣言）、v1.10.0 = 読み込み診断 `onDiagnostic` + `judgment` 未知値のエラー化、v1.9.0 = アクション文字列パーサの 1 本化。**v1.8.0 = 役に載ったスペースの単打が死ぬのを修正** —— `singleTapAction` は「左親指」などの役に対して宣言するが、どの物理キーがその役を担うかはホストが実行時に決められる（Obsidian プラグインの割り当て変更）。宣言の無い役にスペースが載ると単打が誰にも拾われない死にキーになっていた（NICOLA JIS で実機報告。US は元から space を持つ左親指に convert を宣言していて無事だった＝配列固有の幸運）。宣言が無いときだけスペースを担う役の単打を `convert` にする（宣言があれば常にそちらが勝つので既存配列は不変）。**v1.7.0 = chord 配列で `Space` が役に無いとき Space が死ぬのを修正** —— 全キーを無条件に同時打鍵バッファへ流していたため、NICOLA JIS の Space が誰にも拾われず `insertSpace` に到達できなかった。**v1.6.0 = composing 中の Space = convert（状態で意味を分ける）・inputBase:romaji に characterMap〈h2zMap〉の既定（JSON ローマ字の句読点）・BS 後の pending 復帰 repend()**。旧版のままだと逐次系 JSON で Space が「よみのまま確定」になる（hechima v0.16.0 とセット差し替え）。v1.4.0 = 英数モードの chord 解釈（H+J 日本語復帰 / space+X 大文字 + mutual 再入バグ修正） |
| `hechima-wasm/`（hechima-wasm.js / .wasm / mozc.data） | **v0.7.1 + 単スレッド化**（2026-07-25） | 機能は Release `hechima-wasm-v0.7.1`（ユーザー辞書 + よみの Mozc 純正検証）と同じで、**`-pthread` なしで焼き直したもの**。js/wasm = labo `verify/wasm-single-thread` `c0e13b9` の CI artifact `hechima-wasm-singlethread`（run 30134214247）／provenance: fcitx5-mozc `522a5f2` / emsdk 3.1.69 / `patches/single_thread.patch` 適用（同梱 BUILD_INFO.txt）。**SharedArrayBuffer / pthread の参照ゼロ = COOP/COEP 不要**（init 737→156ms・js -19%・変換速度は同等）。`mozc.data` は v0.7.1 のものをそのまま継続使用（ビルド設定と無関係のため）。**pthread 版へ戻すときは git 履歴から**（`site/public/vendor/hechima-wasm/` の 1 世代前）。詳細 = labo `hechima-wasm/README.md`「単スレッドビルド」節 |
| `hechima-wasm-cost/`（hechima-wasm.js / .wasm） | **v0.8.0 相当 + 単スレッド**（2026-07-28、実験用） | **候補の二層化 実験ページ専用**。変換結果 JSON に `costs`（candidates と並走する Mozc コスト。小さいほど上位）を足しただけで、機能は上の `hechima-wasm/` と同じ。labo main `c3cbc20` の CI artifact `hechima-wasm-singlethread`（run 30326743811）／provenance: fcitx5-mozc `522a5f2` / emsdk 3.1.69 / 単スレッド（**PThread 参照ゼロ = COOP/COEP 不要**、同梱 BUILD_INFO.txt）。**`mozc.data` は同梱しない** — `hechima-wasm/mozc.data` を共有する（init の `dataUrl` で `/vendor/hechima-wasm/mozc.data` を指す）。**既存ページはこのディレクトリを読まない**ので影響ゼロ。既定値が固まったら `hechima-wasm/` 本体へ統合してこのディレクトリは消す。設計 = labo `docs/hechima-candidate-fold-design.md` |
| `keymaps/`（naginata） | 薙刀式 v18 + `judgment: mutual`・**keymap v2** | labo main の `web/public/keymaps/`。**v2 で JIS/US が 1 本に統合**され、ページは配列ではなく**レイアウト**（`layouts` のキー）を選ぶ。相互シフト = ミリ秒を見ない状態ベース判定。**keymap-engine v2.0.0 とセット差し替え必須** |

## 互換性の要点

**層をまたぐ最低版の要求は [EMBEDDING.md](../../../EMBEDDING.md) の「版の組み合わせ」に一本化した**
（同じ制約を 2 か所に書くと、片方が必ず腐る。実際 v0.13.0 のまま 5 版ぶん放置した）。
ここに書くのは pin 固有の話だけ:

- 上の表の版は**この組み合わせで検証したもの**。1 レイヤだけ上げ下げしない
- hechima-worker は hechima-wasm v0.7.1 とセット（学習は v0.4.0+。旧 wasm では resize/learn が機能検出で段階的に無効）
- `mozc.data` は Mozc の辞書（名前と帰属を保つため改名しない）
- `mozc.data.gz`（事前圧縮版）はリポジトリに置かない — ビルド時に生成する（`site/scripts/gzip-dict.mjs`）
- 表の版とバンドル実体の `VERSION` は `npm run build` が機械照合する（`site/scripts/check-versions.mjs`）

## 帰属 / powered by Mozc

- Mozc: Copyright (c) Google LLC, BSD-3-Clause
- fcitx5-mozc（ビルドハーネス）: fcitx-contrib, BSD-3-Clause
- 辞書: mozc システム辞書（BSD-3-Clause + NAIST License + Public Domain。CC BY-SA の Mozc UT は不同梱）
- **ライセンス全文はリポジトリルートの THIRD_PARTY_NOTICES.md に再掲**
