<script setup>
import { adminSignOut } from '../lib/auth.js';
</script>

<template>
  <div class="f-wrap">
    <h1>403</h1>
    <p>当前账号不是 BookmarkSync 项目管理员，无法访问后台。</p>
    <p v-if="false"></p>
    <button @click="adminSignOut">退出并换号</button>
    <RouterLink to="/">返回官网</RouterLink>
  </div>
</template>

<style scoped>
.f-wrap {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  justify-content: center;
  font-family: var(--font-sans);
}
h1 {
  font-size: 56px;
  margin: 0;
  color: #b91c1c;
}
button {
  padding: 8px 16px;
  background: var(--color-accent);
  color: #fff;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}
</style>
