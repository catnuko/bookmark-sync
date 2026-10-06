<script setup>
import { useI18n } from 'vue-i18n';
import LocalizedLink from '../LocalizedLink.vue';

const { t } = useI18n();
</script>

<template>
  <section class="section cta-section">
    <div class="container">
      <div class="cta-card">
        <div class="cta-grid-bg" aria-hidden="true"></div>
        <h2 class="cta-title">{{ t('hero.title') }}</h2>
        <p class="cta-subtitle">{{ t('hero.subtitle') }}</p>
        <div class="cta-actions">
          <LocalizedLink to="/download" class="btn btn-primary btn-lg">
            {{ t('hero.ctaPrimary') }}
          </LocalizedLink>
          <LocalizedLink to="/pricing" class="btn btn-outline btn-lg cta-outline">
            {{ t('hero.ctaSecondary') }}
          </LocalizedLink>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.cta-section {
  background: var(--color-bg);
}

.cta-card {
  position: relative;
  overflow: hidden;
  padding: var(--space-20) var(--space-12);
  background: var(--color-text);
  color: var(--color-bg);
  border-radius: var(--radius-lg);
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
}

.cta-grid-bg {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.08) 1px, transparent 1px);
  background-size: 40px 40px;
  mask-image: radial-gradient(ellipse 60% 70% at 50% 50%, #000 30%, transparent 70%);
  -webkit-mask-image: radial-gradient(ellipse 60% 70% at 50% 50%, #000 30%, transparent 70%);
  pointer-events: none;
}

.cta-title {
  position: relative;
  font-size: var(--text-4xl);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.1;
  max-width: 600px;
  margin: 0 auto;
}

.cta-subtitle {
  position: relative;
  font-size: var(--text-lg);
  color: rgba(255, 255, 255, 0.7);
  max-width: 540px;
  margin: 0 auto;
  line-height: 1.5;
}

.cta-actions {
  position: relative;
  display: flex;
  gap: var(--space-3);
  margin-top: var(--space-4);
  flex-wrap: wrap;
  justify-content: center;
}

.cta-section :deep(.btn-primary) {
  background: white;
  color: #000;
}

.cta-section :deep(.btn-primary:hover) {
  background: rgba(255, 255, 255, 0.9);
}

.cta-outline {
  background: transparent;
  border-color: rgba(255, 255, 255, 0.3);
  color: white;
}

.cta-outline:hover {
  border-color: white;
  background: rgba(255, 255, 255, 0.08);
}

@media (max-width: 768px) {
  .cta-card {
    padding: var(--space-12) var(--space-6);
  }
  .cta-title {
    font-size: var(--text-3xl);
  }
}
</style>
