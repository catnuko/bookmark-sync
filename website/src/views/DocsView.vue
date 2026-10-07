<script setup>
import { useI18n } from 'vue-i18n';
import ContentIndex from '../components/ContentIndex.vue';

const { t, tm } = useI18n();

const sections = ['quickstart', 'features', 'faq', 'troubleshoot'];

/**
 * FAQ / 排障问答列表 —— 按键名过滤掉属于别页的内容。
 *
 * ★「配额按条数还是按字节计算？」只在 /pricing 出现：用户问它是在决策
 *   「免费档够不够用」，属于价格/额度语境；本页讲的是操作与机制，
 *   重复列出只是同义内容互相稀释。判据：**一条 FAQ 只在最能回答它的那一页。**
 */
const FAQ_SKIP = new Set([4]); // docs.sections.faq.items 里"配额"那条的下标

function qaItems(sec) {
  const items = tm(`docs.sections.${sec}.items`) || [];
  return sec === 'faq' ? items.filter((_, i) => !FAQ_SKIP.has(i)) : items;
}
</script>

<template>
  <div class="docs-page">
    <section class="section docs-hero">
      <div class="container">
        <div class="section-header">
          <p class="section-eyebrow">{{ t('docs.eyebrow') }}</p>
          <h1 class="section-title">{{ t('docs.title') }}</h1>
          <p class="section-subtitle">{{ t('docs.subtitle') }}</p>
        </div>
      </div>
    </section>

    <section class="section docs-body">
      <div class="container container-narrow">
        <div v-for="sec in sections" :key="sec" class="docs-section">
          <h2 class="docs-h2">{{ t(`docs.sections.${sec}.title`) }}</h2>
          <p v-if="t(`docs.sections.${sec}.intro`)" class="docs-intro">
            {{ t(`docs.sections.${sec}.intro`) }}
          </p>

          <!-- 快速开始：步骤列表 -->
          <ol v-if="sec === 'quickstart'" class="docs-steps">
            <li v-for="(s, i) in tm('docs.sections.quickstart.steps')" :key="i" class="docs-step">
              <span class="docs-step-no">{{ i + 1 }}</span>
              <div>
                <b class="docs-step-t">{{ s.t }}</b>
                <p class="docs-step-d">{{ s.d }}</p>
              </div>
            </li>
          </ol>

          <!-- 功能详解：卡片列表 -->
          <div v-else-if="sec === 'features'" class="docs-items">
            <div v-for="(it, i) in tm('docs.sections.features.items')" :key="i" class="docs-item">
              <h3 class="docs-item-t">{{ it.t }}</h3>
              <p class="docs-item-d">{{ it.d }}</p>
            </div>
          </div>

          <!-- FAQ / 故障排查：折叠问答 -->
          <div v-else class="docs-qa">
            <details v-for="(qa, i) in qaItems(sec)" :key="i" class="docs-details">
              <summary class="docs-q">{{ qa.q }}</summary>
              <p class="docs-a">{{ qa.a }}</p>
            </details>
          </div>
        </div>
      </div>
    </section>

    <!-- 文章列表（markdown 驱动的长尾内容）。放文档页而不是页脚：
         页脚是全局导航，10 篇文章标题会撑成 5 列、长标题折三行。 -->
    <ContentIndex />
  </div>
</template>

<style scoped>
.docs-page {
  display: flex;
  flex-direction: column;
}

.docs-hero {
  background: var(--color-bg);
  padding-top: var(--space-20);
  padding-bottom: var(--space-12);
  border-bottom: 1px solid var(--color-border);
}

.section-header {
  text-align: center;
  margin-bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.docs-body {
  background: var(--color-bg);
  padding-top: var(--space-12);
}

.container-narrow {
  max-width: 760px;
}

.docs-section {
  margin-bottom: var(--space-14);
}

.docs-h2 {
  font-size: var(--text-2xl);
  font-weight: 600;
  letter-spacing: -0.02em;
  margin-bottom: var(--space-2);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--color-border);
}

.docs-intro {
  font-size: var(--text-base);
  color: var(--color-text-muted);
  line-height: 1.7;
  margin-bottom: var(--space-5);
}

/* 快速开始步骤 */
.docs-steps {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.docs-step {
  display: flex;
  gap: var(--space-4);
  align-items: flex-start;
}

.docs-step-no {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-full);
  background: var(--color-accent);
  color: #fff;
  font-size: var(--text-sm);
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.docs-step-t {
  font-size: var(--text-base);
  color: var(--color-text);
}

.docs-step-d {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  line-height: 1.7;
  margin-top: 2px;
}

/* 功能卡片 */
.docs-items {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-4);
}

.docs-item {
  background: var(--color-bg-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-5);
}

.docs-item-t {
  font-size: var(--text-base);
  font-weight: 600;
  margin-bottom: var(--space-2);
}

.docs-item-d {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  line-height: 1.65;
}

/* 折叠问答 */
.docs-qa {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.docs-details {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.docs-details[open] {
  border-color: var(--color-border-strong);
}

.docs-q {
  cursor: pointer;
  padding: var(--space-4) var(--space-5);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-text);
  list-style: none;
  position: relative;
}

.docs-q::-webkit-details-marker {
  display: none;
}

.docs-q::after {
  content: '+';
  position: absolute;
  right: var(--space-5);
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-muted);
  font-weight: 400;
}

.docs-details[open] .docs-q::after {
  content: '−';
}

.docs-a {
  padding: 0 var(--space-5) var(--space-4);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  line-height: 1.75;
  white-space: pre-line;
}

@media (max-width: 700px) {
  .docs-items {
    grid-template-columns: 1fr;
  }
}
</style>
