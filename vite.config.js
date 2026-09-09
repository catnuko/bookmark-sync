import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";

// 多入口构建：options（选项页，Vue 3）+ background（MV3 service worker）
// 产物输出到 extension/，manifest.json 由 public/ 一并拷贝。
export default defineConfig({
  base: "./",
  plugins: [vue()],
  build: {
    outDir: "extension",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        options: resolve(import.meta.dirname, "options.html"),
        popup: resolve(import.meta.dirname, "popup.html"),
        background: resolve(import.meta.dirname, "src/background.js"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});