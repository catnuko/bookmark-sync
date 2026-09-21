import { createApp } from 'vue';
import { createHead } from '@unhead/vue';
import App from './App.vue';
import { router } from './router';
import { i18n, setLocale } from './i18n';
import { getTheme, applyTheme } from './theme';
import './styles/main.css';
import { adminReady } from './admin/lib/auth.js';

// 同步 html lang 属性与主题（SPA 阶段在客户端执行；SSR/SSG 时由 i18n 模块自身判断环境）
if (typeof window !== 'undefined') {
  setLocale(i18n.global.locale.value);
  applyTheme(getTheme());
}

async function bootstrap() {
  // 仅访问后台路由时等待管理员鉴权就绪，避免影响官网首屏
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
    try {
      await adminReady;
    } catch {
      /* 后端迁移未部署时按未登录走，守卫会跳登录页 */
    }
  }
  const app = createApp(App);
  app.use(createHead()); // Unhead：管理 title / meta / link / script (JSON-LD)
  app.use(router);
  app.use(i18n);
  app.mount('#app');
}
bootstrap();
