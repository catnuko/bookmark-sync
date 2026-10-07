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
  const isAdminRoute = isBrowser && window.location.pathname.startsWith('/admin');
  // 仅访问后台路由时等待管理员鉴权就绪，避免影响官网首屏
  if (isAdminRoute) {
    try {
      // ★ 必须加超时。adminReady 内部要请求 Supabase（刷新会话/查 profile）：
      //   - 本地或 env 缺配置时请求会挂起或长时间 pending；
      //   - 网络不通时同理。
      //   而 bootstrap 是 async 且串行 await 它 —— 一旦挂住，**整个应用永远不挂载**，
      //   页面停在 SSG 预渲染出来的内容上（看起来像「路由没生效」），
      //   且没有报错，只是永远安静着。2026-10-07 实际被这个卡过一次。
      //   守卫 requireAdmin 会在挂载后自己处理未登录状态，这里等不到也无妨。
      await Promise.race([adminReady, new Promise((r) => setTimeout(r, 3000))]);
    } catch {
      /* 后端迁移未部署时按未登录走，守卫会跳登录页 */
    }
  }
  const router = createAppRouter(true);
  // ★ 必须等router.isReady() 再挂载。
  //   RouterLink 的 active class（router-link-active）依赖 currentRoute，
  //   SSG 产物里已经带了这些 class；客户端若在路由解析完成前就 hydrate，
  //   会算出「无 active」→ class mismatch（首屏导航高亮还会闪一下）。
  //
  //   同样要加超时：守卫 requireAdmin 内部还会await 鉴权，若那条链挂住，
  //   isReady() 永远不resolve → 又停在预渲染内容上（2026-10-07 实测卡在这里）。
  await Promise.race([router.isReady(), new Promise((r) => setTimeout(r, 3000))]);
  // SSG 已渲染出 DOM 时必须走 createSSRApp。否则 Vue 丢弃现有 DOM 重建：
  // SEO meta 丢失、正文丢失、无 JS 用户看到空页。
  const el = document.getElementById('app');
  // ★ /admin 永远走 createApp，并把容器清空。
  //   后台是纯客户端（懒加载视图 + 鉴权守卫），**从不进 SSG**。而 vercel rewrites
  //   把 /admin/* 指向某个 HTML —— 哪怕我们专门生成了空壳，也可能因为任何原因
  //   拿到带预渲染 DOM 的页面。此时 createSSRApp 会拿首页的 DOM 去 hydrate admin
  //   路由：两者不符 → **页面停在首页，URL 不跳转、无报错、无失败请求**
  //   （2026-10-07 实际发生，极难定位）。
  //   清空 + createApp 是幂等的：内容本来就是后台自己的，不存在需要保留的 SEO。
  if (isAdminRoute) {
    el.innerHTML = '';
  }
  const app = isAdminRoute
    ? createApp(App)
    : el.hasChildNodes()
      ? createSSRApp(App)
      : createApp(App);
  app.use(createHead()); // Unhead：管理 title / meta / link / script (JSON-LD)
  app.use(router);
  app.use(i18n);
  app.mount('#app');
}
bootstrap();
