import { createApp, createSSRApp } from 'vue';
import { createHead } from '@unhead/vue';
import App from './App.vue';
import { createAppRouter } from './router';
import { i18n, setLocale } from './i18n';
import { localeFromPath } from './router/routes';
import { getTheme, applyTheme } from './theme';
import './styles/main.css';
import { adminReady } from './admin/lib/auth.js';

const isBrowser = typeof window !== 'undefined';

// URL 语言前缀是权威来源：进 /en/* 必须显示英文，否则 SSG 静态 HTML（英文）
// 与客户端渲染（中文）不一致 → hydration 报错 + 用户看到闪烁。
if (isBrowser) {
  setLocale(i18n, localeFromPath(window.location.pathname));
  applyTheme(getTheme());
}

async function bootstrap() {
  // 仅访问后台路由时等待管理员鉴权就绪，避免影响官网首屏
  if (isBrowser && window.location.pathname.startsWith('/admin')) {
    try {
      await adminReady;
    } catch {
      /* 后端迁移未部署时按未登录走，守卫会跳登录页 */
    }
  }
  const router = createAppRouter(true);
  // ★ 必须等router.isReady() 再挂载。
  //   RouterLink 的 active class（router-link-active）依赖 currentRoute，
  //   SSG 产物里已经带了这些 class；客户端若在路由解析完成前就 hydrate，
  //   会算出「无 active」→ class mismatch（首屏导航高亮还会闪一下）。
  await router.isReady();
  // SSG 已渲染出 DOM 时必须走 createSSRApp。否则 Vue 丢弃现有 DOM 重建：
  // SEO meta 丢失、正文丢失、无 JS 用户看到空页。
  const el = document.getElementById('app');
  const app = el.hasChildNodes() ? createSSRApp(App) : createApp(App);
  app.use(createHead()); // Unhead：管理 title / meta / link / script (JSON-LD)
  app.use(router);
  app.use(i18n);
  app.mount('#app');
}
bootstrap();