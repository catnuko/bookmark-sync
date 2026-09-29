// 打包商店提交用 zip（无依赖，纯 Node 实现 —— Windows 无 zip 命令）：
//   dist/bookmark-sync-chromium-<ver>.zip   ← extension/ 内容
//   dist/bookmark-sync-firefox-<ver>.zip    ← extension-firefox/ 内容
// manifest.json 必须位于 zip 根目录（本地 `pnpm package` 与 CI release.yml 同一口径）。
//
// 用法：node scripts/package-zips.mjs [version]
//   不带参数时版本号取 package.json；CI 里显式传 resolve job 定下的版本。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { relative } from 'node:path';
import { makeZip, walkFiles } from './lib/zip.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const ver = process.argv[2] || pkg.version;
const targets = [
  { dir: 'extension', out: `dist/bookmark-sync-chromium-${ver}.zip` },
  { dir: 'extension-firefox', out: `dist/bookmark-sync-firefox-${ver}.zip` },
];

mkdirSync('dist', { recursive: true });
for (const { dir, out } of targets) {
  const names = walkFiles(dir).map((f) => relative(dir, f).replaceAll('\\', '/'));
  if (!names.includes('manifest.json')) {
    console.error(`[package-zips] ${dir}/ 里没有 manifest.json —— 先构建（pnpm build:all）再打包`);
    process.exit(1);
  }
  const zip = makeZip(dir);
  writeFileSync(out, zip);
  console.log(
    `[package-zips] ${out} (${(zip.length / 1024).toFixed(1)} KB, ${names.length} 个文件, manifest 在根目录)`,
  );
}
