import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";
import { seoStaticPlugin } from "./src/seo/vite-plugin.js";

// 官网静态站：构建产物输出到 website/dist/，可部署到 Cloudflare Pages / Vercel / Netlify
export default defineConfig({
  base: "/",
  plugins: [vue(), seoStaticPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
      },
    },
  },
});
