<script setup>
// 后台布局：左侧导航 + 顶栏 + 内容区。独立于官网 AppHeader/AppFooter（App.vue 按路由 meta.admin 隐藏外壳）。
// ≤768px：侧栏收起为抽屉，顶栏汉堡按钮唤出，遮罩 / Esc / 选中导航项后自动关闭。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { adminAuth, adminSignOut } from '../lib/auth.js';

const route = useRoute();
const router = useRouter();

const nav = [
  { to: '/admin/', label: '概览', icon: '📊' },
  { to: '/admin/users', label: '用户', icon: '👥' },
  { to: '/admin/orders', label: '订单', icon: '🧾' },
  { to: '/admin/subscriptions', label: '订阅', icon: '💳' },
  { to: '/admin/audit', label: '审计', icon: '📋' },
  { to: '/admin/feedback', label: '反馈', icon: '💬' },
  { to: '/admin/system', label: '系统', icon: '🖥️' },
];

const current = computed(() => route.path);

const drawerOpen = ref(false);
function closeDrawer() {
  drawerOpen.value = false;
}

// 切页面后抽屉收起（点导航项也直接关，双保险）
watch(() => route.path, closeDrawer);

// 抽屉打开时锁背景滚动（只在打开期间临时加，避免破坏桌面端侧栏 sticky）
watch(drawerOpen, (open) => {
  document.body.style.overflow = open ? 'hidden' : '';
});

// 视口变宽（含横屏）回到桌面布局时收起抽屉，避免遮罩残留
let desktopMq = null;
function onMqChange(e) {
  if (e.matches) closeDrawer();
}
function onKeydown(e) {
  if (e.key === 'Escape') closeDrawer();
}

onMounted(() => {
  desktopMq = window.matchMedia('(min-width: 769px)');
  desktopMq.addEventListener('change', onMqChange);
  window.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  desktopMq?.removeEventListener('change', onMqChange);
  window.removeEventListener('keydown', onKeydown);
  document.body.style.overflow = '';
});

async function logout() {
  await adminSignOut();
  router.push('/admin/login');
}
</script>

<template>
  <div class="admin-shell" :class="{ 'drawer-open': drawerOpen }">
    <aside id="admin-nav" class="admin-side">
      <div class="brand">BSYNC · Admin</div>
      <nav>
        <RouterLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          :class="{ active: current === item.to }"
          @click="closeDrawer"
        >
          <span class="icon">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>
      <div class="side-foot">
        <RouterLink to="/" class="back-site">← 返回官网</RouterLink>
      </div>
    </aside>

    <button
      v-if="drawerOpen"
      class="scrim"
      type="button"
      aria-label="关闭菜单"
      @click="closeDrawer"
    ></button>

    <div class="admin-main">
      <header class="admin-top">
        <button
          class="menu-btn"
          type="button"
          aria-label="打开菜单"
          aria-controls="admin-nav"
          :aria-expanded="drawerOpen"
          @click="drawerOpen = !drawerOpen"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 7h16M4 12h16M4 17h16"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        </button>
        <div class="who">
          <span v-if="adminAuth.user" class="who-mail">{{ adminAuth.user.email }}</span>
          <button class="btn-ghost" @click="logout">退出</button>
        </div>
      </header>
      <main class="admin-content">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.admin-shell {
  display: flex;
  min-height: 100vh;
  background: var(--color-bg-soft);
}
.admin-side {
  width: 220px;
  background: #111214;
  color: #e5e5e5;
  display: flex;
  flex-direction: column;
  padding: 20px 12px;
  position: sticky;
  top: 0;
  height: 100vh;
}
.brand {
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 4px 12px 20px;
  color: #fff;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 8px;
  color: #b8b8b8;
  text-decoration: none;
  font-size: 14px;
  margin-bottom: 2px;
}
.nav-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}
.nav-item.active {
  background: var(--color-accent);
  color: #fff;
}
.icon {
  width: 20px;
  text-align: center;
}
.side-foot {
  margin-top: auto;
  padding: 12px;
}
.back-site {
  color: #888;
  font-size: 13px;
  text-decoration: none;
}
.back-site:hover {
  color: #fff;
}

/* 遮罩只在移动端抽屉打开时出现 */
.scrim {
  display: none;
}

.admin-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.admin-top {
  height: 52px;
  background: #fff;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
}
.menu-btn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin-left: -10px;
  border-radius: 8px;
  color: var(--color-text);
}
.menu-btn:hover {
  background: var(--color-bg-muted);
}
.who {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
  font-size: 13px;
  color: var(--color-text-soft);
}
.who-mail {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.btn-ghost {
  border: 1px solid var(--color-border);
  background: #fff;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.btn-ghost:hover {
  background: var(--color-bg-muted);
}
.admin-content {
  padding: 24px;
}

@media (max-width: 768px) {
  .admin-side {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(280px, 80vw);
    height: auto;
    overflow-y: auto;
    padding: max(20px, env(safe-area-inset-top)) 12px calc(12px + env(safe-area-inset-bottom));
    transform: translateX(-100%);
    /* visibility 让收起的抽屉脱离 tab 序 / 无障碍树 */
    visibility: hidden;
    transition:
      transform 220ms var(--ease-out),
      visibility 220ms;
    z-index: 60;
  }
  .drawer-open .admin-side {
    transform: none;
    visibility: visible;
  }
  .scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 55;
    background: rgba(0, 0, 0, 0.42);
    padding: 0;
    border: 0;
    touch-action: none;
  }
  .menu-btn {
    display: inline-flex;
  }
  .admin-top {
    height: 56px;
    padding: 0 max(12px, env(safe-area-inset-right)) 0 max(12px, env(safe-area-inset-left));
  }
  .admin-content {
    padding: 16px;
  }
}

@media (max-width: 380px) {
  .who-mail {
    display: none;
  }
}
</style>
