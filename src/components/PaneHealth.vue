<template>
  <section class="pane active">
    <h2>{{ t('hlt_title') }}</h2>
    <p class="pane-sub">{{ t('hlt_sub') }}</p>

    <p v-if="loading" class="hlt-loading">
      <span class="spinner" />
      {{ t('hlt_loading') }}
    </p>

    <template v-else-if="stats">
      <!-- ============ 历史权限（沉睡书签依赖） ============ -->
      <div class="grp">
        <div class="inset-group">
          <div class="inset-row">
            <div class="r-main">
              <div class="r-title hlt-perm-title">{{ t('hlt_permTitle') }}</div>
              <div class="r-sub">{{ t('hlt_permDesc') }}</div>
            </div>
            <button
              class="switch"
              role="switch"
              :aria-checked="historyGranted"
              :aria-label="t('hlt_permTitle')"
              @click="toggleHistory"
            />
          </div>
        </div>
      </div>

      <!-- ============ 书签概览（2×2） ============ -->
      <div class="grp">
        <h4>{{ t('hlt_overview') }}</h4>
        <div class="hlt-grid">
          <div v-for="c in statCards" :key="c.key" class="card hlt-stat">
            <div class="hlt-stat-top">
              <span class="hlt-stat-ico" :class="{ 'is-muted': c.muted }">
                <Icon :name="c.icon" />
              </span>
              <div class="hlt-stat-body">
                <div class="hlt-stat-label">{{ c.label }}</div>
                <div class="hlt-stat-value">{{ c.value }}</div>
              </div>
            </div>
            <div class="hlt-stat-sub">{{ c.sub }}</div>
          </div>
        </div>
      </div>

      <!-- ============ AI 洞察 ============ -->
      <div class="grp">
        <h4>{{ t('hlt_aiSection') }}</h4>
        <div class="card">
          <div class="hlt-ai-head">
            <span class="hlt-ai-ico"><Icon name="info" /></span>
            <span class="hlt-ai-title">{{ t('hlt_aiTitle') }}</span>
          </div>
          <div class="hlt-ai-body">
            <span v-if="summary" class="hlt-ai-text">{{ summary }}</span>
            <span v-else class="hlt-ai-empty">{{ aiGate || t('hlt_aiIdle') }}</span>
            <span v-if="summarizing" class="hlt-caret" />
          </div>
          <p v-if="summary && !summarizing" class="hlt-ai-note">
            {{ t('hlt_aiSent', String(sentMetrics)) }}
          </p>
          <p v-if="summaryError" class="hlt-error">{{ summaryError }}</p>
          <button
            class="btn btn-ghost btn-sm hlt-ai-btn"
            :disabled="!!aiGate || (summarizing && !summary)"
            @click="onAiPress"
          >
            <span v-if="summarizing" class="spinner" />
            <Icon v-else name="refresh" />
            {{ summarizing ? t('hlt_aiStop') : summary ? t('hlt_aiRegen') : t('hlt_aiGen') }}
          </button>
        </div>
      </div>

      <!-- ============ 整理建议 ============ -->
      <div v-if="suggestions.length" class="grp">
        <h4>{{ t('hlt_suggestions') }}</h4>
        <div class="inset-group">
          <div
            v-for="s in suggestions"
            :key="s.titleKey"
            class="inset-row clickable"
            @click="go(s.pane)"
          >
            <span class="lede"><Icon :name="s.icon" /></span>
            <div class="r-main">
              <div class="r-title hlt-sug-title">{{ t(s.titleKey) }}</div>
              <div class="r-sub">{{ t(s.descKey, ...s.descSubs) }}</div>
            </div>
            <button class="btn btn-ghost btn-sm" @click.stop="go(s.pane)">
              {{ t(s.actionKey) }}
            </button>
          </div>
        </div>
      </div>

      <p class="hlt-safety">
        <Icon name="shield" />
        {{ t('hlt_privacyNote') }}
      </p>

      <p v-if="err" class="hlt-error">{{ err }}</p>
    </template>
  </section>
</template>

<script setup>
/**
 * PaneHealth.vue — 「健康洞察」pane：本地统计 + AI 总结 + 跨页建议。
 *
 * ## 统计口径与降级
 *
 * 四张卡片的数字全部来自 ai/health.ts 的 collectHealth()（本地计算）。
 * 其中两个口径可能取不到，必须显示为「--」而不是 0：
 *   - 沉睡书签：需要 history 可选权限（见 lib/historyAccess.ts），未授权 → null
 *   - 失效链接：需要先跑过一次链接体检（读它落盘的摘要），没跑过 → null
 *
 * ## 为什么不画「较上月 +5」的趋势
 *
 * 原型卡片上有趋势行，但那需要**历史快照**才有意义。本项目没有存过历次统计，
 * 编一个假的环比数字比不显示更糟 —— 所以这里只保留「当前值 + 口径说明」。
 *
 * ## AI 总结是显式触发，不自动跑
 *
 * 与 provider.ts「AI 是用户主动触发的」一致：打开页面就自动烧用户 token 不可接受。
 * 未配置 AI 时按钮禁用并说明原因（gate）。
 */

import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { t } from '../lib/i18n.js';
import { describeError } from '../lib/errors.js';
import { api } from '../lib/ext.js';
import { showToast, state } from '../store.js';
import { readAiConfig, readApiKey } from '../ai/config.js';
import {
  hasHistoryAccess,
  requestHistoryAccess,
  revokeHistoryAccess,
} from '../lib/historyAccess.js';
import {
  DEFAULT_SLEEP_DAYS,
  collectHealth,
  healthSuggestions,
  readLinkSummary,
  summarizeHealth,
} from '../ai/health.js';
import Icon from './ui/Icon.vue';

const loading = ref(true);
const err = ref('');
const stats = ref(null);
const historyGranted = ref(false);

const summary = ref('');
const summarizing = ref(false);
const summaryError = ref('');
const aiGate = ref('');

let controller = null;

const suggestions = computed(() => (stats.value ? healthSuggestions(stats.value) : []));

/** 送给模型的「可用统计口径」条数（null 的口径在 prompt 里标 unavailable，不计入）。 */
const sentMetrics = computed(() => {
  const s = stats.value;
  if (!s) return 0;
  return [
    s.total,
    s.loose,
    s.duplicateGroups,
    s.duplicateItems,
    s.emptyFolders,
    s.sleeping,
    s.broken,
    s.changed,
  ].filter((v) => v !== null).length;
});

const fmt = (n) => Number(n).toLocaleString();

const statCards = computed(() => {
  const s = stats.value;
  if (!s) return [];
  return [
    s.sleeping === null
      ? {
          key: 'sleep',
          icon: 'lock',
          label: t('hlt_cardSleep'),
          value: '--',
          sub: t('hlt_cardSleepNeedPerm'),
          muted: true,
        }
      : {
          key: 'sleep',
          icon: 'moon',
          label: t('hlt_cardSleep'),
          value: fmt(s.sleeping),
          sub: t('hlt_cardSleepSub', String(DEFAULT_SLEEP_DAYS)),
          muted: false,
        },
    {
      key: 'dup',
      icon: 'copy',
      label: t('hlt_cardDup'),
      value: fmt(s.duplicateItems),
      sub: t('hlt_cardDupSub', String(s.duplicateGroups), String(s.duplicateItems)),
      muted: false,
    },
    {
      key: 'empty',
      icon: 'folder',
      label: t('hlt_cardEmpty'),
      value: fmt(s.emptyFolders),
      sub: t('hlt_cardEmptySub'),
      muted: false,
    },
    s.broken === null
      ? {
          key: 'broken',
          icon: 'globe',
          label: t('hlt_cardBroken'),
          value: '--',
          sub: t('hlt_cardBrokenNotChecked'),
          muted: true,
        }
      : {
          key: 'broken',
          icon: 'alert',
          label: t('hlt_cardBroken'),
          value: fmt(s.broken),
          sub: t('hlt_cardBrokenSub'),
          muted: false,
        },
  ];
});

async function reload() {
  loading.value = true;
  err.value = '';
  try {
    const tree = await api.bookmarks.getTree();
    const linkSummary = await readLinkSummary();
    stats.value = await collectHealth(tree, {
      // 未授权 / 环境无 history API → 传 null，sleeping 记 null（UI 显示「--」）
      history: historyGranted.value && api.history ? api.history : null,
      linkSummary,
    });
  } catch (e) {
    err.value = describeError(e);
  } finally {
    loading.value = false;
  }
}

/**
 * 历史权限开关。
 *
 * ★ `requestHistoryAccess()` 必须是该分支的**第一句 await**（见 lib/historyAccess.ts）：
 * 前面的 `if (historyGranted.value)` 是同步判断，不会吃掉手势，所以是安全的。
 */
async function toggleHistory() {
  if (historyGranted.value) {
    await revokeHistoryAccess();
    historyGranted.value = false;
    await reload();
    return;
  }
  const ok = await requestHistoryAccess();
  historyGranted.value = ok;
  if (ok) {
    await reload();
  } else {
    showToast('warning', t('hlt_permDenied'), '');
  }
}

/** AI 按钮：生成中点一次 = 停止（abort），否则开始生成。 */
function onAiPress() {
  if (summarizing.value) {
    controller?.abort();
    return;
  }
  void generate();
}

async function generate() {
  if (!stats.value || summarizing.value) return;
  // 配置/密钥每次现读：用户可能刚在「AI 设置」里改完就切过来
  const [cfg, key] = await Promise.all([readAiConfig(), readApiKey()]);
  if (!cfg.enabled || !key) {
    aiGate.value = cfg.enabled ? t('qa_gateNoKey') : t('qa_gateDisabled');
    return;
  }
  aiGate.value = '';
  summary.value = '';
  summaryError.value = '';
  summarizing.value = true;
  controller = new AbortController();
  try {
    for await (const chunk of summarizeHealth(cfg, key, stats.value, controller.signal)) {
      summary.value += chunk;
    }
    if (!summary.value.trim()) summaryError.value = t('hlt_aiEmpty');
  } catch (e) {
    // 用户点「停止」不是错误：保留已生成的部分，不弹红字
    if (!controller?.signal.aborted) summaryError.value = describeError(e);
  } finally {
    summarizing.value = false;
    controller = null;
  }
}

/** 跨 pane 跳转（见 OptionsView.vue → panes）。 */
function go(pane) {
  state.navPane = pane;
}

onMounted(async () => {
  const cfg = await readAiConfig();
  if (!cfg.enabled) aiGate.value = t('qa_gateDisabled');
  else if (!(await readApiKey())) aiGate.value = t('qa_gateNoKey');
  historyGranted.value = await hasHistoryAccess();
  await reload();
});

onBeforeUnmount(() => controller?.abort());
</script>

<style scoped>
.hlt-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  font-size: var(--fs-caption);
  color: var(--text-secondary);
}
.hlt-perm-title {
  font-size: var(--fs-secondary);
}
.hlt-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.hlt-stat {
  padding: 12px;
}
.hlt-stat-top {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.hlt-stat-ico {
  width: 36px;
  height: 36px;
  flex: none;
  border-radius: var(--radius-sm);
  background: var(--bg-inset);
  display: grid;
  place-items: center;
  color: var(--text-secondary);
}
.hlt-stat-ico.is-muted {
  color: var(--text-quaternary);
}
.hlt-stat-ico svg {
  width: 20px;
  height: 20px;
}
.hlt-stat-body {
  flex: 1;
  min-width: 0;
}
.hlt-stat-label {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  margin-bottom: 2px;
}
.hlt-stat-value {
  font-size: 24px;
  font-weight: var(--fw-semibold);
  letter-spacing: -0.02em;
  line-height: 1.2;
}
.hlt-stat-sub {
  font-size: var(--fs-badge);
  color: var(--text-tertiary);
  margin-top: 8px;
}
.hlt-ai-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.hlt-ai-ico {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  background: var(--info-tint);
  display: grid;
  place-items: center;
  color: var(--info-text);
}
.hlt-ai-ico svg {
  width: 16px;
  height: 16px;
}
.hlt-ai-title {
  font-size: var(--fs-secondary);
  font-weight: var(--fw-semibold);
}
.hlt-ai-body {
  font-size: var(--fs-secondary);
  line-height: 1.6;
  color: var(--text-primary);
  padding: 10px 12px;
  background: var(--bg);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  min-height: 80px;
  white-space: pre-wrap;
  word-break: break-word;
}
.hlt-ai-empty {
  color: var(--text-tertiary);
}
.hlt-caret {
  display: inline-block;
  width: 2px;
  height: 14px;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: var(--text-primary);
  animation: hltBlink 1s steps(2, start) infinite;
}
@keyframes hltBlink {
  50% {
    opacity: 0;
  }
}
.hlt-ai-note {
  font-size: var(--fs-badge);
  color: var(--text-quaternary);
  margin-top: 8px;
  text-align: right;
}
.hlt-ai-btn {
  margin-top: 10px;
  width: 100%;
}
.hlt-sug-title {
  font-size: var(--fs-secondary);
}
.hlt-safety {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 12px;
  font-size: var(--fs-badge);
  line-height: var(--lh-caption);
  color: var(--text-quaternary);
}
.hlt-safety svg {
  width: 13px;
  height: 13px;
  flex: none;
  margin-top: 2px;
}
.hlt-error {
  margin-top: 12px;
  font-size: var(--fs-caption);
  color: var(--danger-text);
}
</style>
