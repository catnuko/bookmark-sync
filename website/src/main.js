import { createApp, createSSRApp } from 'vue';
import { createHead } from '@unhead/vue';
import App from './App.vue';
import { createAppRouter } from './router';
import { i18n, setLocale } from './i18n';
import { localeFromPath } from './router/routes';
import { getTheme, applyTheme } from './theme';
import './styles/main.css';
import './admin/lib/auth.js'; // 副作用导入：注册 onAuthStateChange，adminAuth 供守卫使用

const isBrowser = typeof window !== 'undefined';

// URL 语言前缀是权威来源：进 /en/* 必须显示英文，否则 SSG 静态 HTML（英文）
// 与客户端渲染（中文）不一致 → hydration 报错 + 用户看到闪烁。
if (isBrowser) {
  setLocale(i18n, localeFromPath(window.location.pathname));
  applyTheme(getTheme());
}

async function bootstrap() {
  const isAdminRoute = isBrowser && window.location.pathname.startsWith('/admin');
  const router = createAppRouter(true);
  // ★ 修复（2026-10-09）：初始导航必须在 mount 之前触发。
  //
  //   旧写法 `await Promise.race([router.isReady(), timeout(400)])` 实测永远走兜底
  //   超时 —— 因为 router.isReady() 等待的「初始导航」只有 app.mount() 才会触发，
  //   我们在 mount **之前**就 await 它，等于死锁。探针（改源码→重建→量登录页可见
  //   时间）证实：200ms→329ms、3000ms→3058ms，出现时间 = 超时值 + 几十 ms，
  //   说明 isReady 从没真正 resolve，那 400ms 纯粹是兜底耗尽。后果：每个页面都白白
  //   延迟 400ms 才 hydrate，且掩盖了真实首屏时序（这也是此前「400ms 触发 40 条
  //   hydration 警告」的根，而非后台鉴权慢）。
  //
  //   正确做法：在 mount 之前手动 push 当前地址，让初始导航（含守卫判定）完成、
  //   isReady 立即 resolve。普通页瞬间完成；/admin 无 session 走快速路径
  //   （同步读 localStorage，零网络）也瞬间完成，有 session 才走一次 whoami
  //   （auth.js 里带 3s 兜底）。保留 5s 安全兜底防极端卡死，正常路径不会触发。
  const loc = window.location.pathname + window.location.search + window.location.hash;
  await Promise.race([
    router
      .push(loc)
      .catch(() => {})
      .then(() => router.isReady()),
    new Promise((r) => setTimeout(r, 5000)),
  ]);
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
