<script setup>
// 内容文章页 —— 由 content/*.md 的解析结果驱动（blocks 是 AST，不是 HTML 字符串）。
//
// ★ 为什么不 v-html：AST 走 v-for 才能吃到 scoped 样式，且天然避免 XSS
//   （内容是我们自己写的，但仍不给 innerHTML 开口子）。上一个文件里
//   `<a href>` 是 LocalizedLink 渲染的，同样只走 AST。
import { computed, inject, ref } from 'vue';
import { useRoute } from 'vue-router';
import LocalizedLink from './LocalizedLink.vue';
import ContentBody from './ContentBody.vue';
// 内容数据两条来源：
//   1. SSG —— vite-plugin 渲染时 app.provide('contentArticle', article)
//   2. CSR —— dev server / 客户端路由跳转时没有注入，改从预渲染数据 JSON 取
// ★ 原先只有第 1 条且拿不到就抛错，于是 **dev server 一进内容页就白屏**
//   （线上因为每个文章 URL 都是独立 HTML，点进去是整页加载，掩盖了这个洞）。
import { loadArticleForCsr } from '../content/csr';

const route = useRoute();
const injected = inject('contentArticle', null);

const article = ref(injected);
if (!injected && route.meta.contentSlug) {
  loadArticleForCsr(route.meta.contentSlug, route.meta.contentLocale || 'zh').then((d) => {
    article.value = d;
  });
}

// article 为 null = 还在取（CSR）。取回后（成功或失败）都会变成对象或保持 null，
// 失败时下面的 v-else 会渲染出空壳 —— 但至少不再抛错白屏。
const loading = computed(() => !article.value);
const cat = computed(() => article.value?.categoryMeta || {});
</script>

<template>
  <!-- 取不到数据时的兜底。CSR 场景（dev server / 客户端跳转）先 fetch
       预渲染数据 JSON，这个窗口内 article 为 null。 -->
  <div v-if="loading" class="content-fallback container">
    <p class="fallback-text">正在加载…</p>
  </div>

  <article v-else class="content-page">
    <!-- 页首 -->
    <header class="content-hero">
      <div class="container container-narrow">
        <p class="section-eyebrow">{{ cat.label }}</p>
        <h1 class="content-title">{{ article.frontmatter.title }}</h1>
        <p class="content-lead">{{ article.lead }}</p>
      </div>
    </header>

    <!-- 正文 -->
    <div class="content-body">
      <div class="container container-narrow">
        <!-- 目录：内容页普遍 40+ 段落，没有目录很难定位。
            锚点由 parse.js 的 slugOfHeading 生成，与 ContentBody 的 h2 id 一致。 -->
        <nav v-if="article.toc && article.toc.length >= 3" class="content-toc" aria-label="目录">
          <p class="toc-title">{{ cat.tocLabel }}</p>
          <ul class="toc-list">
            <li v-for="t in article.toc" :key="t.anchor">
              <a :href="`#${t.anchor}`" class="toc-link">{{ t.text }}</a>
            </li>
          </ul>
        </nav>

        <ContentBody :blocks="article.blocks" />

        <!-- FAQ：与页面可见问答严格一致（FAQPage JSON-LD 由 ArticleMeta 输出同一份数据） -->
        <section v-if="article.faq.length" class="content-faq">
          <h2 class="content-h2">FAQ</h2>
          <details v-for="it in article.faq" :key="it.q" class="content-details">
            <summary class="content-q">{{ it.q }}</summary>
            <p class="content-a">{{ it.a }}</p>
          </details>
        </section>

        <!-- 相关阅读：同分类的其它文章，构成站内互链 -->
        <section v-if="article.related.length" class="content-related">
          <h2 class="content-h2">{{ cat.relatedLabel }}</h2>
          <ul class="related-list">
            <li v-for="r in article.related" :key="r.href">
              <LocalizedLink :to="r.href" class="related-link">{{ r.title }}</LocalizedLink>
            </li>
          </ul>
        </section>

        <!-- CTA：问题解决页的落点必须是一次转化，而不是又一篇阅读 -->
        <section class="content-cta">
          <p class="cta-text">{{ cat.cta }}</p>
          <div class="cta-actions">
            <LocalizedLink to="/download" class="btn btn-primary btn-lg">
              {{ cat.ctaLabel }}
            </LocalizedLink>
            <LocalizedLink to="/pricing" class="btn btn-outline btn-lg">
              {{ cat.ctaSecondary }}
            </LocalizedLink>
          </div>
        </section>
      </div>
    </div>
  </article>
</template>

<style scoped>
.content-page {
  display: flex;
  flex-direction: column;
}

.content-hero {
  padding: var(--space-20) 0 var(--space-10);
  border-bottom: 1px solid var(--color-border);
}

.content-title {
  font-size: var(--text-3xl);
  font-weight: 680;
  line-height: 1.22;
  letter-spacing: -0.025em;
  max-width: 22em;
}

.content-lead {
  margin-top: var(--space-5);
  font-size: var(--text-lg);
  line-height: 1.65;
  color: var(--color-text-muted);
  max-width: 38em;
}

.content-body {
  padding: var(--space-12) 0 var(--space-16);
}

.content-toc {
  margin-bottom: var(--space-10);
  padding: var(--space-5) var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-soft);
}

.toc-title {
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin-bottom: var(--space-3);
}

.toc-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.toc-link {
  font-size: var(--text-sm);
  color: var(--color-text-soft);
}

.toc-link:hover {
  color: var(--color-text);
}

.content-faq {
  margin-top: var(--space-14);
  padding-top: var(--space-10);
  border-top: 1px solid var(--color-border);
}

.content-details {
  padding: var(--space-5) 0;
  border-bottom: 1px solid var(--color-border);
}

.content-q {
  font-weight: 600;
  cursor: pointer;
  list-style: none;
  padding-right: var(--space-8);
  position: relative;
}

.content-q::after {
  content: '+';
  position: absolute;
  right: 0;
  top: 0;
  color: var(--color-text-muted);
  font-weight: 400;
}

.content-details[open] .content-q::after {
  content: '−';
}

.content-a {
  margin-top: var(--space-3);
  color: var(--color-text-muted);
  line-height: 1.72;
}

.content-related {
  margin-top: var(--space-14);
  padding-top: var(--space-10);
  border-top: 1px solid var(--color-border);
}

.related-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.related-link {
  color: var(--color-text-soft);
  font-size: var(--text-sm);
}

.related-link:hover {
  color: var(--color-text);
}

.content-cta {
  margin-top: var(--space-14);
  padding: var(--space-10);
  border-radius: var(--radius-lg);
  background: var(--color-bg-soft);
  border: 1px solid var(--color-border);
  text-align: center;
}

.cta-text {
  font-size: var(--text-lg);
  font-weight: 600;
  margin-bottom: var(--space-6);
}

.cta-actions {
  display: flex;
  gap: var(--space-4);
  justify-content: center;
  flex-wrap: wrap;
}

@media (max-width: 640px) {
  .content-title {
    font-size: var(--text-2xl);
  }
}
</style>
