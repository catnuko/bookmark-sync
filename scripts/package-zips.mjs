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

/**
 * ★ 打包闸：产物里出现 `sk-` 开头的字符串就拒绝打包。
 *
 * ## 为什么需要这道闸
 *
 * 本地开发会把 `.dev-creds.json` 的 `aiKey` 经 vite `define` 编译进 `extension/`，
 * 而本脚本打的就是 `extension/`。CI 上拿不到那个文件所以天然干净，但**本地手打
 * `pnpm package` 会把你的付费 API Key 打进商店 zip**，再提交上去就等于公开泄露。
 *
 * 光靠「记得别打」不可靠 —— 这里改成「打不了」：命中即非零退出，且不写出任何 zip。
 *
 * ## 为什么匹配 `sk-` 前缀就够
 *
 * 这是 DeepSeek / OpenAI / Anthropic 兼容端点的 key 共同形态。没有这个前缀的
 * 字符串（baseUrl、模型名、UUID）不误伤。宁可多查一次文本文件，也不引入
 * 「白名单哪些文件」这种会漏的规则。
 */
function assertNoSecrets(dir) {
  const hits = [];
  for (const file of walkFiles(dir)) {
    // 二进制（png/zip 等）按 latin1 读也不会误报，代价只是读一遍
    const text = readFileSync(file, 'utf8');
    const m = text.match(/sk-[A-Za-z0-9_-]{16,}/);
    if (m) hits.push({ file: relative(dir, file), sample: `${m[0].slice(0, 8)}…` });
  }
  if (hits.length > 0) {
    console.error(`[package-zips] ✗ 拒绝打包：${dir}/ 产物里疑似有 API Key`);
    for (const h of hits) console.error(`    ${h.file}  ${h.sample}`);
    console.error(
      '  这通常是因为本地构建注入了 .dev-creds.json 的 aiKey。\n' +
        '  处理：① 清掉 .dev-creds.json 的 aiKey 后重新构建；或\n' +
        '        ② 直接用 CI 发版（gh workflow run release.yml），CI 拿不到该文件。\n' +
        '  绝不要为了绕过这个检查把 key 提交进 git。',
    );
    process.exit(1);
  }
}

mkdirSync('dist', { recursive: true });
for (const { dir, out } of targets) {
  const names = walkFiles(dir).map((f) => relative(dir, f).replaceAll('\\', '/'));
  if (!names.includes('manifest.json')) {
    console.error(`[package-zips] ${dir}/ 里没有 manifest.json —— 先构建（pnpm build:all）再打包`);
    process.exit(1);
  }
  assertNoSecrets(dir);
  const zip = makeZip(dir);
  writeFileSync(out, zip);
  console.log(
    `[package-zips] ${out} (${(zip.length / 1024).toFixed(1)} KB, ${names.length} 个文件, manifest 在根目录)`,
  );
}
