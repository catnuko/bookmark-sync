<script setup>
/**
 * 文章页（/docs）—— 只保留文章：一条按发布时间倒序的时间线。
 *
 * ★ 历史包袱已移除：这里原先是 i18n 硬编码的「快速开始 / 功能详解 / 常见问题 /
 *   故障排查」四段，与下方的文章列表叠在一起，信息形态杂、也没有时间线索。
 *   现在那四段内容全部改写成了 markdown 文章（guide 分类），本页只负责标题
 *   与列表 —— 内容一律走内容管线，改文章不用改组件。
 */
import { useI18n } from 'vue-i18n';
import ContentIndex from '../components/ContentIndex.vue';

const { t } = useI18n();
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
</style>
