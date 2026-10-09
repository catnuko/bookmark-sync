<script setup>
/**
 * 文章时间线 —— 按发布日期倒序展示全部内容文章。
 *
 * ★ 为什么是「一条时间线」而不是分类分组：
 *   原先按 fix/migrate/explain 分组 + 顶部精选卡，用户反馈「堆在一起很难看」——
 *   多段长度相近的列表没有视觉重心，也没有时间线索。博客式的单一时间线
 *   （日期 + 分类标签 + 标题 + 摘要）更易扫读，新文章自然浮到最上面。
 *
 * ★ 顺序**直接沿用 manifest**：loader 已按 date 倒序生成 CONTENT_ROUTES，
 *   这里只按语言过滤，不再二次排序 —— 两处排序迟早会打架。
 *
 * 日期用 formatDate 纯函数渲染（见 lib/format-date.js），避免 SSR/CSR 不一致。
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import LocalizedLink from './LocalizedLink.vue';
import { CONTENT_ROUTES, CONTENT_CATEGORIES } from '../content/manifest';
import { formatDate } from '../lib/format-date.js';

const { locale, t } = useI18n();

const items = computed(() => {
  const cur = locale.value === 'en' ? 'en' : 'zh';
  return CONTENT_ROUTES.filter((r) => r.locale === cur).map((r) => ({
    href: `/${r.prefix}/${r.slug}`,
    title: r.title,
    description: r.description,
    date: r.date,
    dateText: formatDate(r.date, cur),
    category: CONTENT_CATEGORIES[r.category]?.label?.[cur] || '',
  }));
});
</script>

<template>
  <section class="section content-index">
    <div class="container container-narrow">
      <p class="timeline-count">{{ t('contentIndex.count', { count: items.length }) }}</p>
      <ol class="timeline">
        <li v-for="item in items" :key="item.href" class="timeline-item">
          <time class="timeline-date" :datetime="item.date">{{ item.dateText }}</time>
          <div class="timeline-main">
            <span v-if="item.category" class="timeline-tag">{{ item.category }}</span>
            <LocalizedLink :to="item.href" class="timeline-link">{{ item.title }}</LocalizedLink>
            <p class="timeline-desc">{{ item.description }}</p>
          </div>
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.content-index {
  padding-top: var(--space-10);
  padding-bottom: var(--space-16);
}

.timeline-count {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--color-border);
  margin-bottom: var(--space-2);
}

.timeline {
  list-style: none;
  padding: 0;
  margin: 0;
}

.timeline-item {
  display: grid;
  grid-template-columns: 8.5rem 1fr;
  gap: var(--space-6);
  padding: var(--space-6) 0;
  border-bottom: 1px solid var(--color-border);
}

.timeline-date {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  padding-top: 0.15rem;
}

.timeline-main {
  min-width: 0;
}

.timeline-tag {
  display: inline-block;
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--color-accent);
  background: var(--color-bg-muted);
  border-radius: var(--radius-full);
  padding: 0.1rem 0.6rem;
  margin-bottom: var(--space-2);
}

.timeline-link {
  display: block;
  font-size: var(--text-lg);
  font-weight: 640;
  line-height: 1.4;
  color: var(--color-text);
}

.timeline-link:hover {
  color: var(--color-accent);
}

.timeline-desc {
  margin-top: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  line-height: 1.7;
}

@media (max-width: 640px) {
  .timeline-item {
    grid-template-columns: 1fr;
    gap: var(--space-2);
  }
}
</style>
