// 辞書の事前圧縮版を dist に生成する（postbuild）。
//
// 18.9MB の mozc.data は CDN の自動圧縮が効かない（拡張子 .data から content-type が
// 決まらず、Cloudflare の圧縮対象の型一覧から外れる）。ヘッダ設定で解こうとすると
// ホスト依存になるので、**圧縮した実体を自分で持つ**。
//
// リポジトリには原本だけを置き、.gz はここで作る（同じ内容を 2 つコミットしないため）。
// hechima-worker v0.15.0+ が mozc.data.gz を優先して取り、DecompressionStream で展開する。
// .gz が無ければ素の mozc.data に戻るので、この生成が失敗しても配信は壊れない。

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DICT = join(HERE, "../dist/vendor/hechima-wasm/mozc.data");

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

if (!existsSync(DICT)) {
    console.error(`gzip-dict: ${DICT} が無い。vendor が配置されているか確認すること`);
    process.exit(1);
}

const raw = readFileSync(DICT);
// レベル 9。ビルド時に一度だけ走るので時間より圧縮率を優先する
const gz = gzipSync(raw, { level: 9 });
writeFileSync(`${DICT}.gz`, gz);

console.log(`gzip-dict: mozc.data ${mb(raw.length)} → mozc.data.gz ${mb(gz.length)}`);
