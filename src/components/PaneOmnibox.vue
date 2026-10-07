<template>
  <section class="pane active">
    <h2>{{ t('omb_title') }}</h2>
    <p class="pane-sub">{{ t('omb_sub') }}</p>

    <!-- 用法 -->
    <div class="grp">
      <h4>{{ t('omb_usageTitle') }}</h4>
      <div class="card">
        <p class="omb-step">
          <span class="omb-step-n">{{ t('omb_step1') }}</span>
        </p>
        <p class="omb-step">
          <span class="omb-step-n">{{ t('omb_step2') }}</span>
        </p>
        <p class="omb-step">
          <span class="omb-step-n">{{ t('omb_step3') }}</span>
        </p>
        <p class="omb-example">
          <kbd>bs</kbd>
          <span class="omb-example-q">{{ t('omb_example') }}</span>
        </p>
      </div>
    </div>

    <!--
      静态示意图。地址栏是**浏览器原生 UI**，扩展改不了它的长相，也不该在这里
      放一个假的输入框骗人 —— 所以这一段只用于说明建议项长什么样，不可交互。
    -->
    <div class="grp">
      <h4>{{ t('omb_mockTitle') }}</h4>
      <div class="omb-mock">
        <div class="omb-bar">
          <Icon name="bookmark" />
          <span class="omb-bar-kw">bs</span>
          <span class="omb-bar-sep" />
          <span class="omb-bar-q">{{ t('omb_example') }}</span>
        </div>
        <ul class="omb-list">
          <li v-for="(s, i) in mock" :key="i" :class="{ 'is-first': i === 0 }">
            <span class="omb-item-ico">
              <Icon :name="s.folder ? 'folder' : 'bookmark'" />
            </span>
            <span class="omb-item-main">
              <span class="omb-item-title">
                <template v-for="(seg, j) in s.parts" :key="j">
                  <strong v-if="seg.hit">{{ seg.text }}</strong>
                  <template v-else>{{ seg.text }}</template>
                </template>
              </span>
              <span class="omb-item-sub">{{ s.path }} · {{ s.url }}</span>
            </span>
            <span class="omb-item-tail">{{
              i === 0 ? t('omb_enterHint') : t('omb_typeBookmark')
            }}</span>
          </li>
        </ul>
      </div>
      <p class="foot">{{ t('omb_mockNote') }}</p>
    </div>

    <!-- 排版规则 -->
    <div class="grp">
      <h4>{{ t('omb_ruleTitle') }}</h4>
      <div class="inset-group">
        <div class="inset-row">
          <div class="r-main">
            <div class="r-title">{{ t('omb_rule1Title') }}</div>
            <div class="r-sub">{{ t('omb_rule1Desc') }}</div>
          </div>
        </div>
        <div class="inset-row">
          <div class="r-main">
            <div class="r-title">{{ t('omb_rule2Title') }}</div>
            <div class="r-sub">{{ t('omb_rule2Desc') }}</div>
          </div>
        </div>
        <div class="inset-row">
          <div class="r-main">
            <div class="r-title">{{ t('omb_rule3Title') }}</div>
            <div class="r-sub">{{ t('omb_rule3Desc') }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 隐私边界 -->
    <div class="grp">
      <div class="banner banner-success">
        <Icon name="shield" />
        <div>
          <strong>{{ t('omb_privacyTitle') }}</strong>
          <div class="omb-privacy-desc">{{ t('omb_privacyDesc') }}</div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
/**
 * PaneOmnibox.vue — 「地址栏搜索」说明页。
 *
 * 地址栏建议项由浏览器原生渲染，设置页里没有可操作的真控件，所以这个 pane 的定位是
 * **设计规格说明 + 用法引导**（与原型 OmniboxDemoPane 的定位一致）。真正的检索逻辑在
 * `src/omnibox.ts`（SW 顶层注册，复用 ai/qa.ts 的本地打分）。
 *
 * 原型里的「输入框」是可交互的假控件（能打字、能过滤）—— 这里刻意做成**静态示意**：
 * 放一个打得进字、却和真实地址栏毫无关系的输入框只会误导人。
 */
import { t } from '../lib/i18n.js';
import Icon from './ui/Icon.vue';

/** 示意用的建议项（纯展示，不代表真实数据）。parts 用于演示命中词加粗。 */
const mock = [
  {
    folder: false,
    parts: [
      { text: '深入理解 ', hit: false },
      { text: 'CRDT', hit: true },
      { text: ' 算法原理与实践', hit: false },
    ],
    path: '工作资料 / 前端开发',
    url: 'example.com/crdt-deep-dive',
  },
  {
    folder: false,
    parts: [{ text: 'CRDTs: The Hard Parts', hit: false }],
    path: '工作资料 / 分布式',
    url: 'martin.kleppmann.com/crdt-hard-parts',
  },
  {
    folder: true,
    parts: [{ text: 'CRDT 相关论文合集', hit: false }],
    path: '阅读清单 / 技术论文',
    url: 'github.com/crdt-papers',
  },
];
</script>

<style scoped>
.omb-step {
  display: flex;
  gap: 8px;
  font-size: var(--fs-secondary);
  line-height: var(--lh-secondary);
  color: var(--text-primary);
}
.omb-step + .omb-step {
  margin-top: 6px;
}
.omb-step-n {
  color: var(--text-secondary);
}
.omb-example {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
  font-size: var(--fs-secondary);
  color: var(--text-secondary);
}
.omb-example-q {
  font-family: var(--font-mono);
  color: var(--text-primary);
}

/* 静态示意：模拟浏览器地址栏 + 下拉建议 */
.omb-mock {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 12px 14px;
}
.omb-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 14px;
  background: var(--bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-full);
}
.omb-bar svg {
  width: 16px;
  height: 16px;
  color: var(--text-secondary);
}
.omb-bar-kw {
  font-size: var(--fs-secondary);
  color: var(--text-quaternary);
}
.omb-bar-sep {
  width: 1px;
  height: 16px;
  background: var(--border-strong);
}
.omb-bar-q {
  font-size: var(--fs-secondary);
  color: var(--text-primary);
}
.omb-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  background: var(--bg);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.omb-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
}
.omb-list li.is-first {
  background: var(--bg-elevated);
}
.omb-item-ico {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  color: var(--text-secondary);
  flex: none;
}
.omb-item-ico svg {
  width: 16px;
  height: 16px;
}
.omb-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.omb-item-title {
  font-size: var(--fs-secondary);
  font-weight: var(--fw-medium);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.omb-item-title strong {
  font-weight: var(--fw-semibold);
}
.omb-item-sub {
  font-size: var(--fs-badge);
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.omb-item-tail {
  font-size: var(--fs-badge);
  color: var(--text-quaternary);
  white-space: nowrap;
  flex: none;
}
.omb-privacy-desc {
  font-size: var(--fs-secondary);
  color: var(--text-secondary);
  margin-top: 2px;
}
</style>
