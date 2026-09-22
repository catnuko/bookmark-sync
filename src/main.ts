import { createApp } from 'vue';
import App from './App.vue';
import { startLogViewer } from './logBridge.js';
import { uiLanguage } from './lib/i18n.js';

// html lang 跟随浏览器 UI 语言（字体渲染 / 无障碍）
document.documentElement.lang = uiLanguage();

// options 页面启动日志查看器：将 background SW 的 console.log 实时打印到本页控制台
if (location.pathname.includes('options') || location.href.includes('options.html')) {
  startLogViewer();
}

createApp(App).mount('#app');
