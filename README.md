# 🧽 hechima

**OS 非依存の Web 向け日本語入力スタック。** 変換エンジンと配列をユーザーランドに取り戻す —
URL ひとつで、設定不要の新配列と本気の日本語変換がブラウザの中だけで動く。

> 名前の由来: 「へちま」の語源（糸瓜 → とうり → 「と」がいろは順で「へ」と「ち」の間 → へち間）。
> かな順の言葉遊びがそのまま名前。IM が h-e-c-h-**im**-a に隠れている。
> もうひとつの由来は、眉村ちあきさんの楽曲「[ヘチマで体洗ってる](https://youtu.be/FIG4pFtsIEs)」。

**ラボサイト = へちま言語ラボ**（正式名 *luffa lang labo* — luffa はへちまの英名、頭文字
L.L.L. は生まれ故郷の logical-layout-labo と同じ）: **https://luffa-lang-labo.dev**（旧 https://hechima-lab.msonrm.workers.dev も併存）

## 構成（3 パッケージ + ラボサイト）

| レイヤ | 中身 | 版 |
|---|---|---|
| `hechima` | 変換セッション層 + hechima-worker（へちま蔓 v0）。よみ合成・文節候補選択・文節伸縮・編集キー二重経路・英字合成（Shift+英字）・追加候補・**学習**（OPFS 永続化）・**確定アンドゥ**（Ctrl+BS）・**再変換**・ユーザー辞書 RPC・かな直接注入 `insertKana`（フリック等の非キーボード入力フロント用） | v0.13.0 |
| `hechima-keymap`（= KeymapEngine） | 配列エンジン。論理配列 JSON（薙刀式等）・同時打鍵/chord（時間窓 + **相互シフト** = 薙刀式本家仕様の状態ベース判定）・SandS をデータ駆動で解決 | v1.4.0 |
| `hechima-wasm` | Mozc（fcitx5-mozc）の Emscripten ビルド。かな → 文節/候補 JSON に加え、学習（FinishConversion）・取り消し・逆変換・ユーザー辞書の最小 C API。**powered by Mozc** | v0.7.1 |
| `flick-engine` | フリック入力フロント。flickmap（flick-1）データ駆動の 12 キーフリック（゛゜小トグル・英字/数字レイヤ・ペタル）— **スマホでも OS IME 非依存の日本語入力**が成立する | v1.1.1 |
| `site/` | **へちま言語ラボ（luffa lang labo）** — 上記スタックを備えたプレーンエディタ（カーソル/選択・OPFS 自動保存・undo/redo・文字数カウント）。**PC = 物理キーボード + 候補ポップアップ / スマホ = フリック + 候補バー**の両 UI。Cloudflare Workers（静的アセット）で配信 | — |

各レイヤは差し替え可能（配列は JSON、変換は cb 注入、エンジン境界はへちま蔓 =
「かな → 文節/候補 JSON」）。開発の本家は logical-layout-labo リポジトリ（現在 private）で、本リポジトリはそのタグ付き成果物を pin して vendoring する
（`site/public/vendor/VENDOR.md`）。

## ラボサイトの開発

```bash
cd site
npm ci
npm run dev      # COOP/COEP ヘッダ付き dev サーバー（wasm の SharedArrayBuffer に必須）
npm run build    # tsc --noEmit + vite build → site/dist/
```

## デプロイ（Cloudflare Workers 静的アセット）

```bash
cd site && npm ci && npm run build && cd ..
npx wrangler deploy        # 初回は npx wrangler login
```

または Cloudflare ダッシュボードの Workers Builds（Git 連携）で
ビルドコマンド `cd site && npm ci && npm run build`、デプロイコマンド `npx wrangler deploy` を設定
すると push = デプロイになる。

- COOP/COEP は `site/public/_headers` がサイト全体に付与（hechima-wasm は -pthread =
  SharedArrayBuffer 必須）。外部リソースは埋め込まない（自己完結）
- 1 ファイル 25MiB 制限: 辞書 `mozc.data` は 18.9MB で現状クリア

## ライセンス

自作部分は MIT（[LICENSE](LICENSE)）。Mozc は BSD-3-Clause (Google)、fcitx5-mozc は
BSD-3-Clause (Fcitx contributors)、辞書は BSD-3 + NAIST License + Public Domain —
**powered by Mozc**。第三者ライセンスの全文は
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)、pin 版の詳細は
[site/public/vendor/VENDOR.md](site/public/vendor/VENDOR.md)。
