<script setup>
// 后台布局：左侧导航 + 顶栏 + 内容区。独立于官网 AppHeader/AppFooter。
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { adminAuth, adminSignOut } from "../lib/auth.js";

const route = useRoute();
const router = useRouter();

const nav = [
  { to: "/admin/", label: "概览", icon: "📊" },
  { to: "/admin/users", label: "用户", icon: "👥" },
  { to: "/admin/orders", label: "订单", icon: "🧾" },
  { to: "/admin/subscriptions", label: "订阅", icon: "💳" },
  { to: "/admin/licenses", label: "卡密", icon: "🔑" },
  { to: "/admin/system", label: "系统", icon: "🖥️" },
];

const current = computed(() => route.path);

async function logout() {
  await adminSignOut();
  router.push("/admin/login");
}
</script>

<template>
  <div class="admin-shell">
    <aside class="admin-side">
      <div class="brand">BSYNC · Admin</div>
      <nav>
        <RouterLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          :class="{ active: current === item.to }"
        >
          <span class="icon">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>
      <div class="side-foot">
        <RouterLink to="/" class="back-site">← 返回官网</RouterLink>
      </div>
    </aside>
    <div class="admin-main">
      <header class="admin-top">
        <div class="who">
          <span v-if="adminAuth.user">{{ adminAuth.user.email }}</span>
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
.nav-item:hover { background: rgba(255,255,255,0.06); color: #fff; }
.nav-item.active { background: var(--color-accent); color: #fff; }
.icon { width: 20px; text-align: center; }
.side-foot { margin-top: auto; padding: 12px; }
.back-site { color: #888; font-size: 13px; text-decoration: none; }
.back-site:hover { color: #fff; }

.admin-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.admin-top {
  height: 52px;
  background: #fff;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 20px;
}
.who { display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--color-text-soft); }
.btn-ghost {
  border: 1px solid var(--color-border);
  background: #fff;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.btn-ghost:hover { background: var(--color-bg-muted); }
.admin-content { padding: 24px; }
</style>
