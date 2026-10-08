<script setup>
// 登录 / 注册弹窗 —— 官网订阅前需要先有 Supabase 登录态（与扩展同账号）
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { signIn, signUp } from '../lib/account.js';

// ★ 必须 Teleport 到 body。
//   弹窗从两处唤起：AppHeader 内的 AccountMenu、以及 PricingCard。前者踩坑：
//   `.header` 上有 `backdrop-filter: blur(12px)` —— **backdrop-filter 会给所有
//   后代创建包含块**，于是弹窗的 `position: fixed; inset: 0` 不再相对视口，
//   而只相对那个 64px 高的 header 条 → 弹窗被顶到视口上方、标题被裁掉
//   （2026-10-08 用户实机截图报「弹窗怎么这么奇怪」）。
//   Teleport 到 body 后 fixed 重新相对视口，与唤起方的 DOM 位置彻底解耦。
//   ★ 只 Teleport 会丢样式 —— scoped 的选择器带 [data-v-x] 属性。Vue 会把该属性
//   加到 Teleport 的子节点上，所以样式照常生效，无需 :deep 或全局样式。
//   z-index 也要抬过 header 的 50（mask 原本是 100，但被 header 的包含块困住时
//   层级再高也只在 header 那一层内比较）。

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
  <Teleport to="body">
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
  </Teleport>
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
