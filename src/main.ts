import { createApp } from 'vue';
import App from './App.vue';
import { startLogViewer } from './logBridge.js';
import { uiLanguage } from './lib/i18n.js';
import { initTheme } from './lib/theme.js';

// html lang 跟随浏览器 UI 语言（字体渲染 / 无障碍）
document.documentElement.lang = uiLanguage();

// ★ 主题必须尽早应用（在 createApp 之前）：晚一帧就会先按浅色画再翻深色（FOUC）。
// 只有 options 页面走这条入口；popup-main.ts 不调 → 弹窗维持无主题状态。
initTheme();

// options 页面启动日志查看器：将 background SW 的 console.log 实时打印到本页控制台
if (location.pathname.includes('options') || location.href.includes('options.html')) {
  startLogViewer();
}

createApp(App).mount('#app');
