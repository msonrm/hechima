# 🧽 hechima

**OS 非依存の Web 向け日本語入力スタック。** 変換エンジンと配列をユーザーランドに取り戻す —
URL ひとつで、設定不要の新配列と本気の日本語変換がブラウザの中だけで動く。

> 名前の由来: 「へちま」の語源（糸瓜 → とうり → 「と」がいろは順で「へ」と「ち」の間 → へち間）。
> かな順の言葉遊びがそのまま名前。IM が h-e-c-h-**im**-a に隠れている。
> もうひとつの由来は、眉村ちあきさんの楽曲「[ヘチマで体洗ってる](https://youtu.be/FIG4pFtsIEs)」。

**ラボサイト = へちま言語ラボ**（正式名 *luffa lang labo* — luffa はへちまの英名、頭文字
L.L.L. は生まれ故郷の logical-layout-labo と同じ）: **[https://luffa-lang-labo.dev](https://luffa-lang-labo.dev)**（旧 https://hechima-lab.msonrm.workers.dev も併存）

## 日本語入力を 4 つの箱に分ける

**入力**（打鍵）→ **キーマップ**（かな）→ **変換**（文節と候補）→ **表示**。
ふだんこの 4 つは OS の中にあってアプリからは触れないが、hechima はこれをページの中に持って
くるので、どの箱でも差し替えられる。箱のあいだを流れるものの形が決まっている（いつ押していつ
離したか・かな・文節に区切られた候補の並び）ためで、入力をゲームパッドに取り替えても、その先の
箱は何が起きたのか知らないまま動く。

## 構成（5 パッケージ + ラボサイト）

| レイヤ | 中身 | 版 |
|---|---|---|
| `hechima` | 変換セッション層 + hechima-worker（へちま蔓 v0）。よみ合成・文節候補選択・文節伸縮・編集キー二重経路・英字合成（Shift+英字）・追加候補・**候補の二層化**・**学習**（OPFS 永続化）・**確定アンドゥ**（Ctrl+BS）・**再変換**・ユーザー辞書 RPC・かな直接注入 `insertKana`（フリック / ゲームパッド等の非キーボード入力フロント用） | v0.20.0 |
| `hechima-keymap`（= KeymapEngine） | 配列エンジン。論理配列 JSON（薙刀式等）・同時打鍵/chord（時間窓 + **相互シフト** = 薙刀式本家仕様の状態ベース判定）・SandS をデータ駆動で解決。**keymap v2 = 役と物理キーの分離（roles / layouts / roleOverrides）・JIS/US の統合・後置変調・局面ガード**。`analyzeKeymap()` で JSON から配列の特徴を機械的に読み出せる | v2.4.0 |
| `hechima-wasm` | Mozc（fcitx5-mozc）の Emscripten ビルド。かな → 文節/候補 JSON に加え、学習（FinishConversion）・取り消し・逆変換・ユーザー辞書の最小 C API。**単スレッドビルド = COOP/COEP 不要**。**powered by Mozc** | v0.7.1 |
| `flick-engine` | フリック入力フロント。flickmap（flick-1）データ駆動の 12 キーフリック（゛゜小トグル・英字/数字レイヤ・ペタル）— **スマホでも OS IME 非依存の日本語入力**が成立する | v1.2.0 |
| `gamepad-engine` | ゲームパッド入力フロント（日本語）。左手で子音・右手で母音、フリック入力の文法を応用。文節伸縮・確定アンドゥ・カーソル移動/範囲選択まで割り当て済み | v1.7.0 |
| `replay-engine` | 入力の記録と再生（ログ形式 `hlog-1`）。打鍵・変換候補の提示と選択・編集・カーソル移動を記録し、**変換エンジンを動かさずに**再生する（学習状態が違う第三者の画面でも記録どおりに再現される） | v0.3.0 |
| `site/` | **へちま言語ラボ（luffa lang labo）** — 上記スタックを備えたプレーンエディタ（カーソル/選択・OPFS 自動保存・undo/redo・文字数カウント）。**PC = 物理キーボード + 候補ポップアップ / スマホ = フリック + 候補バー**の両 UI。Cloudflare Workers（静的アセット）で配信 | — |

各レイヤは差し替え可能（配列は JSON、変換は cb 注入、エンジン境界はへちま蔓 =
「かな → 文節/候補 JSON」）。開発の本家は logical-layout-labo リポジトリ（現在 private）で、本リポジトリはそのタグ付き成果物を pin して vendoring する。
**同梱版の正典は [`site/public/vendor/VENDOR.md`](site/public/vendor/VENDOR.md)** で、
この表とバンドル実体の版が食い違っていないかは `npm run build` が機械的に検査する
（`site/scripts/check-versions.mjs`）。

## ラボサイトで試せること

各ページは 4 つの箱のどれかを差し替えたデモになっている（かっこ内が差し替えた箱）。
学習・テキスト・ユーザー辞書はブラウザ内で完結し、ページ間で共有される。

| ページ | 内容 |
|---|---|
| [/romaji/](https://luffa-lang-labo.dev/romaji/) 標準 IME | 素の hechima。ローマ字で打って Space で変換（差し替え: なし） |
| [/flick/](https://luffa-lang-labo.dev/flick/) フリック入力 | スマホ標準のフリックをブラウザ上に再現（入力・キーマップ・表示） |
| [/naginata/](https://luffa-lang-labo.dev/naginata/) 新配列サンプル | 薙刀式 v18 を設定なしで。iPad + 物理キーボードでも動く（キーマップ = JSON 一枚） |
| [/tategaki/](https://luffa-lang-labo.dev/tategaki/) 縦書きエディタ | 縦書きの本文と、縦組で横並びに出る候補窓（表示） |
| [/theme/](https://luffa-lang-labo.dev/theme/) テーマ連動 | 本文と一緒に候補窓も着替える。ダークテーマで候補窓だけ白く光らない（表示） |
| [/candlayer/](https://luffa-lang-labo.dev/candlayer/) 候補の二層化 | 候補を「選ぶ層」と「探す層」に分ける。見えるのは 5 件、残りは Tab（表示） |
| [/gamepad/](https://luffa-lang-labo.dev/gamepad/) ゲームパッド日本語入力 | コントローラーで日本語を打つ（入力・キーマップ） |
| [/obsidian/](https://luffa-lang-labo.dev/obsidian/) Obsidian で使う | ラボの外の話（下記） |

ほかに `/coi-test/`（環境診断）を隠しページとして置いてある。

## ラボの外へ — Obsidian で使う

hechima 一式を [Obsidian](https://obsidian.md/) のプラグインに入れ、そのエディタで日本語を
打てるようにしたものがある（デモではなく、ふつうに文章が書ける）。箱は一つも差し替えず、
4 つまとめて置き場所を変えた形。配布先は **[msonrm/obsidian-hechima](https://github.com/msonrm/obsidian-hechima)**。

OS の IME を使わないので、**iPad でも薙刀式・AZIK・月配列で打てる**（同梱 6 方式 + 自分の
配列 JSON）。同時打鍵はエディタが離鍵を返す環境でだけ成立する、といった環境ごとの可否は
[/obsidian/](https://luffa-lang-labo.dev/obsidian/) に実測を書いてある。

## 開発・デプロイ

`site/`（ラボサイト）のローカル開発・本番デプロイ・vendored 成果物の差し替え・実験ページ追加の
手順は **[DEPLOY.md](DEPLOY.md)** を参照。

## 自分のページに組み込む

同梱のビルド済みエンジン（`site/public/vendor/`）は、そのまま他のページへ組み込めます。
**特別なレスポンスヘッダは要りません**（2026-07-25 に変換エンジンを単スレッドビルドへ移行し、
SharedArrayBuffer 依存 = COOP/COEP 必須の制約をなくしました。静的ファイルを置けるホストなら
どこでも動きます）。最小構成・cb 契約・版の組み合わせは **[EMBEDDING.md](EMBEDDING.md)** に
まとめてあります（各 API の詳細は同梱の型定義
[`hechima.d.ts`](site/public/vendor/hechima/hechima.d.ts)）。まだ実験段階のため、層をまたぐ
破壊的変更が起きることがあります。詳しいガイドが必要になったら Issue でお知らせください。

## ライセンス

自作部分は MIT（[LICENSE](LICENSE)）。Mozc は BSD-3-Clause (Google)、fcitx5-mozc は
BSD-3-Clause (Fcitx contributors)、辞書は BSD-3 + NAIST License + Public Domain —
**powered by Mozc**。第三者ライセンスの全文は
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)、pin 版の詳細は
[site/public/vendor/VENDOR.md](site/public/vendor/VENDOR.md)。
