# ブラウザで回す確認（手動）

`site/scripts/` 直下の検査（`check-*.mjs`）は `npm run build` の先頭で走るが、ここにあるのは
**実際のページをヘッドレス Chromium で打鍵・測定する確認**で、ビルドには組み込んでいない。
CSS の寸法やスクロールの挙動は node のテストでは見えないので、画面まわりを直したら手で回す。

## 準備

`playwright-core` は `package.json` に入れていない（ビルドに要らないため）。どこか別の場所に入れて、
`PW_DIR` で指すか、そのディレクトリから実行する（ESM なので `NODE_PATH` は効かない）:

```bash
mkdir -p /tmp/pw && (cd /tmp/pw && npm i playwright-core)
PW_DIR=/tmp/pw node site/scripts/browser/check-hitaki-isuka.mjs
```

ブラウザ本体は Playwright のキャッシュ（`~/.cache/ms-playwright/chromium_headless_shell-*`）から探す。
別の場所なら `CHROME_PATH` で指定する。

## スクリプト

| | 見るもの |
|---|---|
| `check-hitaki-isuka.mjs [base]` | `/hitaki-isuka/`: 両配列の打鍵（子音が薄く出る・空きキーは無反応）、説明図とエディタが一画面に収まるか、読み込み中にページが勝手に動かないか |

`base` の既定は `http://localhost:4789`（`cd site && npm run build && npx vite preview --port 4789 --strictPort`）。
本番（`https://luffa-lang-labo.dev`）にも向けられる。

## 罠

- **プレビューを止めるときに `pkill -f "vite preview"` と書かない。** 同じコマンド行（コミットメッセージや
  PR 本文も含む）に `vite preview` の文字列があると、自分のシェルまで止まる。
  `kill $(pgrep -f 'vit[e] preview')` のように括弧でずらす
- **デプロイ直後は CDN が一部のファイルに古い応答を返すことがある。** URL に `?cb=` を付ける
  （スクリプトは付けている）。付けずに測ると、直したはずの挙動が再現して見える
- Playwright に「変換」「英数」キーは無い。`dispatchEvent(new KeyboardEvent("keydown", { code: "Lang2" }))` で送る。
  ラボでは Ctrl+Shift+; が英字モードへの切り替えまで届かない（原因は未調査）
