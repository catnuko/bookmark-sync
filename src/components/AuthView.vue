<template>
  <div class="auth-view">
    <div class="auth-brand">
      <div class="brandmark"><Icon name="bookmark" /></div>
      <h1>Bookmark Sync</h1>
      <p class="sub">在浏览器间安全同步你的书签</p>
    </div>

    <SegTabs
      v-model="state.mode"
      :options="[{ value: 'login', label: '登录' }, { value: 'register', label: '注册' }]"
      aria-label="登录或注册"
    />

    <input
      id="email"
      v-model="state.email"
      class="input"
      type="email"
      placeholder="邮箱地址"
      autocomplete="email"
      aria-label="邮箱"
    />
    <input
      id="password"
      v-model="state.password"
      class="input"
      type="password"
      :placeholder="state.mode === 'login' ? '密码' : '密码（至少 6 位）'"
      autocomplete="current-password"
      aria-label="密码"
      @keyup.enter="submit"
    />

    <button id="authSubmit" class="btn btn-primary btn-lg" :disabled="state.busy" @click="submit">
      <span v-if="state.busy" class="spinner" />
      {{ state.mode === "login" ? "登录" : "创建账号" }}
    </button>

    <div v-if="state.authSuccess" class="banner banner-success">
      <Icon name="check-circle" />
      <span>{{ state.authSuccess }}</span>
    </div>
    <div v-if="state.authError" class="banner banner-danger">
      <Icon name="alert" />
      <span>{{ state.authError }}</span>
    </div>

    <div class="auth-hint">
      按 <kbd>Enter</kbd> 提交
    </div>

    <div class="popup-foot">
      <button type="button" class="link-btn" @click="openHelp">帮助</button>
      <i class="fw-sep"></i>
      <button type="button" class="link-btn" @click="openSettings">设置</button>
    </div>
  </div>
</template>

<script setup>
import { state, submit, openHelp, openSettings } from "../store.js";
import SegTabs from "./ui/SegTabs.vue";
import Icon from "./ui/Icon.vue";
</script>
