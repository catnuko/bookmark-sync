<script setup>
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { supabase } from '../lib/supabase.js';

const { t, tm } = useI18n();

// 商店审核中：卡片仅展示「即将推出」，不可点击；真实安装包走下方手动安装区。
// 商店详情页上线后，把卡片恢复为 <a> 并指向商店详情页。
//
// 安装包托管在 Supabase Storage public bucket `downloads`（release.yml 发版时
// 上传 + 写 latest.json），这里运行时读取最新版本号生成下载链接——发新版官网
// 无需重新部署。latest.json 拉取失败时回落到 FALLBACK_VERSION。
const FALLBACK_VERSION = '2.2.0';
const STORAGE_BASE = 'https://cwtqnsbpcetvqopdkcou.supabase.co/storage/v1/object/public/downloads';

const version = ref(FALLBACK_VERSION);
const chromiumZip = computed(() => `${STORAGE_BASE}/bookmark-sync-chromium-${version.value}.zip`);
const firefoxZip = computed(() => `${STORAGE_BASE}/bookmark-sync-firefox-${version.value}.zip`);

onMounted(async () => {
  try {
    const r = await fetch(`${STORAGE_BASE}/latest.json`, { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    if (typeof j?.version === 'string' && /^\d+(\.\d+)*$/.test(j.version)) {
      version.value = j.version;
    }
  } catch {
    /* 网络异常时用内置版本号 */
  }
});

const browsers = [
  { key: 'chrome', color: '#4285F4' },
  { key: 'edge', color: '#0078D7' },
  { key: 'firefox', color: '#FF7139' },
];

const iconPaths = {
  chrome: 'M12 2a10 10 0 11-5 18.66L9 13l3-1V2z',
  edge: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  firefox: 'M12 2C8 2 5 5 5 9c0 4 3 7 7 7s7-3 7-7',
};

const email = ref('');
const submitted = ref(false);
const busy = ref(false);
const error = ref('');

// 订阅上架通知：写入 Supabase bsync_waitlist（需先在远端执行 0025_waitlist.sql 迁移）
async function subscribe() {
  if (busy.value) return;
  if (!email.value || !email.value.includes('@')) return;
  error.value = '';
  busy.value = true;
  try {
    const { error: err } = await supabase
      .from('bsync_waitlist')
      .insert({ email: email.value, source: 'download' });
    if (err) throw err;
    submitted.value = true;
    email.value = '';
  } catch (e) {
    error.value = t('download.subscribe.error');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="download-page">
    <section class="section download-hero">
      <div class="container">
        <div class="section-header">
          <p class="section-eyebrow">{{ t('download.eyebrow') }}</p>
          <h1 class="section-title">{{ t('download.title') }}</h1>
          <p class="section-subtitle">{{ t('download.subtitle') }}</p>
          <p class="download-note">{{ t('download.storePendingNote') }}</p>
        </div>

        <div class="browser-grid">
          <div v-for="b in browsers" :key="b.key" class="browser-card browser-card-soon">
            <div class="browser-icon" :style="{ background: b.color }">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path :d="iconPaths[b.key]" />
              </svg>
            </div>
            <div class="browser-info">
              <h3 class="browser-name">{{ t(`browsers.${b.key}.name`) }}</h3>
              <p class="browser-store">{{ t(`browsers.${b.key}.desc`) }}</p>
            </div>
            <span class="browser-soon">{{ t('common.comingSoon') }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 手动安装——安装包直发在官网，商店上架前是唯一安装路径 -->
    <section id="manual" class="section manual-section">
      <div class="container container-narrow">
        <div class="manual-card">
          <h2 class="manual-title">{{ t('download.manual.title', { version }) }}</h2>
          <p class="manual-sub">{{ t('download.manual.subtitle') }}</p>

          <div class="manual-ctas">
            <a :href="chromiumZip" download class="btn btn-primary btn-lg manual-cta">
              {{ t('download.manual.chromiumCta') }}
            </a>
            <a :href="firefoxZip" download class="btn btn-outline btn-lg manual-cta">
              {{ t('download.manual.firefoxCta') }}
            </a>
          </div>

          <ol class="manual-steps">
            <li v-for="(step, i) in tm('download.manual.steps')" :key="i">{{ step }}</li>
          </ol>
        </div>
      </div>
    </section>

    <!-- 邮箱订阅：商店上架后第一时间通知 -->
    <section id="subscribe" class="section subscribe-section">
      <div class="container">
        <div class="subscribe-card">
          <div class="subscribe-header">
            <h2 class="subscribe-title">{{ t('download.subscribe.title') }}</h2>
            <p class="subscribe-subtitle">{{ t('download.subscribe.subtitle') }}</p>
          </div>

          <form v-if="!submitted" class="subscribe-form" @submit.prevent="subscribe">
            <input
              v-model="email"
              type="email"
              class="subscribe-input"
              :placeholder="t('common.subscribePlaceholder')"
              required
            />
            <button type="submit" class="btn btn-primary btn-lg" :disabled="busy">
              {{ busy ? t('download.subscribe.submitting') : t('download.subscribe.submit') }}
            </button>
          </form>

          <p v-else class="subscribe-success">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 13l4 4L19 7"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            {{ t('download.subscribe.success') }}
          </p>

          <p v-if="error" class="subscribe-error">{{ error }}</p>
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

.download-note {
  margin-top: var(--space-4);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
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

.browser-card:hover {
  border-color: var(--color-text);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
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

.browser-card-soon {
  cursor: default;
}

.browser-card-soon:hover {
  border-color: var(--color-border);
  box-shadow: none;
  transform: none;
}

.browser-soon {
  flex-shrink: 0;
  padding: 0.5rem 0.875rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-soft);
  color: var(--color-text-faint);
  font-size: var(--text-sm);
  font-weight: 500;
}

.manual-section {
  background: var(--color-bg-soft);
  border-top: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
}

.container-narrow {
  max-width: 720px;
}

.manual-card {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-10) var(--space-8);
  text-align: center;
}

.manual-title {
  font-size: var(--text-2xl);
  font-weight: 600;
  letter-spacing: -0.02em;
  margin-bottom: var(--space-2);
}

.manual-sub {
  font-size: var(--text-base);
  color: var(--color-text-muted);
  margin-bottom: var(--space-6);
  line-height: 1.6;
}

.manual-ctas {
  display: flex;
  justify-content: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-bottom: var(--space-6);
}

.manual-cta {
  margin-bottom: 0;
}

.manual-steps {
  max-width: 560px;
  margin: 0 auto;
  text-align: left;
  font-size: var(--text-sm);
  color: var(--color-text-soft);
  line-height: 1.75;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.manual-steps li::marker {
  color: var(--color-accent);
  font-weight: 600;
}

.subscribe-section {
  background: var(--color-bg);
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

.subscribe-error {
  margin-top: var(--space-3);
  font-size: var(--text-xs);
  color: #dc2626;
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
