// tsc 解析非 TS 模块的声明（.vue / .css 由 Vite 实际处理，tsc 只需能解析导入）。
// 注意：本文件保持无顶层 import/export，作为全局 ambient 声明生效。
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
declare module '*.css';
