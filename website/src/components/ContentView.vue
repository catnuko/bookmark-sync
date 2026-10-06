<script setup>
// 内容文章页 —— 由 content/*.md 的解析结果驱动（blocks 是 AST，不是 HTML 字符串）。
//
// ★ 为什么不 v-html：AST 走 v-for 才能吃到 scoped 样式，且天然避免 XSS
//   （内容是我们自己写的，但仍不给 innerHTML 开口子）。上一个文件里
//   `<a href>` 是 LocalizedLink 渲染的，同样只走 AST。
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import LocalizedLink from './LocalizedLink.vue';
import ContentBody from './ContentBody.vue';

// 内容数据由 ssg.js 在渲染时注入（Vue 没有「给组件传服务端数据」的原生方式，
// 这里的做法是：ssg.js 直接把 article 挂在 app.provide 上）。
// ★ Article / FAQPage JSON-LD 由 vite-plugin 在构建时生成后塞进 head，
//   不走组件 —— JSON-LD 必须在 SSR 产物里就存在，等客户端再补会漏。
import { inject } from 'vue';
const article = inject('contentArticle');

if (!article) {
  // 客户端 CSR 直达（无 SSG 数据）→ 路由不该匹配到内容页，报错比渲染空白好排查
  throw new Error('[ContentView] 缺少 SSG 注入的 contentArticle');
}

const route = useRoute();
const cat = article.categoryMeta;
</script>

<template>
  <article class="content-page">
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
