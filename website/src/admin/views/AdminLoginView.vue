<script setup>
// 后台登录：邮箱 + 密码（与官网/扩展同账号体系）
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { adminSignIn } from '../lib/auth.js';

const route = useRoute();
const router = useRouter();
const email = ref('');
const password = ref('');
const busy = ref(false);
const error = ref('');

async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  const { error: err } = await adminSignIn(email.value.trim(), password.value);
  if (err) {
    error.value = err.message;
  } else {
    router.push(route.query.redirect || '/admin/');
  }
  busy.value = false;
}
</script>

<template>
  <div class="login-wrap">
    <form class="login-card" @submit.prevent="submit">
      <h1>BSYNC · Admin</h1>
      <p class="sub">仅限项目管理员登录。使用你的账号邮箱密码。</p>
      <label class="field">
        <span>邮箱</span>
        <input v-model="email" type="email" required autocomplete="username" />
      </label>
      <label class="field">
        <span>密码</span>
        <input v-model="password" type="password" required autocomplete="current-password" />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
      <button class="submit" type="submit" :disabled="busy">
        {{ busy ? '登录中…' : '登录' }}
      </button>
      <RouterLink to="/" class="back">← 返回官网</RouterLink>
    </form>
  </div>
</template>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-soft);
}
.login-card {
  width: 360px;
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 32px;
  box-shadow: var(--shadow-md);
}
h1 {
  font-size: 20px;
  margin: 0 0 4px;
}
.sub {
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 0 0 20px;
}
.field {
  display: block;
  margin-bottom: 14px;
  font-size: 13px;
}
.field span {
  display: block;
  margin-bottom: 4px;
  color: var(--color-text-soft);
}
.field input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 14px;
  box-sizing: border-box;
}
.error {
  color: #b91c1c;
  font-size: 13px;
  margin: 8px 0;
}
.submit {
  width: 100%;
  padding: 10px;
  background: var(--color-accent);
  color: #fff;
  border: 0;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  margin-top: 6px;
}
.submit:disabled {
  opacity: 0.6;
}
.back {
  display: block;
  text-align: center;
  margin-top: 14px;
  font-size: 13px;
  color: var(--color-text-muted);
  text-decoration: none;
}
</style>
