<script setup>
// 官网账户菜单 —— 页首右上角的登录态入口。
//
// 为什么必须有（2026-10-08）：AccountDialog 只能从定价页 CTA 唤起，登录成功后
// 页面上不留任何痕迹 —— 用户看不出自己登录了，更没有登出入口。signOut() 一度
// 零调用点。这条路径把「登录 / 看状态 / 登出」补成常态入口，不再依赖先滚到定价页。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { account, openPortal, signOut } from '../lib/account.js';
import AccountDialog from './AccountDialog.vue';
import LocalizedLink from './LocalizedLink.vue';

const { t } = useI18n();

const open = ref(false);
const showLogin = ref(false);
const busy = ref(false);
const error = ref('');
const root = ref(null);

const signedIn = computed(() => !!account.user);

// plan 为 null = 拉取失败，**不是** free。两者必须显示不同文案，
// 否则付费用户在网络抖动时会看到「订阅 Pro」而再买一次。
const planKey = computed(() => {
  if (account.error) return 'account.planUnknown';
  return `pricing.plans.${account.plan || 'free'}.name`;
});

const hasActiveSub = computed(
  () =>
    !!account.subscription &&
    ['active', 'scheduled_cancel', 'past_due'].includes(account.subscription.status),
);

async function onManage() {
  if (busy.value) return;
  error.value = '';
  busy.value = true;
  close();
  try {
    const url = await openPortal();
    window.open(url, '_blank', 'noopener');
  } catch (e) {
    error.value = e?.message || t('account.portalFailed');
  } finally {
    busy.value = false;
  }
}

async function onSignOut() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await signOut();
    close();
  } catch (e) {
    error.value = e?.message || String(e);
  } finally {
    busy.value = false;
  }
}

function toggle() {
  open.value = !open.value;
}

function close() {
  open.value = false;
}

// 点击外部 / Esc 关闭。用 document 级监听而不是 CSS :focus-within ——
// 下拉里有真实按钮和链接，:focus-within 会在点击菜单项后因焦点移出而抖动。
function onDocClick(e) {
  if (!open.value) return;
  if (root.value && !root.value.contains(e.target)) close();
}

function onKey(e) {
  if (e.key === 'Escape') close();
}

onMounted(() => {
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div ref="root" class="acct">
    <!-- 未登录：文字按钮，登录入口不该跟主CTA 抢视觉权重 -->
    <button v-if="!signedIn" class="acct-signin" type="button" @click="showLogin = true">
      {{ t('account.signIn') }}
    </button>

    <!-- 已登录：邮箱 + 档位，点开面板 -->
    <template v-else>
      <button
        class="acct-trigger"
        type="button"
        :aria-expanded="open"
        aria-haspopup="menu"
        @click.stop="toggle"
      >
        <span class="acct-mail">{{ account.user.email }}</span>
        <span class="acct-plan">{{ t(planKey) }}</span>
        <svg class="acct-caret" width="12" height="12" viewBox="0 0 24 24" fill="none">
          <path
            d="M6 9l6 6 6-6"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>

      <div v-if="open" class="acct-menu" role="menu">
        <div class="acct-head">
          <p class="acct-email">{{ account.user.email }}</p>
          <p class="acct-tier" :class="{ 'acct-tier-err': account.error }">
            {{ account.error ? t('account.planUnknown') : t(planKey) }}
          </p>
          <p v-if="account.error" class="acct-err">{{ t('account.statusFailed') }}</p>
          <p
            v-else-if="hasActiveSub && account.subscription?.current_period_end"
            class="acct-renew"
          >
            {{
              t('account.renewsOn', {
                date: new Date(account.subscription.current_period_end).toLocaleDateString(),
              })
            }}
          </p>
        </div>

        <button
          v-if="hasActiveSub"
          class="acct-item"
          type="button"
          role="menuitem"
          :disabled="busy"
          @click="onManage"
        >
          {{ t('account.manageSub') }}
        </button>
        <LocalizedLink v-else to="/pricing" class="acct-item" role="menuitem" @click="close">
          {{ t('account.seePlans') }}
        </LocalizedLink>

        <div class="acct-sep" />

        <button
          class="acct-item acct-danger"
          type="button"
          role="menuitem"
          :disabled="busy"
          @click="onSignOut"
        >
          {{ t('account.signOut') }}
        </button>
      </div>
    </template>

    <AccountDialog v-if="showLogin" @close="showLogin = false" />
  </div>
</template>

<style scoped>
.acct {
  position: relative;
}

/* 未登录：纯文字，和「免费下载」主 CTA 拉开层级 */
.acct-signin {
  padding: 0.5rem 0.25rem;
  font-size: var(--text-sm);
  color: var(--color-text-soft);
  transition: color var(--transition);
}

.acct-signin:hover {
  color: var(--color-text);
}

.acct-trigger {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  max-width: 15rem;
  padding: 0.375rem 0.625rem;
  font-size: var(--text-sm);
  color: var(--color-text);
  background: var(--color-bg-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition: border-color var(--transition);
}

.acct-trigger:hover {
  border-color: var(--color-border-strong);
}

.acct-mail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acct-plan {
  flex-shrink: 0;
  padding: 0.0625rem 0.375rem;
  font-size: var(--text-xs);
  color: var(--color-accent);
  background: var(--color-accent-soft);
  border-radius: var(--radius-full);
}

.acct-caret {
  flex-shrink: 0;
  color: var(--color-text-muted);
}

.acct-menu {
  position: absolute;
  top: calc(100% + 0.5rem);
  right: 0;
  z-index: 60;
  min-width: 16rem;
  padding: 0.375rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}

.acct-head {
  padding: 0.625rem 0.75rem 0.75rem;
  border-bottom: 1px solid var(--color-border);
}

.acct-email {
  font-size: var(--text-sm);
  color: var(--color-text);
  overflow-wrap: anywhere;
}

.acct-tier {
  margin-top: 0.25rem;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

/* plan 未知（拉取失败）走警示色，且不能被误读成「免费」 */
.acct-tier-err {
  color: #dc2626;
}

.acct-renew {
  margin-top: 0.375rem;
  font-size: var(--text-xs);
  color: var(--color-text-tertiary);
}

.acct-err {
  margin-top: 0.25rem;
  font-size: var(--text-xs);
  color: var(--color-text-tertiary);
}

.acct-item {
  display: block;
  width: 100%;
  padding: 0.5rem 0.75rem;
  font-size: var(--text-sm);
  text-align: left;
  color: var(--color-text);
  border-radius: var(--radius-md);
  transition: background var(--transition);
}

.acct-item:hover:not(:disabled) {
  background: var(--color-bg-muted);
}

.acct-item:disabled {
  opacity: 0.6;
}

.acct-danger {
  color: #dc2626;
}

.acct-sep {
  height: 1px;
  margin: 0.25rem 0;
  background: var(--color-border);
}

/* 窄屏：邮箱太长会把 header 撑破，只留档位 */
@media (max-width: 768px) {
  .acct-mail {
    display: none;
  }

  .acct-trigger {
    max-width: none;
  }
}
</style>
