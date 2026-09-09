<script setup>
import { ref } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const browsers = [
  { key: "chrome", color: "#4285F4", url: "https://chromewebstore.google.com", available: true },
  { key: "edge", color: "#0078D7", url: "https://microsoftedge.microsoft.com/addons", available: true },
  { key: "firefox", color: "#FF7139", url: "https://addons.mozilla.org", available: true },
  { key: "safari", color: "#1D1D1F", url: "https://apps.apple.com", available: true },
];

const iconPaths = {
  chrome: "M12 2a10 10 0 11-5 18.66L9 13l3-1V2z",
  edge: "M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  firefox: "M12 2C8 2 5 5 5 9c0 4 3 7 7 7s7-3 7-7",
  safari: "M12 2a10 10 0 100 20 10 10 0 000-20z",
};

const email = ref("");
const submitted = ref(false);

function subscribe() {
  if (!email.value || !email.value.includes("@")) return;
  // 占位：实际接入后改成 fetch 到后端 / ConvertKit / Brevo 等
  submitted.value = true;
  email.value = "";
}
</script>

<template>
  <div class="download-page">
    <section class="section download-hero">
      <div class="container">
        <div class="section-header">
          <p class="section-eyebrow">{{ t("download.eyebrow") }}</p>
          <h1 class="section-title">{{ t("download.title") }}</h1>
          <p class="section-subtitle">{{ t("download.subtitle") }}</p>
        </div>

        <div class="browser-grid">
          <a
            v-for="b in browsers"
            :key="b.key"
            :href="b.available ? b.url : '#subscribe'"
            class="browser-card"
            :class="{ disabled: !b.available }"
            :target="b.available ? '_blank' : '_self'"
            rel="noopener noreferrer"
            @click.prevent="!b.available"
          >
            <div class="browser-icon" :style="{ background: b.color }">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path :d="iconPaths[b.key]" />
              </svg>
            </div>
            <div class="browser-info">
              <h3 class="browser-name">{{ t(`browsers.${b.key}.name`) }}</h3>
              <p class="browser-store">{{ t(`browsers.${b.key}.desc`) }}</p>
            </div>
            <div class="browser-action">
              <span v-if="b.available">{{ t("download.cta") }}</span>
              <span v-else class="coming-badge">{{ t("common.comingSoon") }}</span>
              <svg v-if="b.available" width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M7 17L17 7M17 7H8M17 7v9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </div>
          </a>
        </div>
      </div>
    </section>

    <!-- 邮箱订阅占位 -->
    <section id="subscribe" class="section subscribe-section">
      <div class="container">
        <div class="subscribe-card">
          <div class="subscribe-header">
            <h2 class="subscribe-title">{{ t("download.subscribe.title") }}</h2>
            <p class="subscribe-subtitle">{{ t("download.subscribe.subtitle") }}</p>
          </div>

          <form v-if="!submitted" class="subscribe-form" @submit.prevent="subscribe">
            <input
              v-model="email"
              type="email"
              class="subscribe-input"
              :placeholder="t('common.subscribePlaceholder')"
              required
            />
            <button type="submit" class="btn btn-primary btn-lg">
              {{ t("download.subscribe.submit") }}
            </button>
          </form>

          <p v-else class="subscribe-success">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            {{ t("download.subscribe.success") }}
          </p>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.download-page {
  display: flex;
  flex-direction: column;
}

.download-hero {
  background: var(--color-bg);
  padding-top: var(--space-20);
}

.section-header {
  text-align: center;
  margin-bottom: var(--space-16);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.browser-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-4);
  max-width: 880px;
  margin: 0 auto;
}

.browser-card {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  padding: var(--space-6) var(--space-8);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  transition: all var(--transition);
}

.browser-card:hover:not(.disabled) {
  border-color: var(--color-text);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.browser-card.disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.browser-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 14px;
  flex-shrink: 0;
}

.browser-info {
  flex: 1;
  min-width: 0;
}

.browser-name {
  font-size: var(--text-lg);
  font-weight: 600;
  margin-bottom: 4px;
}

.browser-store {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.browser-action {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-text);
}

.coming-badge {
  padding: 0.25rem 0.625rem;
  background: var(--color-bg-muted);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.subscribe-section {
  background: var(--color-bg-soft);
  border-top: 1px solid var(--color-border);
}

.subscribe-card {
  max-width: 580px;
  margin: 0 auto;
  text-align: center;
  padding: var(--space-12);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.subscribe-title {
  font-size: var(--text-2xl);
  font-weight: 600;
  letter-spacing: -0.02em;
  margin-bottom: var(--space-2);
}

.subscribe-subtitle {
  font-size: var(--text-base);
  color: var(--color-text-muted);
  margin-bottom: var(--space-6);
  line-height: 1.5;
}

.subscribe-form {
  display: flex;
  gap: var(--space-2);
  width: 100%;
}

.subscribe-input {
  flex: 1;
  padding: 0.75rem 1rem;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  background: var(--color-bg);
  color: var(--color-text);
  font-family: inherit;
  transition: border-color var(--transition);
}

.subscribe-input:focus {
  outline: none;
  border-color: var(--color-text);
}

.subscribe-success {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: 0.875rem;
  background: var(--color-accent-soft);
  color: var(--color-accent);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: 500;
}

@media (max-width: 768px) {
  .browser-grid {
    grid-template-columns: 1fr;
  }
  .subscribe-form {
    flex-direction: column;
  }
}
</style>
