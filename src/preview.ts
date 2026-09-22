// 开发用视觉预览入口（不参与扩展构建；vite.config.js 只把 options/popup/background 作为入口）。
// 用途：在普通浏览器里直接渲染真实 Vue 组件 + 真实 tokens.css，便于对照设计稿做视觉验收。
// 用法：pnpm dev 后打开 /preview.html?view=popup|key|spaces|auth|options&pane=sync
import { createApp, h } from 'vue';
import './styles/tokens.css';
import zhMessages from '../public/_locales/zh_CN/messages.json';
import type { Session } from '@supabase/supabase-js';
import { state } from './store.js';

// 普通浏览器没有 chrome.i18n：mock 成中文语言包，让预览渲染真实文案而非键名
(globalThis as typeof globalThis & { chrome: { i18n: PreviewI18n } }).chrome = {
  i18n: {
    getMessage: (key: string, subs?: string[]) => {
      const msg =
        (
          zhMessages as Record<
            string,
            { message?: string; placeholders?: Record<string, { content: string }> }
          >
        )[key]?.message ?? '';
      return Array.isArray(subs)
        ? msg.replace(/\$([A-Z_]+)\$/g, (_, name: string) => {
            const ph = (
              zhMessages as Record<
                string,
                { message?: string; placeholders?: Record<string, { content: string }> }
              >
            )[key]?.placeholders?.[name.toLowerCase()];
            return ph ? (subs[parseInt(ph.content.slice(1), 10) - 1] ?? '') : '';
          })
        : msg;
    },
    getUILanguage: () => 'zh-CN',
  },
};

interface PreviewI18n {
  getMessage(key: string, subs?: string[]): string;
  getUILanguage(): string;
}

import PopupView from './components/PopupView.vue';
import AuthView from './components/AuthView.vue';
import OptionsView from './components/OptionsView.vue';
import PhraseGate from './components/PhraseGate.vue';

const q = new URLSearchParams(location.search);
const view = q.get('view') || 'popup';
const pane = q.get('pane') || 'sync';

// ---- 演示数据（真实观感，避免空态） ----
const KEY = '7Kd93mQvZp2xR8nLwT4hYb6sVc1aJfEoNuG5iB0rXzMdQp';

state.email = 'lin.wei@example.com';
// 模拟会话：仅预览用，字段不求齐真 Session（真实 Session 只来自 supabase.auth）
state.session = {
  user: { email: 'lin.wei@example.com' },
  access_token: 'demo',
} as unknown as Session;
state.profile = { plan: 'free', used_count: 128, used_bytes: 0, quota_bytes: 0 };
state.serverCount = 128;
state.lastSyncAt = Date.now() - 2 * 60 * 1000;
state.lastSyncStatus = 'ok';
state.lastSyncSummary = JSON.stringify({
  seeded: false,
  restored: false,
  push: false,
  pull: true,
  dec: 0,
});
state.lastDecryptErrors = null;
state.hasKeyNow = true;
state.keyStateLoaded = true;
state.keyValue = KEY;
state.autoSync = true;
state.myDeviceId = 'd1';

// 让设置页「加密」面板也能显示密钥（模拟本机已生成密钥；KeyPanel 挂载时会 loadKeyPanel 读取它）
// 本文件顶部已把 globalThis.chrome 替换成只有 i18n 的 mock（api 在模块加载时捕获的是
// preview.html 注入的完整 mock，不受影响）；这里直接访问 storage 原 JS 会抛 TypeError
// 被 catch 吞掉，用可选链等价地静默跳过。
try {
  const g = globalThis as typeof globalThis & {
    chrome?: { storage?: { local?: { set: (v: Record<string, unknown>) => void } } };
  };
  g.chrome?.storage?.local?.set({ 'crdt.e2eeKey': KEY });
} catch {}

state.spaces = [
  { id: 's1', name: '个人书签', bookmark_count: 128, device_count: 2, is_default: true },
  { id: 's2', name: '工作 · 设计资料', bookmark_count: 64, device_count: 1 },
  { id: 's3', name: '生活收藏', bookmark_count: 12, device_count: 1 },
];
state.activeSpace = state.spaces[0];
state.devices = [
  {
    device_id: 'd1',
    device_name: 'MacBook Pro',
    space_id: 's1',
    space_name: '个人书签',
    last_sync_at: Date.now() - 2 * 60 * 1000,
  },
  {
    device_id: 'd2',
    device_name: 'Firefox · 台式机',
    space_id: 's2',
    space_name: '工作 · 设计资料',
    last_sync_at: Date.now() - 60 * 60 * 1000,
  },
];

if (pane) state.navPane = pane;

const isPopup = view === 'popup' || view === 'key' || view === 'spaces';
if (isPopup) {
  // 不加 body.popup：preview.html 的 dev-frame 已用 #app{width:400px;height:600px} 还原弹窗尺寸，
  // 若再加 popup 类会与 dev-frame 的 padding 冲突（body 又被压到固定宽高）。
  state.drawer = view === 'key' ? 'key' : view === 'spaces' ? 'spaces' : '';
} else if (view === 'gate') {
  // 口令门禁页：?mode=setup|verify（默认 setup）
  state.phraseGateVisible = true;
  state.phraseGateMode = q.get('mode') === 'verify' ? 'verify' : 'setup';
} else {
  state.session = view === 'auth' ? null : state.session;
}

document.body.classList.add('dev-frame', `view-${view}`);

const Comp =
  view === 'auth' ? AuthView : view === 'gate' ? PhraseGate : isPopup ? PopupView : OptionsView;
createApp({ render: () => h(Comp) }).mount('#app');

// 开发辅助：?fill=<px> 往当前滚动容器注入超长块，用于演示「固定高度 + 内容区自滚动 + 滚动条样式」。
const fill = Number(q.get('fill') || 0);
if (fill > 0) {
  requestAnimationFrame(() => {
    const host = document.querySelector('.drawer-body, .popup-body, .auth-body, .opt-content');
    if (!host) return;
    const box = document.createElement('div');
    box.style.cssText =
      'height:' +
      fill +
      'px;flex:none;border-radius:12px;' +
      'background:repeating-linear-gradient(45deg,#f3f3f1 0 14px,#ececea 14px 28px)';
    host.appendChild(box);
  });
}
