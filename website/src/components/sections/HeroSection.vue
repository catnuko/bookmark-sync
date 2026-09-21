<script setup>
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
  <section class="hero">
    <!-- 背景装饰：细网格 + 渐变光晕 -->
    <div class="hero-bg" aria-hidden="true">
      <div class="hero-grid"></div>
      <div class="hero-glow"></div>
    </div>

    <div class="container hero-inner">
      <span class="badge badge-accent hero-badge">
        <span class="badge-dot"></span>
        {{ t('hero.badge') }}
      </span>

      <h1 class="hero-title">{{ t('hero.title') }}</h1>

      <p class="hero-subtitle">{{ t('hero.subtitle') }}</p>

      <div class="hero-cta">
        <RouterLink to="/download" class="btn btn-primary btn-lg">
          {{ t('hero.ctaPrimary') }}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 12h14M13 6l6 6-6 6"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </RouterLink>
        <RouterLink to="/pricing" class="btn btn-outline btn-lg">
          {{ t('hero.ctaSecondary') }}
        </RouterLink>
      </div>

      <p class="hero-trust">{{ t('hero.trustBadge') }}</p>

      <!-- 产品预览：模拟浏览器书签面板 -->
      <div class="hero-preview">
        <div class="preview-frame">
          <div class="preview-bar">
            <span class="dot dot-red"></span>
            <span class="dot dot-yellow"></span>
            <span class="dot dot-green"></span>
            <div class="preview-addr">bookmarks</div>
          </div>
          <div class="preview-body">
            <div class="preview-folder">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
                  stroke="currentColor"
                  stroke-width="1.6"
                />
              </svg>
              <span>{{ t('hero.previewFolder1') }}</span>
              <svg class="sync-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 4v6h6M20 20v-6h-6"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M20 10a8 8 0 00-15-2M4 14a8 8 0 0015 2"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                />
              </svg>
            </div>
            <div class="preview-bookmark">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 4v16l7-5 7 5V4z"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linejoin="round"
                />
              </svg>
              <span>GitHub · github.com</span>
            </div>
            <div class="preview-bookmark">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 4v16l7-5 7 5V4z"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linejoin="round"
                />
              </svg>
              <span>MDN Web Docs</span>
            </div>
            <div class="preview-folder">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
                  stroke="currentColor"
                  stroke-width="1.6"
                />
              </svg>
              <span>{{ t('hero.previewFolder2') }}</span>
            </div>
            <div class="preview-bookmark">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 4v16l7-5 7 5V4z"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linejoin="round"
                />
              </svg>
              <span>Figma · figma.com</span>
            </div>
            <div class="preview-bookmark preview-deleted">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 4v16l7-5 7 5V4z"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linejoin="round"
                />
              </svg>
              <span>{{ t('hero.previewDeleted') }}</span>
              <svg class="restore-icon" width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 13l4 4L19 7"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.hero {
  position: relative;
  overflow: hidden;
  padding: var(--space-24) 0 var(--space-20);
}

.hero-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.hero-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(to right, var(--color-border) 1px, transparent 1px),
    linear-gradient(to bottom, var(--color-border) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(ellipse 80% 50% at 50% 0%, #000 30%, transparent 70%);
  -webkit-mask-image: radial-gradient(ellipse 80% 50% at 50% 0%, #000 30%, transparent 70%);
  opacity: 0.5;
}

.hero-glow {
  position: absolute;
  top: -10%;
  left: 50%;
  transform: translateX(-50%);
  width: 800px;
  height: 600px;
  background: radial-gradient(ellipse at center, rgba(0, 102, 255, 0.12), transparent 60%);
  filter: blur(40px);
}

.hero-inner {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--space-5);
  max-width: 880px;
}

.hero-badge {
  margin-bottom: var(--space-2);
}

.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-accent);
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.hero-title {
  font-size: var(--text-5xl);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.05;
  margin: 0;
  background: linear-gradient(180deg, var(--color-text) 0%, var(--color-text-soft) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.hero-subtitle {
  font-size: var(--text-lg);
  color: var(--color-text-muted);
  line-height: 1.6;
  max-width: 620px;
  margin: 0;
}

.hero-cta {
  display: flex;
  gap: var(--space-3);
  margin-top: var(--space-4);
  flex-wrap: wrap;
  justify-content: center;
}

.hero-trust {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  margin-top: var(--space-2);
}

/* 产品预览 */
.hero-preview {
  margin-top: var(--space-16);
  width: 100%;
  max-width: 720px;
  perspective: 1200px;
}

.preview-frame {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  transform: rotateX(8deg);
  transform-origin: center top;
  transition: transform 600ms var(--ease-out);
}

.preview-frame:hover {
  transform: rotateX(0deg);
}

.preview-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: var(--color-bg-soft);
  border-bottom: 1px solid var(--color-border);
}

.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.dot-red {
  background: #ff5f57;
}
.dot-yellow {
  background: #febc2e;
}
.dot-green {
  background: #28c840;
}

.preview-addr {
  flex: 1;
  margin-left: 0.5rem;
  padding: 0.25rem 0.75rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  font-family: var(--font-mono);
}

.preview-body {
  padding: var(--space-3) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.preview-folder,
.preview-bookmark {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0.5rem 0.5rem;
  font-size: var(--text-sm);
  color: var(--color-text-soft);
  border-radius: var(--radius-sm);
}

.preview-folder {
  font-weight: 500;
  color: var(--color-text);
  margin-top: 0.25rem;
}

.sync-spin {
  margin-left: auto;
  color: var(--color-accent);
  animation: spin 3s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.preview-bookmark {
  padding-left: var(--space-8);
  color: var(--color-text-muted);
}

.preview-deleted {
  color: var(--color-text-faint);
  text-decoration: line-through;
  background: var(--color-bg-muted);
}

.restore-icon {
  margin-left: auto;
  color: var(--color-accent);
  cursor: pointer;
}

@media (max-width: 768px) {
  .hero {
    padding: var(--space-16) 0 var(--space-12);
  }
  .hero-title {
    font-size: var(--text-4xl);
  }
  .hero-subtitle {
    font-size: var(--text-base);
  }
  .hero-preview {
    margin-top: var(--space-12);
  }
  .preview-frame {
    transform: rotateX(0deg);
  }
}
</style>
