import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';

// 多入口构建：options（选项页，Vue 3）+ background（MV3 service worker）
// 产物输出到 extension/，manifest.json 由 public/ 一并拷贝。
export default defineConfig({
  base: './',
  plugins: [vue()],
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    sourcemap: true,
  },
  build: {
    outDir: 'extension',
    emptyOutDir: true,
    // 显式关闭生产 sourcemap：防止 .map 随扩展 zip 分发泄露源码。
    // （release.yml 的 CI 同样跑 vite build，这里一处关掉即同时覆盖本地和 CI。）
    sourcemap: false,
    rollupOptions: {
      input: {
        options: resolve(import.meta.dirname, 'options.html'),
        popup: resolve(import.meta.dirname, 'popup.html'),
        background: resolve(import.meta.dirname, 'src/background.js'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
