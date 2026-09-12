<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";

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
</script>

<template>
  <div class="plan-card" :class="{ 'plan-highlight': props.highlighted }">
    <div v-if="props.highlighted" class="plan-badge">{{ t("pricing.popular") }}</div>

    <div class="plan-head">
      <h3 class="plan-name">{{ t(`pricing.plans.${props.plan}.name`) }}</h3>
      <p class="plan-desc">{{ t(`pricing.plans.${props.plan}.desc`) }}</p>
    </div>

    <div class="plan-price-row">
      <span class="plan-price">{{ t(`pricing.plans.${props.plan}.price`) }}</span>
      <span class="plan-unit">{{ t(`pricing.plans.${props.plan}.unit`) }}</span>
    </div>

    <!-- 付费档：订阅在扩展内完成（登录后创建 Creem 收银台会话），官网引导先装扩展 -->
    <RouterLink to="/download" class="btn plan-cta" :class="props.highlighted ? 'btn-primary' : 'btn-outline'">
      {{ t(`pricing.plans.${props.plan}.cta`) }}
    </RouterLink>

    <ul class="plan-features">
      <li v-for="(feature, i) in features" :key="i" class="plan-feature">
        <svg class="check" width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
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
