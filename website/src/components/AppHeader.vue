<script setup>
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ThemeToggle from './ThemeToggle.vue';
import LanguageToggle from './LanguageToggle.vue';
import LocalizedLink from './LocalizedLink.vue';
import AccountMenu from './AccountMenu.vue';
import { account, signOut } from '../lib/account.js';

const { t } = useI18n();

// 隐私/条款入口在页脚，页首导航只放主功能页。
// ★ 必须包含全部高价值落地页（含 /support）—— 页首导航是爬虫最先看到的内链，
//   漏掉某个页面等于告诉搜索引擎「这页不重要」。
const navItems = [
  { key: 'nav.home', to: '/' },
  { key: 'nav.pricing', to: '/pricing' },
  { key: 'nav.download', to: '/download' },
  { key: 'nav.docs', to: '/docs' },
  { key: 'nav.support', to: '/support' },
];

const mobileOpen = ref(false);
const signingOut = ref(false);

async function onMobileSignOut() {
  if (signingOut.value) return;
  signingOut.value = true;
  try {
    await signOut();
    mobileOpen.value = false;
  } finally {
    signingOut.value = false;
  }
}
</script>

<template>
  <header class="header">
    <div class="container header-inner">
      <LocalizedLink to="/" class="brand">
        <img src="/favicon.svg" alt="BookmarkSync" width="28" height="28" />
        <span class="brand-name">{{ t('brand.name') }}</span>
      </LocalizedLink>

      <nav class="nav-desktop">
        <LocalizedLink
          v-for="item in navItems"
          :key="item.key"
          :to="item.to"
          class="nav-link"
          active-class="active"
        >
          {{ t(item.key) }}
        </LocalizedLink>
      </nav>

      <div class="header-actions">
        <ThemeToggle />
        <LanguageToggle />
        <!-- 账户入口占据原「免费下载」的位置。账户 UI 必须在导航里：
             登录 / 看当前档位 / 登出都靠它，少了它登录成功后页面上不留痕迹、
             也没有登出路径。「免费下载」在 /download 页与 Hero 里都有，
             页首不必重复，且它抢走了登录入口的位置。 -->
        <AccountMenu />
        <button
          class="menu-toggle"
          :aria-label="t('common.viewAll')"
          @click="mobileOpen = !mobileOpen"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M4 7h16M4 12h16M4 17h16"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
    </div>

    <!-- 移动端导航 -->
    <Transition name="fade">
      <nav v-if="mobileOpen" class="nav-mobile">
        <LocalizedLink
          v-for="item in navItems"
          :key="item.key"
          :to="item.to"
          class="nav-link-mobile"
          active-class="active"
          @click="mobileOpen = false"
        >
          {{ t(item.key) }}
        </LocalizedLink>
        <!-- 窄屏下 header 的 AccountMenu 只剩档位徽章，邮箱与登出入口
             必须在这里再给一份，否则移动端没有登出路径。 -->
        <button
          v-if="account.user"
          class="nav-link-mobile nav-signout"
          type="button"
          :disabled="signingOut"
          @click="onMobileSignOut"
        >
          {{ signingOut ? t('account.processing') : t('account.signOut') }}
        </button>
      </nav>
    </Transition>
  </header>
</template>

<style scoped>
.header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--header-height);
  background: var(--color-header-bg);
  /* ★ 这两行是AccountDialog 必须 Teleport 到 body 的原因：
     backdrop-filter 会为所有后代创建包含块，弹窗的 fixed 定位会被困在 header 里。
     别为了「看起来没用到」删掉 —— 删了会让弹窗位置行为变化（虽然 Teleport 后无碍）。 */
  backdrop-filter: saturate(180%) blur(12px);
  -webkit-backdrop-filter: saturate(180%) blur(12px);
  border-bottom: 1px solid var(--color-border);
  z-index: 50;
}

.header-inner {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-6);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: 600;
  letter-spacing: -0.01em;
}

.brand-name {
  font-size: var(--text-base);
}

.nav-desktop {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.nav-link {
  padding: 0.5rem 0.875rem;
  font-size: var(--text-sm);
  color: var(--color-text-soft);
  border-radius: var(--radius-md);
  transition: all var(--transition);
}

.nav-link:hover {
  color: var(--color-text);
  background: var(--color-bg-muted);
}

.nav-link.active {
  color: var(--color-text);
  background: var(--color-bg-muted);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.menu-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  color: var(--color-text);
}

.menu-toggle:hover {
  background: var(--color-bg-muted);
}

.nav-mobile {
  display: flex;
  flex-direction: column;
  padding: var(--space-2) var(--container-pad);
  background: var(--color-bg);
  border-bottom: 1px solid var(--color-border);
}

.nav-link-mobile {
  padding: 0.875rem 0.5rem;
  font-size: var(--text-base);
  color: var(--color-text-soft);
  border-bottom: 1px solid var(--color-border);
}

.nav-link-mobile.active {
  color: var(--color-text);
  font-weight: 500;
}

.nav-signout {
  width: 100%;
  text-align: left;
  color: #dc2626;
}

.nav-signout:disabled {
  opacity: 0.6;
}

/* 导航 5 项 + logo + 主题/语言/账户入口在窄桌面会挤：先压按钮内边距，
   再收进汉堡菜单。断点 1024 对应常见笔记本窄屏。 */
@media (max-width: 1024px) {
  .nav-link {
    padding: 0.5rem 0.625rem;
    font-size: var(--text-xs);
  }
  .header-inner {
    gap: var(--space-4);
  }
}

@media (max-width: 768px) {
  .nav-desktop {
    display: none;
  }
  .menu-toggle {
    display: inline-flex;
  }
}
</style>
