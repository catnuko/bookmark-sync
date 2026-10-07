<script setup>
/**
 * 文章列表 —— 按分类分组展示全部内容文章。
 *
 * ★ 为什么放文档页而不是页脚：
 *   - 页脚是全局导航，塞 10 篇文章标题会把页脚撑成 5 列、长标题折三行，
 *     在移动端尤其难看（用户实测后要求移除）。
 *   - 文章列表是**内容**，属于文档/指南的职责，混进页脚属于放错位置。
 *   - 数据来自 manifest.js（构建期从 markdown 生成），所以列表永远与内容同步，
 *     不需要手动维护文章清单。
 *
 * 分类顺序按 CONTENT_CATEGORIES 的声明顺序（fix → migrate → explain），
 * 组内按 order 升序 —— 与 manifest 生成时的排序一致，避免两处排序打架。
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import LocalizedLink from './LocalizedLink.vue';
import { CONTENT_ROUTES, CONTENT_CATEGORIES } from '../content/manifest';

const { locale, t } = useI18n();

const groups = computed(() => {
  const cur = locale.value === 'en' ? 'en' : 'zh';
  return (
    Object.entries(CONTENT_CATEGORIES)
      .map(([key, cat]) => ({
        key,
        label: cat.label[cur],
        description: cat.description[cur],
        items: CONTENT_ROUTES.filter((r) => r.category === key && r.locale === cur)
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((r) => ({
            href: `/${r.prefix}/${r.slug}`,
            title: r.title,
            description: r.description,
          })),
      }))
      // 内容为空时不渲染整组（否则会留一个只有标题的空分组）
      .filter((g) => g.items.length > 0)
  );
});

const total = computed(() => groups.value.reduce((n, g) => n + g.items.length, 0));

/**
 * 渐进披露：跨分类取前 3 篇作为「featured」，其余按分类收进下方列表。
 *
 * ★ 为什么不全平铺：11 段长度相近的列表没有视觉重心，用户扫一眼
 *   不知道从哪篇开始。参考项目（catnuko.github.io）的 Posts 组件用
 *   range/columns 做同样的事：首页 1 篇大图 + 2 篇并排 + 其余列表。
 *
 * 取法：按「分类声明顺序 × 组内 order」串起来取前 3 —— 保证
 * 「问题解决」类（转化意图最强）永远排在前面，不受分类顺序变动影响。
 */
const FEATURED = 3;
const flat = computed(() => groups.value.flatMap((g) => g.items));
const featured = computed(() => flat.value.slice(0, FEATURED));
const featuredKeys = computed(() => new Set(featured.value.map((i) => i.href)));
// 每组里去掉已进入 featured 的，剩下的才进下方列表
const restGroups = computed(() =>
  groups.value
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !featuredKeys.value.has(i.href)),
    }))
    .filter((g) => g.items.length > 0),
);
</script>

<template>
  <section v-if="groups.length" class="section content-index">
    <div class="container container-narrow">
      <header class="content-index-head">
        <h2 class="docs-h2">{{ t('contentIndex.title') }}</h2>
        <p class="docs-intro">{{ t('contentIndex.subtitle', { count: total }) }}</p>
      </header>

      <!-- 精选 3 篇：大卡片，无缩略图但标题更大、摘要完整 -->
      <ul class="featured-list">
        <li v-for="item in featured" :key="item.href" class="featured-item">
          <LocalizedLink :to="item.href" class="featured-link">{{ item.title }}</LocalizedLink>
          <p class="featured-desc">{{ item.description }}</p>
        </li>
      </ul>

      <!-- 其余按分类列出 -->
      <div v-for="g in restGroups" :key="g.key" class="content-group">
        <h3 class="content-group-title">{{ g.label }}</h3>
        <p class="content-group-desc">{{ g.description }}</p>
        <ul class="content-list">
          <li v-for="item in g.items" :key="item.href" class="content-list-item">
            <LocalizedLink :to="item.href" class="content-link">{{ item.title }}</LocalizedLink>
            <p class="content-item-desc">{{ item.description }}</p>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.content-index {
  padding-top: var(--space-10);
}

.content-index-head {
  margin-bottom: var(--space-10);
  padding-bottom: var(--space-6);
  border-bottom: 1px solid var(--color-border);
}

/* 精选卡：比下方列表更大、摘要完整，给页面一个视觉起点 */
.featured-list {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--space-4);
  margin-bottom: var(--space-12);
}

.featured-item {
  padding: var(--space-5) var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-bg-soft);
}

.featured-link {
  font-size: var(--text-lg);
  font-weight: 640;
  line-height: 1.4;
  color: var(--color-text);
}

.featured-link:hover {
  color: var(--color-accent);
}

.featured-desc {
  margin-top: var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  line-height: 1.7;
}

/* 精选卡：比下方列表更大、摘要完整，给页面一个视觉起点 */
.featured-list {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--space-4);
  margin-bottom: var(--space-12);
}

.featured-item {
  padding: var(--space-5) var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-bg-soft);
}

.featured-link {
  font-size: var(--text-lg);
  font-weight: 640;
  line-height: 1.4;
  color: var(--color-text);
}

.featured-link:hover {
  color: var(--color-accent);
}

.featured-desc {
  margin-top: var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  line-height: 1.7;
}

.content-group {
  margin-bottom: var(--space-10);
}

.content-group:last-child {
  margin-bottom: 0;
}

.content-group-title {
  font-size: var(--text-lg);
  font-weight: 640;
  color: var(--color-text);
  margin-bottom: var(--space-2);
}

.content-group-desc {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  line-height: 1.7;
  margin-bottom: var(--space-5);
  max-width: 46em;
}

.content-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.content-list-item {
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-soft);
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.content-list-item:hover {
  border-color: var(--color-border-strong);
  background: var(--color-bg-muted);
}

.content-link {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--color-text);
}

.content-link:hover {
  color: var(--color-accent);
}

.content-item-desc {
  margin-top: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  line-height: 1.65;
}
</style>
