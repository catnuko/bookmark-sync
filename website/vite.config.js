import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';
import { seoStaticPlugin } from './src/seo/vite-plugin.js';

// 官网静态站：构建产物输出到 website/dist/，可部署到 Cloudflare Pages / Vercel / Netlify
export default defineConfig({
  base: '/',
  plugins: [vue(), seoStaticPlugin()],
  // 开启 hydration mismatch 的精确节点日志。
  // 生产构建默认只报一句「contains mismatches」，无法定位；开启后 console.error
  // 会打出具体是哪个组件/属性的差异 —— scripts/check-hydration.mjs 依赖它。
  // 体积代价约 1KB，官网可接受。
  define: {
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
      },
    },
  },
});
