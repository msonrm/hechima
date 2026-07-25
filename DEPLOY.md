# へちま言語ラボ（site/）の開発・デプロイ運用

`site/`（= **luffa-lang-labo.dev**）をローカルで動かす・本番へデプロイする・本家 labo の
vendored 成果物を差し替える・実験ページを足す、ための運用ランブック。オーナー向け
（Cloudflare アカウント / custom domain / 本家 logical-layout-labo からの vendoring 前提）。
リポジトリ概要は [README.md](README.md)、pin 版の詳細は
[site/public/vendor/VENDOR.md](site/public/vendor/VENDOR.md)。

## ラボサイトをローカルで動かす

```bash
cd site
npm ci
npm run dev      # dev サーバー（COOP/COEP は 2026-07-25 に撤去 = 単スレッド wasm へ移行）
npm run build    # tsc --noEmit + vite build → site/dist/
```

## デプロイ（Cloudflare Workers 静的アセット）

**正規手段**（毎回これ。CI は無い）。リポジトリルートの `wrangler.jsonc` が `./site/dist` を
本番ドメイン **luffa-lang-labo.dev**（custom domain・DNS/証明書自動）+ hechima-lab.msonrm.workers.dev
へ配信する。

```bash
cd site && npm run build && cd ..     # tsc --noEmit + vite build → site/dist/
npx wrangler deploy                   # site/dist を本番へ。数十秒で反映
```

- **認証**: API トークンで認証済み。`npx wrangler whoami` で確認（scope 一覧が出れば OK）。
  未認証なら初回だけ `npx wrangler login`（対話）。
- ブランチは問わない（`wrangler deploy` は作業ツリーの `site/dist` をそのまま上げる）。
  未マージの feature ブランチからでもデプロイできるが、後で main から再デプロイすると
  差分が消えるので、恒久化には main へマージ & push すること。
- `site/public/_headers`（→ `site/dist/_headers`）は **CORP のみ**を全ページに付与する。
  **COOP/COEP は 2026-07-25 に撤去**（hechima-wasm を単スレッドビルドに切り替えて
  SharedArrayBuffer 依存が消えたため）。同時に小型アセットの `no-store` も撤去し、
  通常のキャッシュ（`max-age=0, must-revalidate` = ETag 再検証）に戻した。
  戻す必要が出るのはマルチスレッド wasm に回帰する場合だけ。
- 1 ファイル 25MiB 制限: 辞書 `mozc.data` は 18.9MB で現状クリア。
- （任意）Cloudflare ダッシュボードの Workers Builds（Git 連携）にビルド
  `cd site && npm ci && npm run build` / デプロイ `npx wrangler deploy` を設定すると push=デプロイ。

## vendored 成果物（labo の UMD）を差し替える

配列エンジン / 変換セッション層 / フリック / ゲームパッド等は logical-layout-labo（本家・
`~/development/logical-layout-labo`）のビルド成果物を pin して同梱する（`site/public/vendor/`）。
差し替え手順:

1. **labo でビルド**: `cd ~/development/logical-layout-labo/web && npm run build:<engine>`
   （例 `build:gamepad` / `build:flick` / `build:engine` / `build:hechima`）
2. **コピー**: `cp web/public/<engine>/<file>.js <hechima>/site/public/vendor/<engine>/<file>.js`
3. **`site/public/vendor/VENDOR.md`** の版数・注記を更新（pin 記録。必須）
4. ~~新規エンジンに `no-store` を追加~~ → **不要になった**（2026-07-25。COOP/COEP 撤去で
   Safari の COI × キャッシュ再利用ブロック事象の前提が消えたため、`no-store` 戦略ごと撤去）
5. `cd site && npm run build` → リポジトリルートで `npx wrangler deploy`
6. **検証**: `curl -s https://luffa-lang-labo.dev/vendor/<engine>/<file>.js | grep <版数>` /
   `curl -sD- https://luffa-lang-labo.dev/<page>/ -o /dev/null | grep -i "cross-origin\|cache-control"`。
   キャッシュは `max-age=0, must-revalidate`（ETag 再検証）なので、内容が変われば必ず新しいものが
   届く。ただし**デプロイ直後は CDN エッジが一部ファイルの古い応答を返す瞬間があるので、
   確認は `?cb=<適当な値>` を付けて行う**こと。

## 実験ページを足す

`site/<page>/index.html`（他ページを複製して head の title/description・script src を変更）+
`site/src/pages/<page>.ts`（`initLabPage(config)` を呼ぶだけ）+ `site/vite.config.ts` の
`rollupOptions.input` に 1 行。**隠しページ**は `<meta name="robots" content="noindex" />` を足し、
TOP（`site/index.html`）にリンクを張らない（直リンク限定。正式公開時に noindex を外して OGP を足す）。
