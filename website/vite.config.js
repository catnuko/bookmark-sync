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
    // ★ 必须关掉 CSS 分包，否则 SSG 出来的页面**全是无样式的**。
    //
    // 原因：默认 cssCodeSplit:true 会把每个懒加载视图的样式拆成独立 chunk
    // （HomeView-xxx.css / PricingView-xxx.css …共 22 个），而这些 chunk 的
    // <link> 是 **JS 运行时**动态插入的 —— vite只把同步引入的 main.css 写进
    // index.html 的 <head>。
    // 结果：SSG 输出的是完整 HTML，但 <head> 里只有 main.css，浏览器首屏
    //   先渲染出无样式的裸文本 → 用户看到「样式全部乱套」；
    //   等 JS 执行完CSS 才补上，产生明显闪烁。
    //
    // 实测证据：线上首页 <head> 只有 main-DX2KLIlB.css，浏览器从未请求
    //   HomeView-B207dUQ1.css；.preview-folder 的计算样式是 display:block
    //   padding:0（应为 flex + 有padding），即样式根本没生效。
    //
    // ★ 这类问题**构建期不会报错、自检脚本也查不出**（HTML 完整、JS 无错），
    //   只有真浏览器看首屏才暴露 → 已加入 check-hydration.mjs 的必检项。
    cssCodeSplit: false,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
      },
    },
  },
});
