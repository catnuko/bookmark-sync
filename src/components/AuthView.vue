<template>
  <div class="auth-view">
    <div class="popup-chrome">
      <span class="ext-ico">B</span>
      <span class="ext-name">Bookmark Sync</span>
      <span class="win-dots"><i></i><i></i><i></i></span>
    </div>

    <div class="auth-body">
      <div class="auth-brand">
        <div class="brandmark">B</div>
        <h1>{{ t('auth_h1') }}</h1>
        <p class="sub">{{ t('auth_sub') }}</p>
      </div>

      <SegTabs
        v-model="state.mode"
        :options="[
          { value: 'login', label: t('auth_login') },
          { value: 'register', label: t('auth_register') },
        ]"
        :aria-label="t('auth_tabsAria')"
      />

      <div class="field">
        <label for="email">{{ t('auth_email') }}</label>
        <input
          id="email"
          v-model="state.email"
          class="input"
          type="email"
          :placeholder="t('auth_emailPh')"
          autocomplete="email"
          :aria-label="t('auth_email')"
        />
      </div>
      <div class="field">
        <label for="password">{{ t('auth_password') }}</label>
        <input
          id="password"
          v-model="state.password"
          class="input"
          type="password"
          :placeholder="state.mode === 'login' ? t('auth_pwPhLogin') : t('auth_pwPhRegister')"
          autocomplete="current-password"
          :aria-label="t('auth_password')"
          @keyup.enter="submit"
        />
      </div>

      <button id="authSubmit" class="btn btn-primary btn-lg" :disabled="state.busy" @click="submit">
        <span v-if="state.busy" class="spinner" />
        {{ state.mode === 'login' ? t('auth_login') : t('auth_create') }}
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
        {{ t('auth_hint') }}
      </div>

      <div class="popup-foot">
        <button type="button" class="link-btn" @click="openHelp">{{ t('auth_forgot') }}</button>
        <i class="fw-sep"></i>
        <button type="button" class="link-btn" @click="openHelp">{{ t('common_help') }}</button>
        <i class="fw-sep"></i>
        <!-- 未登录是硬门禁（App.vue 只渲染本组件），所以反馈入口只能放这儿 -->
        <a class="link-btn" :href="mailtoHref">{{ t('feedback_mailto') }}</a>
      </div>
    </div>
  </div>
</template>

<script setup>
import { state, submit, openHelp } from '../store.js';
import { t } from '../lib/i18n.js';
import { buildMailto } from '../lib/feedback.js';
import SegTabs from './ui/SegTabs.vue';
import Icon from './ui/Icon.vue';

// 登录页的反馈兜底：带版本/平台直接发邮件（用户可能正是因为登录不上才需要反馈）
const mailtoHref = buildMailto(t('feedback_title'), t('feedback_bodyPh'));
</script>

<style scoped>
a.link-btn {
  text-decoration: none;
}
</style>
