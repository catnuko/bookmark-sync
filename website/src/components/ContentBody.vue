<script setup>
// AST → DOM。只渲染解析器会产出的类型，遇到未知类型显式报错（不静默忽略，
// 那会让「作者写了段新语法但没渲染出来」这类问题变成看不见的内容缺失）。
//
// ★ 行内 inline 数组是 [{type:'text'|'strong'|'code', value}]，用 template v-for 渲染，
//   不用 v-html —— 保持 scoped 样式生效，同时不给 innerHTML 开口子。
import { slugOfHeading as slugOf } from '../content/parse';

defineProps({
  blocks: { type: Array, required: true },
});
</script>

<template>
  <div class="cb">
    <template v-for="(b, i) in blocks" :key="i">
      <!-- h2 / h3 -->
      <h2 v-if="b.type === 'heading' && b.level === 2" :id="slugOf(b.text)" class="cb-h2">
        <a
          v-for="(n, j) in b.inline"
          :key="j"
          v-bind="n.type === 'text' ? {} : { class: 'cb-' + n.type }"
          >{{ n.value }}</a
        >
      </h2>
      <h3 v-else-if="b.type === 'heading' && b.level === 3" :id="slugOf(b.text)" class="cb-h3">
        <a
          v-for="(n, j) in b.inline"
          :key="j"
          v-bind="n.type === 'text' ? {} : { class: 'cb-' + n.type }"
          >{{ n.value }}</a
        >
      </h3>
      <h4 v-else-if="b.type === 'heading'" :id="slugOf(b.text)" class="cb-h4">
        <a
          v-for="(n, j) in b.inline"
          :key="j"
          v-bind="n.type === 'text' ? {} : { class: 'cb-' + n.type }"
          >{{ n.value }}</a
        >
      </h4>

      <!-- 段落 -->
      <p v-else-if="b.type === 'paragraph'" class="cb-p">
        <a
          v-for="(n, j) in b.inline"
          :key="j"
          v-bind="n.type === 'text' ? {} : { class: 'cb-' + n.type }"
          >{{ n.value }}</a
        >
      </p>

      <!-- 引用（用于「注意/警告」） -->
      <blockquote v-else-if="b.type === 'quote'" class="cb-quote">
        <a
          v-for="(n, j) in b.inline"
          :key="j"
          v-bind="n.type === 'text' ? {} : { class: 'cb-' + n.type }"
          >{{ n.value }}</a
        >
      </blockquote>

      <!-- 列表 -->
      <ul v-else-if="b.type === 'list' && !b.ordered" class="cb-ul">
        <li v-for="(it, k) in b.items" :key="k" class="cb-li">
          <a
            v-for="(n, j) in it.inline"
            :key="j"
            v-bind="n.type === 'text' ? {} : { class: 'cb-' + n.type }"
            >{{ n.value }}</a
          >
        </li>
      </ul>
      <ol v-else-if="b.type === 'list'" class="cb-ol">
        <li v-for="(it, k) in b.items" :key="k" class="cb-li">
          <a
            v-for="(n, j) in it.inline"
            :key="j"
            v-bind="n.type === 'text' ? {} : { class: 'cb-' + n.type }"
            >{{ n.value }}</a
          >
        </li>
      </ol>

      <!-- 代码块 -->
      <pre v-else-if="b.type === 'code'" class="cb-pre"><code>{{ b.value }}</code></pre>

      <!-- 图片（块级，站内绝对路径） -->
      <figure v-else-if="b.type === 'image'" class="cb-figure">
        <img class="cb-img" :src="b.src" :alt="b.alt" loading="lazy" decoding="async" />
        <figcaption v-if="b.alt" class="cb-figcap">{{ b.alt }}</figcaption>
      </figure>

      <!-- 表格：横向可滚动，避免窄屏把布局撑破 -->
      <div v-else-if="b.type === 'table'" class="cb-table-wrap">
        <table class="cb-table">
          <thead>
            <tr>
              <th v-for="(h, k) in b.header" :key="k">
                <a
                  v-for="(n, j) in h.inline"
                  :key="j"
                  v-bind="n.type === 'text' ? {} : { class: 'cb-' + n.type }"
                  >{{ n.value }}</a
                >
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, k) in b.rows" :key="k">
              <td v-for="(c, j) in row" :key="j">
                <a
                  v-for="(n, m) in c.inline"
                  :key="m"
                  v-bind="n.type === 'text' ? {} : { class: 'cb-' + n.type }"
                  >{{ n.value }}</a
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-else class="cb-unknown">[未支持的内容类型：{{ b.type }}]</p>
    </template>
  </div>
</template>

<style scoped>
.cb :deep(.cb-h2) {
  margin-top: var(--space-12);
  margin-bottom: var(--space-4);
  font-size: var(--text-2xl);
  font-weight: 650;
  line-height: 1.3;
  letter-spacing: -0.02em;
  scroll-margin-top: calc(var(--header-height) + 16px);
}

.cb :deep(.cb-h2:first-child) {
  margin-top: 0;
}

.cb :deep(.cb-h3) {
  margin-top: var(--space-9);
  margin-bottom: var(--space-3);
  font-size: var(--text-xl);
  font-weight: 620;
  scroll-margin-top: calc(var(--header-height) + 16px);
}

.cb :deep(.cb-h4) {
  margin-top: var(--space-7);
  margin-bottom: var(--space-3);
  font-size: var(--text-lg);
  font-weight: 620;
}

.cb :deep(.cb-p) {
  margin: var(--space-4) 0;
  line-height: 1.78;
  color: var(--color-text-soft);
}

.cb :deep(.cb-strong) {
  font-weight: 620;
  color: var(--color-text);
}

.cb :deep(.cb-code) {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 0.9em;
  padding: 0.15em 0.4em;
  border-radius: 4px;
  background: var(--color-bg-muted);
  color: var(--color-text);
}

.cb :deep(.cb-ul),
.cb :deep(.cb-ol) {
  margin: var(--space-4) 0;
  padding-left: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.cb :deep(.cb-li) {
  line-height: 1.75;
  color: var(--color-text-soft);
}

.cb :deep(.cb-quote) {
  margin: var(--space-6) 0;
  padding: var(--space-4) var(--space-5);
  border-left: 3px solid var(--color-border-strong);
  background: var(--color-bg-soft);
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  color: var(--color-text-muted);
  line-height: 1.72;
}

.cb :deep(.cb-pre) {
  margin: var(--space-6) 0;
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-md);
  background: var(--color-bg-muted);
  border: 1px solid var(--color-border);
  overflow-x: auto;
  font-size: var(--text-sm);
  line-height: 1.6;
}

.cb :deep(.cb-figure) {
  margin: var(--space-7) 0;
  text-align: center;
}

.cb :deep(.cb-img) {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  box-shadow: 0 12px 32px rgba(23, 35, 74, 0.08);
}

.cb :deep(.cb-figcap) {
  margin-top: var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.cb :deep(.cb-table-wrap) {
  margin: var(--space-6) 0;
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.cb :deep(.cb-table) {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.cb :deep(.cb-table th) {
  text-align: left;
  padding: var(--space-3) var(--space-4);
  background: var(--color-bg-soft);
  font-weight: 620;
  color: var(--color-text);
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
}

.cb :deep(.cb-table td) {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-soft);
  line-height: 1.65;
  vertical-align: top;
}

.cb :deep(.cb-table tr:last-child td) {
  border-bottom: none;
}

.cb :deep(.cb-unknown) {
  margin: var(--space-4) 0;
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: #fef3c7;
  color: #92400e;
  font-size: var(--text-sm);
}
</style>
