#!/usr/bin/env node
/**
 * build:all —— Chromium 构建（vite build → extension/）+ Firefox 后处理
 * （build-firefox.mjs：拷贝 extension/ → extension-firefox/ 并替换 manifest）。
 *
 * 默认监听模式：vite 增量重建后自动重跑 firefox 后处理，改代码即同时刷新两个产物目录。
 * 一次性构建（CI 用）：node scripts/build-all.mjs --no-watch
 */
import { build } from 'vite';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const watch = !process.argv.slice(2).includes('--no-watch');

function syncFirefox() {
  // 复用独立脚本而非拷贝其逻辑，CI 与本脚本永远走同一份后处理实现
  const r = spawnSync(process.execPath, [resolve(ROOT, 'scripts/build-firefox.mjs')], {
    stdio: 'inherit',
  });
  if (r.status !== 0) console.error('[build-all] firefox 后处理失败（保留上一次产物）');
}

if (watch) {
  // watch 模式下 build() 在初始构建完成即 resolve，返回 Rollup watcher
  const watcher = await build({ build: { watch: {}, sourcemap: true } });
  syncFirefox();
  watcher.on('event', (e) => {
    // 编译报错时 vite 已自行输出，跳过本次后处理（保留两个目录里的上一次有效产物）
    if (e.code === 'BUNDLE_END') syncFirefox();
  });
  console.log('[build-all] 监听中：改动 src/ 后自动重建 Chromium + Firefox（Ctrl+C 退出）');
} else {
  await build();
  syncFirefox();
}
