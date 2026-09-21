import { createApp } from 'vue';
import App from './App.vue';
import { uiLanguage } from './lib/i18n.js';

// html lang 跟随浏览器 UI 语言（字体渲染 / 无障碍）
document.documentElement.lang = uiLanguage();

createApp(App, { popup: true }).mount('#app');
