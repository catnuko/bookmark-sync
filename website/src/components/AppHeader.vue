<script setup>
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { toggleLocale } from '../i18n';
import ThemeToggle from './ThemeToggle.vue';
import LanguageToggle from './LanguageToggle.vue';

const { t } = useI18n();

// 隐私/条款入口在页脚，页首导航只放主功能页
const navItems = [
  { key: 'nav.home', to: '/' },
  { key: 'nav.pricing', to: '/pricing' },
  { key: 'nav.download', to: '/download' },
  { key: 'nav.docs', to: '/docs' },
];

const mobileOpen = ref(false);
</script>

<template>
  <header class="header">
    <div class="container header-inner">
      <RouterLink to="/" class="brand">
        <img src="/favicon.svg" alt="BookmarkSync" width="28" height="28" />
        <span class="brand-name">{{ t('brand.name') }}</span>
      </RouterLink>

      <nav class="nav-desktop">
        <RouterLink
          v-for="item in navItems"
          :key="item.key"
          :to="item.to"
          class="nav-link"
          active-class="active"
        >
          {{ t(item.key) }}
        </RouterLink>
      </nav>

      <div class="header-actions">
        <ThemeToggle />
        <LanguageToggle />
        <RouterLink to="/download" class="btn btn-primary header-cta">
          {{ t('hero.ctaPrimary') }}
        </RouterLink>
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
        <RouterLink
          v-for="item in navItems"
          :key="item.key"
          :to="item.to"
          class="nav-link-mobile"
          active-class="active"
          @click="mobileOpen = false"
        >
          {{ t(item.key) }}
        </RouterLink>
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

.header-cta {
  padding: 0.5rem 1rem;
  font-size: var(--text-sm);
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

@media (max-width: 768px) {
  .nav-desktop {
    display: none;
  }
  .menu-toggle {
    display: inline-flex;
  }
  .header-cta {
    display: none;
  }
}
</style>
