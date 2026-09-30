import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Safari / macOS 复用 bundle（feat-safari-core-bundle）。
//
// 与主构建（vite.config.js）完全隔离：
//   - 入口 src/core/entry.ts —— 无 chrome.* / DOM / IndexedDB / fetch 依赖；
//   - 产物 dist/core/bookmark-sync-core.js（IIFE，挂 globalThis.BookmarkSyncCore），
//     供 macOS App 的 JavaScriptCore 加载（Swift 壳注入 crypto / KVStore / rpc）；
//   - 不触发 scripts/post-build-safari.mjs，CI/本地均可独立跑。
//
// 用法：pnpm build:core
export default defineConfig({
  // 只产出 JS bundle：不拷贝 public/（_locales/icons/manifest 属于扩展构建）。
  publicDir: false,
  build: {
    outDir: 'dist/core',
    emptyOutDir: true,
    // 与主构建一致：不发 sourcemap（防源码随产物泄露）。
    sourcemap: false,
    // JSCore（macOS 11.3+ 提供 TextEncoder/TextDecoder）按 ES2020 目标转译。
    target: 'es2020',
    lib: {
      entry: resolve(import.meta.dirname, 'src/core/entry.ts'),
      name: 'BookmarkSyncCore',
      formats: ['iife'],
      fileName: () => 'bookmark-sync-core.js',
    },
  },
});
