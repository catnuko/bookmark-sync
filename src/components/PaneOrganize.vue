<template>
  <section class="pane active">
    <h2>{{ t('org_title') }}</h2>
    <p class="pane-sub">{{ t('org_sub') }}</p>

    <!-- 前置条件未满足：说清原因而不是让按钮静默失败 -->
    <div v-if="gate" class="banner banner-warning">
      <Icon name="alert" />
      <span>{{ gate }}</span>
    </div>

    <template v-else>
      <!-- ============ 步骤 1：选范围 ============ -->
      <div v-if="stage === 'scope'" class="grp">
        <div class="field">
          <label for="org-scope">{{ t('org_pickScope') }}</label>
          <select id="org-scope" v-model="scopeId" class="input">
            <option value="" disabled>{{ t('org_pickScopePlaceholder') }}</option>
            <option v-for="f in eligible" :key="f.id" :value="f.id">
              {{ '　'.repeat(f.depth) }}{{ f.title }}（{{ f.looseCount }}）
            </option>
          </select>
          <p class="hint">{{ t('org_pickScopeHint') }}</p>
        </div>

        <div class="org-actions">
          <button class="btn btn-primary" :disabled="!scopeId || planning" @click="buildPlan">
            <span v-if="planning" class="spinner" />
            <Icon v-else name="star" />
            {{ planning ? t('org_planning') : t('org_start') }}
          </button>
        </div>
      </div>

      <!-- ============ 步骤 2：预览方案 + 应用 ============ -->
      <template v-else>
        <div class="org-summary">
          <button type="button" class="link-btn" @click="backToScope">
            {{ t('org_changeScope') }}
          </button>
          <span class="org-summary-main">
            <strong>{{ plan?.scopeTitle }}</strong>
            · {{ t('org_planStat', String(plan?.groups.length ?? 0), String(plan?.total ?? 0)) }}
          </span>
        </div>

        <div v-if="!plan || plan.groups.length === 0" class="banner">
          <Icon name="info" />
          <span>{{ t('org_noGroups') }}</span>
        </div>

        <div v-else class="org-groups">
          <div class="org-group" v-for="g in plan.groups" :key="g.key">
            <label class="org-group-head">
              <input
                type="checkbox"
                :checked="selected.includes(g.key)"
                @change="toggleGroup(g.key)"
              />
              <span class="org-folder">
                <Icon :name="g.kind === 'reuse' ? 'folder' : 'folder-plus'" />
                {{ g.folder }}
              </span>
              <span class="badge" :class="g.kind === 'reuse' ? 'badge-info' : 'badge-neutral'">
                {{ g.kind === 'reuse' ? t('org_reuse') : t('org_create') }}
              </span>
              <span class="badge badge-sub">{{ g.items.length }}</span>
            </label>
            <ul class="org-items">
              <li v-for="it in g.items.slice(0, 6)" :key="it.id">
                <span class="org-item-title">{{ it.title || it.url }}</span>
                <span class="org-item-url">{{ siteOf(it.url) }}</span>
              </li>
              <li v-if="g.items.length > 6" class="org-more">
                {{ t('org_moreItems', String(g.items.length - 6)) }}
              </li>
            </ul>
          </div>
        </div>

        <!-- 未归类：只报告，不自动处理 -->
        <div v-if="plan?.unclassified.length" class="banner banner-warning">
          <Icon name="alert" />
          <span>{{ t('org_unclassified', String(plan.unclassified.length)) }}</span>
        </div>

        <p v-if="plan?.usage" class="org-usage">
          {{ t('org_usage', String(plan.usage.input), String(plan.usage.output)) }}
        </p>

        <p class="org-safety">
          <Icon name="shield" />
          {{ t('org_safetyNote') }}
        </p>

        <!-- 应用 / 撤销 / 进度 -->
        <div v-if="!applied" class="org-actions">
          <button
            class="btn btn-primary"
            :disabled="selected.length === 0 || applying"
            @click="apply"
          >
            <span v-if="applying" class="spinner" />
            <Icon v-else name="check" />
            {{ t('org_apply', String(moveCount)) }}
          </button>
          <button class="btn btn-ghost" :disabled="!plan" @click="backToScope">
            {{ t('org_cancel') }}
          </button>
        </div>

        <div v-else class="grp">
          <div class="inset-group">
            <div class="inset-row">
              <span class="lede"><Icon name="check" /></span>
              <div class="r-main">
                <div class="r-title">{{ t('org_applied', String(result?.movedCount ?? 0)) }}</div>
                <div v-if="result && !result.ok" class="r-desc">
                  {{ t('org_partialFail', String(result.failures.length)) }}
                </div>
                <div v-if="result && result.createdCount > 0" class="r-desc">
                  {{ t('org_createdFolders', String(result.createdCount)) }}
                </div>
              </div>
            </div>
          </div>
          <div class="org-actions">
            <button class="btn" :disabled="reverting" @click="revert">
              {{ reverting ? t('org_reverting') : t('org_revert') }}
            </button>
            <button class="btn btn-ghost" @click="reset">{{ t('org_done') }}</button>
          </div>
        </div>

        <p v-if="statusMsg" class="org-status" :class="{ 'is-error': statusBad }">
          {{ statusMsg }}
        </p>
      </template>

      <!-- ============ 去重（纯本地，与归类并列的独立功能）============ -->
      <div v-if="stage === 'scope' || !applied" class="grp org-dedupe">
        <div class="inset-group">
          <div class="inset-row clickable" @click="scanDup">
            <span class="lede"><Icon name="copy" /></span>
            <div class="r-main">
              <div class="r-title">{{ t('dpe_title') }}</div>
              <div class="r-desc">{{ t('dpe_sub') }}</div>
            </div>
            <span v-if="dupScanning" class="spinner" />
            <Icon v-else class="chev" name="chevron-right" />
          </div>
        </div>

        <template v-if="dupGroups.length > 0">
          <p class="org-safety">
            <Icon name="alert" />
            {{ t('dpe_safetyNote') }}
          </p>
          <div class="org-groups">
            <div class="org-group" v-for="(g, i) in dupGroups" :key="g.key">
              <div class="org-group-head">
                <span class="org-folder">
                  <Icon name="copy" />
                  {{ t('dpe_group', String(i + 1), String(g.dupIds.length + 1)) }}
                </span>
                <span class="badge badge-warning">{{ siteOf(g.key) }}</span>
              </div>
              <ul class="org-items">
                <li
                  v-for="id in [g.keepId, ...g.dupIds]"
                  :key="id"
                  :class="{ 'is-keep': id === g.keepId }"
                >
                  <Icon v-if="id === g.keepId" name="check" />
                  <span class="org-item-title">{{ titleOf(id) }}</span>
                  <span class="org-item-url">{{
                    id === g.keepId ? t('dpe_keep') : shortUrl(g.urls[id])
                  }}</span>
                </li>
              </ul>
            </div>
          </div>
        </template>
        <p v-else-if="dupScanned" class="org-status">{{ t('dpe_none') }}</p>
      </div>
    </template>
  </section>
</template>

<script setup>
/**
 * PaneOrganize.vue — 「整理书签」pane：AI 归类 + 本地去重。
 *
 * ## 两个功能并列，不互相依赖
 *
 * 归类走模型、去重不走。去重是确定性字符串处理（ai/dedupe.ts），零 token 零
 * 外发，任何时候都能单独用；把它们塞进一个向导会让人以为「不去重就没法归类」。
 *
 * ## 为什么不自动应用
 *
 * 模型返回的分组**必须**先渲染成 diff 让用户看清，再勾选、再应用。这是
 * ai/classify.ts 文件头那条原则在 UI 上的落地。
 *
 * ## 去重只报告不删除
 *
 * 重复项只被列出来。删除权在用户手上 —— 本项目已有两次「插件删用户数据」
 * 的事故（见 organize.ts 文件头），不做第三次。
 */

import { computed, onMounted, ref } from 'vue';
import { t } from '../lib/i18n.js';
import { describeError } from '../lib/errors.js';
import { api } from '../lib/ext.js';
import { showToast } from '../store.js';
import { readAiConfig, readApiKey } from '../ai/config.js';
import { applyPlan, hostOf, listFolders, planOrganize, revertApply } from '../ai/organize.js';
import { collectBookmarks, findDuplicates } from '../ai/dedupe.js';
import Icon from './ui/Icon.vue';

const stage = ref('scope'); // 'scope' | 'plan'
const gate = ref('');
const folders = ref([]);
const scopeId = ref('');
const plan = ref(null);
const selected = ref([]);
const planning = ref(false);
const applying = ref(false);
const reverting = ref(false);
const applied = ref(false);
const result = ref(null);
const statusMsg = ref('');
const statusBad = ref(false);

const dupGroups = ref([]);
const dupScanning = ref(false);
const dupScanned = ref(false);
let titleMap = new Map();

/** 只有「有散书签可整理」的文件夹才是有效范围，looseCount=0 的列出来只是噪音。 */
const eligible = computed(() => folders.value.filter((f) => f.looseCount > 0));
const moveCount = computed(() =>
  (plan.value?.groups ?? [])
    .filter((g) => selected.value.includes(g.key))
    .reduce((n, g) => n + g.items.length, 0),
);

onMounted(async () => {
  const [cfg, key] = await Promise.all([readAiConfig(), readApiKey()]);
  if (!cfg.enabled) gate.value = t('qa_gateDisabled');
  else if (!key) gate.value = t('qa_gateNoKey');
  try {
    folders.value = await listFolders(api.bookmarks);
  } catch (e) {
    setStatus(describeError(e), true);
  }
});

function setStatus(text, bad = false) {
  statusMsg.value = text;
  statusBad.value = bad;
}

/** 函数名不能叫 plan —— 已有同名 ref（当前方案），Volar/oxc 会判为重复声明。 */
async function buildPlan() {
  if (!scopeId.value || planning.value) return;
  planning.value = true;
  setStatus('');
  try {
    const [cfg, key] = await Promise.all([readAiConfig(), readApiKey()]);
    plan.value = await planOrganize(api.bookmarks, cfg, key, scopeId.value);
    selected.value = plan.value.groups.map((g) => g.key);
    stage.value = 'plan';
  } catch (e) {
    setStatus(describeError(e), true);
  } finally {
    planning.value = false;
  }
}

function toggleGroup(key) {
  selected.value = selected.value.includes(key)
    ? selected.value.filter((k) => k !== key)
    : [...selected.value, key];
}

function backToScope() {
  stage.value = 'scope';
  plan.value = null;
  selected.value = [];
  setStatus('');
}

async function apply() {
  if (!plan.value || applying.value) return;
  applying.value = true;
  setStatus('');
  try {
    const r = await applyPlan(api.bookmarks, plan.value, selected.value, (done, total) => {
      setStatus(t('org_progress', String(done), String(total)));
    });
    result.value = r;
    applied.value = true;
    if (r.ok) showToast('success', t('org_applied', String(r.movedCount)), '');
    else showToast('danger', t('org_partialFail', String(r.failures.length)), '');
  } catch (e) {
    setStatus(describeError(e), true);
  } finally {
    applying.value = false;
  }
}

async function revert() {
  if (!result.value || reverting.value) return;
  reverting.value = true;
  try {
    const r = await revertApply(api.bookmarks, result.value.snapshot);
    setStatus(t('org_reverted', String(r.reverted)));
    showToast('success', t('org_reverted', String(r.reverted)), '');
    applied.value = false;
    result.value = null;
  } catch (e) {
    setStatus(describeError(e), true);
  } finally {
    reverting.value = false;
  }
}

function reset() {
  plan.value = null;
  result.value = null;
  applied.value = false;
  selected.value = [];
  scopeId.value = '';
  stage.value = 'scope';
  setStatus('');
  loadFolders();
}

async function loadFolders() {
  try {
    folders.value = await listFolders(api.bookmarks);
  } catch (e) {
    setStatus(describeError(e), true);
  }
}

/** 去重：全树扫，不受「选定范围」限制 —— 重复书签散在各处。 */
async function scanDup() {
  if (dupScanning.value) return;
  dupScanning.value = true;
  try {
    const tree = await api.bookmarks.getTree();
    for (const b of collectBookmarks(tree)) titleMap.set(b.id, b.title || b.url);
    dupGroups.value = findDuplicates(tree);
    dupScanned.value = true;
  } catch (e) {
    setStatus(describeError(e), true);
  } finally {
    dupScanning.value = false;
  }
}

function titleOf(id) {
  return titleMap.get(id) || id;
}

/**
 * ★ 从 classify.ts 复用，不在这里另写一份。
 * 归类时模型看到的是去 www 的 hostname，预览里必须显示同一个 —— 两处算法
 * 不同会让用户以为「归错了」（其实只是显示差异）。
 *
 * 非 http(s) 的书签（少见但存在）hostOf 返回空串，这时退回到短 URL，
 * 否则预览里会出现一个空标签。
 */
function siteOf(url) {
  return hostOf(url) || shortUrl(url);
}

function shortUrl(url) {
  if (!url) return '';
  return url.length > 48 ? `${url.slice(0, 48)}…` : url;
}
</script>

<style scoped>
.org-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 12px;
}
.org-summary {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  font-size: var(--fs-caption);
  color: var(--text-secondary);
}
.org-summary-main strong {
  color: var(--text-primary);
}
.org-groups {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 46vh;
  overflow-y: auto;
  padding-right: 2px;
}
.org-group {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
}
.org-group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  cursor: pointer;
  font-size: var(--fs-secondary);
}
.org-folder {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: var(--fw-medium);
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
}
.org-folder svg {
  width: 15px;
  height: 15px;
  flex: none;
  color: var(--text-tertiary);
}
.org-items {
  list-style: none;
  margin: 0;
  padding: 0 12px 9px 34px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.org-items li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
  min-width: 0;
}
.org-items li.is-keep {
  color: var(--success-text);
}
.org-items li svg {
  width: 12px;
  height: 12px;
  flex: none;
  align-self: center;
}
.org-item-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
}
.org-item-url {
  flex: none;
  font-size: var(--fs-badge);
  color: var(--text-quaternary);
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.org-more {
  font-style: italic;
}
.org-usage {
  margin-top: 8px;
  font-size: var(--fs-badge);
  color: var(--text-quaternary);
}
.org-safety {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 12px;
  font-size: var(--fs-badge);
  line-height: var(--lh-caption);
  color: var(--text-quaternary);
}
.org-safety svg {
  width: 13px;
  height: 13px;
  flex: none;
  margin-top: 2px;
}
.org-status {
  margin-top: 10px;
  font-size: var(--fs-caption);
  color: var(--text-secondary);
}
.org-status.is-error {
  color: var(--danger-text);
}
.org-dedupe {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border-subtle);
}
</style>
