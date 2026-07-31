// 同梱バンドルの版と、それを書いているドキュメントの版が食い違っていないか検査する（prebuild）。
//
// なぜ要るか: vendor の差し替えは `cp` + VENDOR.md 更新の手作業で、版を書いた場所が
// 4 か所（README.md の表 / VENDOR.md の表 / hechima.d.ts のヘッダ / バンドル実体）ある。
// 実際 2026-07 に README が 5 版ぶん置き去りになった（VENDOR.md だけが手順書に
// 「必須」と書いてあり、そこだけ守られた）。人間の注意力ではなくビルドで止める。
//
// 正 = バンドル実体の VERSION 文字列（ビルド時に埋まるので嘘がつけない）。
// ドキュメント側がそれと違えば非ゼロ終了 = ビルドもデプロイもできない。
// hechima-wasm だけは実体が版を名乗らないので、README と VENDOR.md の一致だけ見る。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const VENDOR = join(HERE, "../public/vendor");

const README = join(ROOT, "README.md");
const VENDOR_MD = join(VENDOR, "VENDOR.md");
const DTS = join(VENDOR, "hechima/hechima.d.ts");

/** バンドル実体（正）と、それを書いている表の行の探し方 */
const PACKAGES = [
    { name: "hechima", bundle: "hechima/hechima.js", readmeKey: "`hechima`", vendorKey: "`hechima/`" },
    { name: "hechima-keymap", bundle: "keymap-engine/keymap-engine.js", readmeKey: "`hechima-keymap`", vendorKey: "`keymap-engine/`" },
    { name: "flick-engine", bundle: "flick/flick-engine.js", readmeKey: "`flick-engine`", vendorKey: "`flick/`" },
    { name: "gamepad-engine", bundle: "gamepad/gamepad-engine.js", readmeKey: "`gamepad-engine`", vendorKey: "`gamepad/`" },
];

const errors = [];
const read = (p) => readFileSync(p, "utf8");
const cells = (line) => line.split("|").map((s) => s.trim());
const semver = (s) => s?.match(/\d+\.\d+\.\d+/)?.[0] ?? null;

/** md の表から「1 列目が key で始まる行」を探し、指定列の版を返す */
function versionInTable(md, path, key, col) {
    const line = md.split("\n").find((l) => l.startsWith("|") && cells(l)[1]?.startsWith(key));
    if (!line) {
        errors.push(`${path}: 表に ${key} の行が無い（パッケージを増やしたら表にも足すこと）`);
        return null;
    }
    const c = cells(line);
    const cell = col < 0 ? c.filter(Boolean).at(col) : c[col];
    const v = semver(cell);
    if (!v) errors.push(`${path}: ${key} の行から版を読めない（セル: ${cell ?? "無し"}）`);
    return v;
}

const readme = read(README);
const vendorMd = read(VENDOR_MD);
const found = [];

for (const p of PACKAGES) {
    const src = read(join(VENDOR, p.bundle));
    const actual = semver(src.match(/VERSION\s*=\s*"(\d+\.\d+\.\d+)"/)?.[1] ?? "");
    if (!actual) {
        errors.push(`${p.bundle}: VERSION 文字列が見つからない（バンドルの作り方が変わった？）`);
        continue;
    }
    found.push(`${p.name} ${actual}`);

    const inReadme = versionInTable(readme, "README.md", p.readmeKey, -1);
    if (inReadme && inReadme !== actual) {
        errors.push(`${p.name}: 実体 ${actual} ≠ README.md の表 ${inReadme} → README.md の構成表を直す`);
    }
    const inVendor = versionInTable(vendorMd, "VENDOR.md", p.vendorKey, 2);
    if (inVendor && inVendor !== actual) {
        errors.push(`${p.name}: 実体 ${actual} ≠ VENDOR.md の表 ${inVendor} → VENDOR.md の pin 記録を直す`);
    }
}

// hechima.js と hechima-worker.js は同じ版で配る（へちま蔓の両端なので片方だけ古いと事故る）
const workerV = semver(read(join(VENDOR, "hechima/hechima-worker.js")).match(/VERSION\s*=\s*"(\d+\.\d+\.\d+)"/)?.[1] ?? "");
const sessionV = semver(read(join(VENDOR, "hechima/hechima.js")).match(/VERSION\s*=\s*"(\d+\.\d+\.\d+)"/)?.[1] ?? "");
if (workerV && sessionV && workerV !== sessionV) {
    errors.push(`hechima.js (${sessionV}) と hechima-worker.js (${workerV}) の版が違う → 両方まとめて cp すること`);
}

// 手書き d.ts のヘッダ（1 行目の「Hechima vX.Y.Z」）。正典は labo 側なので、直すのは labo → cp
const dtsV = semver(read(DTS).split("\n")[0]);
if (sessionV && dtsV !== sessionV) {
    errors.push(
        `hechima.d.ts のヘッダ ${dtsV ?? "版の記載なし"} ≠ 実体 ${sessionV}\n` +
            `  → 正典は labo の web/public/hechima/hechima.d.ts。あちらを直してから cp すること`,
    );
}

// hechima-wasm は実体が版を名乗らない（BUILD_INFO.txt は commit ハッシュのみ）ので書類間の一致だけ
const wasmReadme = versionInTable(readme, "README.md", "`hechima-wasm`", -1);
const wasmVendor = versionInTable(vendorMd, "VENDOR.md", "`hechima-wasm/`", 2);
if (wasmReadme && wasmVendor && wasmReadme !== wasmVendor) {
    errors.push(`hechima-wasm: README.md ${wasmReadme} ≠ VENDOR.md ${wasmVendor}`);
}

if (errors.length) {
    console.error("\ncheck-versions: 版の記述が実体と食い違っている\n");
    for (const e of errors) console.error(`  ✗ ${e}`);
    console.error("\n直してから build し直すこと（vendor 差し替えの手順は DEPLOY.md）。\n");
    process.exit(1);
}

console.log(`check-versions: ${found.join(" / ")} — README.md・VENDOR.md・d.ts と一致`);
