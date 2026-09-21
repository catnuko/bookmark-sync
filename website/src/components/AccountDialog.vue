<script setup>
// 登录 / 注册弹窗 —— 官网订阅前需要先有 Supabase 登录态（与扩展同账号）
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { signIn, signUp } from '../lib/account.js';

const emit = defineEmits(['close']);

const { t } = useI18n();
const mode = ref('login'); // login / register
const email = ref('');
const password = ref('');
const busy = ref(false);
const error = ref('');
const info = ref('');

async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  info.value = '';
  try {
    const fn = mode.value === 'login' ? signIn : signUp;
    const { error: err, needsEmailConfirm } = await fn(email.value.trim(), password.value);
    if (err) {
      error.value = err.message;
    } else if (needsEmailConfirm) {
      info.value = t('account.emailConfirmSent');
    } else {
      emit('close');
    }
  } catch (e) {
    error.value = e?.message || String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="dialog-mask" @click.self="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true">
      <h3 class="dialog-title">
        {{ mode === 'login' ? t('account.loginTitle') : t('account.registerTitle') }}
      </h3>
      <p class="dialog-sub">{{ t('account.loginSub') }}</p>

      <form @submit.prevent="submit">
        <label class="field">
          <span>{{ t('account.email') }}</span>
          <input v-model="email" type="email" required autocomplete="email" />
        </label>
        <label class="field">
          <span>{{ t('account.password') }}</span>
          <input
            v-model="password"
            type="password"
            required
            minlength="6"
            autocomplete="current-password"
          />
        </label>

        <p v-if="error" class="dialog-error">{{ error }}</p>
        <p v-if="info" class="dialog-info">{{ info }}</p>

        <button class="btn btn-primary dialog-submit" type="submit" :disabled="busy">
          {{
            busy
              ? t('account.processing')
              : mode === 'login'
                ? t('account.login')
                : t('account.register')
          }}
        </button>
      </form>

      <button
        class="dialog-switch"
        type="button"
        @click="mode = mode === 'login' ? 'register' : 'login'"
      >
        {{ mode === 'login' ? t('account.toRegister') : t('account.toLogin') }}
      </button>
      <button
        class="dialog-close"
        type="button"
        :aria-label="t('account.close')"
        @click="emit('close')"
      >
        ✕
      </button>
    </div>
  </div>
</template>

<style scoped>
.dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  padding: var(--space-4);
}

.dialog {
  position: relative;
  width: 100%;
  max-width: 24rem;
  padding: var(--space-8);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}

.dialog-title {
  font-size: var(--text-xl);
  font-weight: 600;
  margin-bottom: var(--space-1);
}

.dialog-sub {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin-bottom: var(--space-6);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-bottom: var(--space-4);
  font-size: var(--text-sm);
  font-weight: 500;
}

.field input {
  padding: 0.625rem 0.75rem;
  font-size: var(--text-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
}

.dialog-error {
  font-size: var(--text-sm);
  color: #dc2626;
  margin-bottom: var(--space-3);
}

.dialog-info {
  font-size: var(--text-sm);
  color: var(--color-accent);
  margin-bottom: var(--space-3);
}

.dialog-submit {
  width: 100%;
  margin-top: var(--space-2);
}

.dialog-switch {
  margin-top: var(--space-4);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  text-decoration: underline;
}

.dialog-close {
  position: absolute;
  top: var(--space-4);
  right: var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
</style>
