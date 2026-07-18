# vendored 成果物の pin 記録

すべて logical-layout-labo（開発本家）のタグ付き成果物を pin して同梱する。
差し替えるときは必ずこのファイルも更新すること。

| ディレクトリ | 版 | 取得元 |
|---|---|---|
| `hechima/`（hechima.js / hechima-worker.js / hechima.d.ts） | **v0.11.0** | labo Release `hechima-v0.11.0`（+ ユーザー辞書） |
| `keymap-engine/`（keymap-engine.js） | **v1.2.0** | labo main `5213831` の `web/public/engine/` |
| `hechima-wasm/`（hechima-wasm.js / .wasm / mozc.data） | **v0.7.0** | labo Release `hechima-wasm-v0.7.0`（+ hechima_dict_* = ユーザー辞書）。provenance: fcitx5-mozc `fd530f6` / emsdk 3.1.69（同梱 BUILD_INFO.txt。mozc.data も同 Release で更新） |
| `keymaps/`（naginata_jis / naginata_us） | 薙刀式 v18 | labo main `5213831` の `web/public/keymaps/` |

## 互換性の要点

- hechima v0.11.0 は **KeymapEngine >= 1.2.0 必須**（セット差し替え）
- hechima-worker は hechima-wasm v0.7.0 とセット推奨（学習は v0.4.0+。旧 wasm では resize/learn が機能検出で段階的に無効）
- `mozc.data` は Mozc の辞書（名前と帰属を保つため改名しない）

## 帰属 / powered by Mozc

- Mozc: Copyright (c) Google LLC, BSD-3-Clause
- fcitx5-mozc（ビルドハーネス）: fcitx-contrib, BSD-3-Clause
- 辞書: mozc システム辞書（BSD-3-Clause + NAIST License + Public Domain。CC BY-SA の Mozc UT は不同梱）
