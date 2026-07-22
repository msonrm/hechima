# vendored 成果物の pin 記録

すべて logical-layout-labo（開発本家）のタグ付き成果物を pin して同梱する。
差し替えるときは必ずこのファイルも更新すること。

| ディレクトリ | 版 | 取得元 |
|---|---|---|
| `hechima/`（hechima.js / hechima-worker.js / hechima.d.ts） | **v0.13.0** | labo Release `hechima-v0.13.0`（`insertKana` = かな直接注入。フリック入力の配線先。additive） |
| `flick/`（flick-engine.js / flick_standard.json） | **v1.1.1** | labo main `98cd721` の `web/public/flick/` + `web/public/flickmaps/`（v1.1.0 = 配置改訂・戻す/カーソルフリック・composingLabel・ペタル抑制、v1.1.1 = root touchend preventDefault のズーム対策。hechima v0.13.0+ とセット） |
| `gamepad/`（gamepad-engine.js） | **v1.3.0** | labo branch `feat/gamepad-engine` の `web/public/gamepad/`（ゲームパッド日本語入力フロント。日本語のみ。GamepadOp = flick と同じ kana/key 二語彙。v1.1.0 左スティック nav、v1.2.0 文節伸縮 RT+←→ / 確定アンドゥ Start、v1.3.0 未入力時 L🕹↓=カーソル下 + 句読点連打窓 600ms。hechima v0.13.0+（insertKana）必須） |
| `keymap-engine/`（keymap-engine.js） | **v1.4.0** | labo main `84199d5` の `web/public/engine/`（英数モードの chord 解釈 = H+J 日本語復帰 / space+X 大文字 + mutual 再入バグ修正） |
| `hechima-wasm/`（hechima-wasm.js / .wasm / mozc.data） | **v0.7.1** | labo Release `hechima-wasm-v0.7.1`（ユーザー辞書 + よみの Mozc 純正検証）。provenance: fcitx5-mozc `fd530f6` / emsdk 3.1.69（同梱 BUILD_INFO.txt。mozc.data も同 Release で更新） |
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
