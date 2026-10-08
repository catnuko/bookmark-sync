<script setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { account, startCheckout, openPortal, hasActiveSubscription } from '../lib/account.js';
import AccountDialog from './AccountDialog.vue';
import LocalizedLink from './LocalizedLink.vue';

const props = defineProps({
  plan: { type: String, required: true }, // free / plus / pro
  highlighted: { type: Boolean, default: false },
});

const { t, tm, rt } = useI18n();

// 动态取该档位的特性列表，全部渲染（不再截断）
const features = computed(() => {
  const arr = tm(`pricing.plans.${props.plan}.features`);
  return Array.isArray(arr) ? arr.map((f) => rt(f)) : [];
});

// 付费档 CTA：
//   未登录 => 弹登录；当前档位订阅有效 => 打开 Creem 门户管理/取消；否则发起订阅。
const busy = ref(false);
const showLogin = ref(false);
const error = ref('');

const isPaid = computed(() => props.plan !== 'free');
const isCurrentPlan = computed(
  () => hasActiveSubscription() && account.subscription?.plan === props.plan,
);

// 账户状态拉取失败（RLS/网络）时 account.plan 是 null 而非 'free'。
// 此时**不能**显示「订阅 Pro」——付费用户会以为没买过、再付一次钱。
// 改成禁用 + 提示，让用户刷新重试。
const statusUnknown = computed(() => !!account.user && !!account.error);

async function onPaidCta() {
  if (busy.value || statusUnknown.value) return;
  error.value = '';
  if (!account.user) {
    showLogin.value = true;
    return;
  }
  if (isCurrentPlan.value) {
    busy.value = true;
    try {
      const url = await openPortal();
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      error.value = e?.message || t('account.portalFailed');
    } finally {
      busy.value = false;
    }
    return;
  }
  busy.value = true;
  try {
    const url = await startCheckout(props.plan);
    window.open(url, '_blank', 'noopener');
  } catch (e) {
    error.value = e?.message || t('account.checkoutFailed');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="plan-card" :class="{ 'plan-highlight': props.highlighted }">
    <div v-if="props.highlighted" class="plan-badge">{{ t('pricing.popular') }}</div>

    <div class="plan-head">
      <h3 class="plan-name">{{ t(`pricing.plans.${props.plan}.name`) }}</h3>
      <p class="plan-desc">{{ t(`pricing.plans.${props.plan}.desc`) }}</p>
    </div>

    <div class="plan-price-row">
      <span class="plan-price">{{ t(`pricing.plans.${props.plan}.price`) }}</span>
      <span class="plan-unit">{{ t(`pricing.plans.${props.plan}.unit`) }}</span>
    </div>

    <!-- 免费档：引导装扩展；付费档：登录后直接在官网订阅 / 管理订阅 -->
    <LocalizedLink v-if="!isPaid" to="/download" class="btn plan-cta btn-outline">
      {{ t(`pricing.plans.${props.plan}.cta`) }}
    </LocalizedLink>
    <template v-else>
      <button
        class="btn plan-cta"
        :class="props.highlighted ? 'btn-primary' : 'btn-outline'"
        :disabled="busy || statusUnknown"
        @click="onPaidCta"
      >
        <template v-if="busy">{{ t('account.processing') }}</template>
        <template v-else-if="statusUnknown">{{ t('account.statusUnknownShort') }}</template>
        <template v-else-if="isCurrentPlan">{{ t('account.manageSub') }}</template>
        <template v-else>{{ t(`pricing.plans.${props.plan}.cta`) }}</template>
      </button>
      <p v-if="statusUnknown" class="plan-cta-error">{{ t('account.statusFailed') }}</p>
      <p v-if="isCurrentPlan && account.subscription?.current_period_end" class="plan-sub-status">
        {{
          t('account.renewsOn', {
            date: new Date(account.subscription.current_period_end).toLocaleDateString(),
          })
        }}
      </p>
      <p v-if="error" class="plan-cta-error">{{ error }}</p>
    </template>

    <AccountDialog v-if="showLogin" @close="showLogin = false" />

    <ul class="plan-features">
      <li v-for="(feature, i) in features" :key="i" class="plan-feature">
        <svg class="check" width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 13l4 4L19 7"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span>{{ feature }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.plan-card {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: var(--space-8);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  transition: all var(--transition);
}

.plan-card:hover {
  border-color: var(--color-border-strong);
}

.plan-highlight {
  border-color: var(--color-text);
  box-shadow: var(--shadow-lg);
}

.plan-badge {
  position: absolute;
  top: -12px;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.25rem 0.875rem;
  background: var(--color-text);
  color: var(--color-bg);
  font-size: var(--text-xs);
  font-weight: 600;
  border-radius: var(--radius-full);
  white-space: nowrap;
}

.plan-head {
  margin-bottom: var(--space-4);
}

.plan-name {
  font-size: var(--text-xl);
  font-weight: 600;
  letter-spacing: -0.01em;
  margin-bottom: var(--space-1);
}

.plan-desc {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.plan-price-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin-bottom: var(--space-6);
}

.plan-price {
  font-size: var(--text-4xl);
  font-weight: 700;
  letter-spacing: -0.03em;
}

.plan-unit {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.plan-cta {
  width: 100%;
  margin-bottom: var(--space-6);
  padding: 0.75rem 1.25rem;
}

.plan-sub-status {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  margin: calc(-1 * var(--space-4)) 0 var(--space-4);
}

.plan-cta-error {
  font-size: var(--text-xs);
  color: #dc2626;
  margin: calc(-1 * var(--space-4)) 0 var(--space-4);
}

.plan-features {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-top: auto;
}

.plan-feature {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-soft);
  line-height: 1.5;
}

.check {
  color: var(--color-accent);
  flex-shrink: 0;
  margin-top: 2px;
}
</style>
