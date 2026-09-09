import { createApp } from "vue";
import { createHead } from "@unhead/vue";
import App from "./App.vue";
import { router } from "./router";
import { i18n, setLocale } from "./i18n";
import "./styles/main.css";

// 同步 html lang 属性（SPA 阶段在客户端执行；SSR/SSG 时由 i18n 模块自身判断环境）
if (typeof window !== "undefined") {
  setLocale(i18n.global.locale.value);
}

const app = createApp(App);
app.use(createHead()); // Unhead：管理 title / meta / link / script (JSON-LD)
app.use(router);
app.use(i18n);
app.mount("#app");
