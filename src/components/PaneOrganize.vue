<template>
  <section class="pane active">
    <h2>{{ t('org_title') }}</h2>
    <p class="pane-sub">{{ t('org_sub') }}</p>

    <!-- 分段：批量归类（走模型）/ 去重检测（本地为主）。两者互不依赖。 -->
    <div class="grp">
      <SegTabs v-model="mode" :options="modeOptions" :aria-label="t('org_modeAria')" />
    </div>

    <!-- ==================== 批量归类 ==================== -->
    <template v-if="mode === 'classify'">
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
            <button
              v-if="classifyController"
              class="btn btn-ghost"
              :disabled="planning"
              @click="stopClassify"
            >
              <Icon name="stop" />
              {{ t('org_stop') }}
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
            <button
              v-if="applying"
              class="btn btn-ghost"
              :disabled="applyShouldStop"
              @click="stopApply"
            >
              <Icon name="stop" />
              {{ t('org_stop') }}
            </button>
            <button v-else class="btn btn-ghost" :disabled="!plan" @click="backToScope">
              {{ t('org_cancel') }}
            </button>
          </div>

          <div v-else class="grp">
            <div class="inset-group">
              <div class="inset-row">
                <span class="lede"><Icon name="check" /></span>
                <div class="r-main">
                  <div class="r-title">{{ t('org_applied', String(result?.movedCount ?? 0)) }}</div>
                  <div v-if="result && !result.ok" class="r-sub">
                    {{ t('org_partialFail', String(result.failures.length)) }}
                  </div>
                  <div v-if="result && result.createdCount > 0" class="r-sub">
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
        </template>
      </template>
    </template>

    <!-- ==================== 去重检测 ==================== -->
    <template v-else>
      <!-- 精确重复（纯本地，零外发） -->
      <div class="grp">
        <div class="inset-group">
          <div class="inset-row clickable" @click="scanDup">
            <span class="lede"><Icon name="copy" /></span>
            <div class="r-main">
              <div class="r-title">{{ t('dpe_title') }}</div>
              <div class="r-sub">{{ t('dpe_sub') }}</div>
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

      <!-- 内容相似（AI 判定，需外发标题与 URL） -->
      <div class="grp">
        <h4 class="org-h4-row">
          {{ t('sdpe_title') }}
          <span class="badge badge-info badge-sub">{{ t('sdpe_badge') }}</span>
        </h4>

        <!-- 未开启：说清代价，给出开启位置（开关就在下方） -->
        <div v-if="!simEnabled" class="banner banner-warning">
          <Icon name="alert" />
          <div>
            <strong>{{ t('sdpe_offTitle') }}</strong>
            <div class="org-banner-sub">{{ t('sdpe_offDesc') }}</div>
          </div>
        </div>

        <!-- 未启用 AI：本地精确去重仍可用，这一块单独 gate -->
        <div v-else-if="gate" class="banner banner-warning">
          <Icon name="alert" />
          <span>{{ gate }}</span>
        </div>

        <div v-else-if="simLoading" class="inset-group">
          <div class="inset-row">
            <span class="spinner" />
            <div class="r-main">
              <div class="r-title">{{ t('sdpe_running') }}</div>
              <div class="r-sub">{{ t('sdpe_runningDesc', String(simPairs)) }}</div>
            </div>
          </div>
        </div>

        <!-- 已开启但还没跑：给一个明确的入口与成本说明 -->
        <div v-else-if="!simScanned" class="card org-sim-start">
          <p class="org-banner-sub">{{ t('sdpe_startDesc') }}</p>
          <div class="org-actions">
            <button class="btn btn-primary btn-lg" @click="runSimCheck">
              <Icon name="star" />
              {{ t('sdpe_run') }}
            </button>
            <button
              v-if="simController"
              class="btn btn-ghost"
              :disabled="simLoading"
              @click="stopSim"
            >
              <Icon name="stop" />
              {{ t('org_stop') }}
            </button>
          </div>
        </div>

        <template v-else>
          <div v-if="simGroups.length === 0" class="banner banner-success">
            <Icon name="check-circle" />
            <span>{{ t('sdpe_none') }}</span>
          </div>

          <div v-else class="org-groups">
            <div class="org-group" v-for="(g, i) in simGroups" :key="i">
              <div class="org-group-head">
                <span class="org-folder">
                  <Icon name="copy" />
                  {{ t('sdpe_group', String(i + 1), String(g.dupIds.length + 1)) }}
                </span>
                <span
                  class="badge badge-sub"
                  :class="g.confidence === 'high' ? 'badge-info' : 'badge-warning'"
                >
                  {{ g.confidence === 'high' ? t('sdpe_confHigh') : t('sdpe_confMedium') }}
                </span>
              </div>
              <ul class="org-items">
                <li
                  v-for="id in [g.keepId, ...g.dupIds]"
                  :key="id"
                  :class="{ 'is-keep': id === g.keepId }"
                >
                  <Icon v-if="id === g.keepId" name="check" />
                  <span class="org-item-title">{{ simTitleOf(id) }}</span>
                  <span class="org-item-url">{{
                    id === g.keepId ? t('sdpe_keep') : siteOf(simUrlOf(id))
                  }}</span>
                </li>
              </ul>
              <p v-if="g.reason" class="org-group-reason">{{ g.reason }}</p>
            </div>
          </div>

          <p class="org-usage">
            {{
              simUsage
                ? t(
                    'sdpe_found',
                    String(simGroups.length),
                    String(simUsage.input),
                    String(simUsage.output),
                  )
                : t('sdpe_foundNoUsage', String(simGroups.length))
            }}
          </p>

          <button class="btn btn-ghost btn-sm org-rescan" @click="runSimCheck">
            <Icon name="refresh" />
            {{ t('sdpe_rescan') }}
          </button>
        </template>

        <p v-if="simError" class="org-status is-error">{{ simError }}</p>

        <p class="org-safety">
          <Icon name="shield" />
          {{ t('sdpe_safetyNote') }}
        </p>
      </div>

      <!-- 开关：AI 语义判重 -->
      <div class="grp">
        <div class="inset-group">
          <div class="inset-row">
            <div class="r-main">
              <div class="r-title">{{ t('sdpe_enableTitle') }}</div>
              <div class="r-sub">{{ t('sdpe_enableDesc') }}</div>
            </div>
            <button
              class="switch"
              role="switch"
              :aria-checked="simEnabled"
              :aria-label="t('sdpe_enableTitle')"
              @click="toggleSim"
            />
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup>
/**
 * PaneOrganize.vue — 「整理书签」pane：AI 归类 + 去重（精确 / 语义）。
 *
 * ## 三个功能并列，互不依赖
 *
 * 归类与语义判重走模型；精确去重是确定性字符串处理（ai/dedupe.ts），零 token
 * 零外发，**任何时候都能单独用**。所以 AI 未就绪的 gate 只挡它真正依赖的那一块，
 * 不再像早期那样整页拦下 —— 否则「没配 AI 就用不了去重」是假的限制。
 *
 * ## 为什么不自动应用
 *
 * 模型返回的分组 / 判重结论**必须**先渲染出来让用户看清，再勾选、再应用。这是
 * ai/classify.ts 文件头那条原则在 UI 上的落地。
 *
 * ## 去重只报告不删除
 *
 * 重复项只被列出来。删除权在用户手上 —— 本项目已有两次「插件删用户数据」
 * 的事故（见 organize.ts 文件头），不做第三次。
 */

import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { t } from '../lib/i18n.js';
import { describeError } from '../lib/errors.js';
import { api } from '../lib/ext.js';
import { showToast } from '../store.js';
import { readAiConfig, readApiKey } from '../ai/config.js';
import { applyPlan, hostOf, listFolders, planOrganize, revertApply } from '../ai/organize.js';
import { collectBookmarks, findDuplicates } from '../ai/dedupe.js';
import { buildCandidates, classifySemanticDupes } from '../ai/semanticDedupe.js';
import Icon from './ui/Icon.vue';
import SegTabs from './ui/SegTabs.vue';

const mode = ref('classify'); // 'classify' | 'dedupe'
const modeOptions = [
  { value: 'classify', label: t('org_tabClassify') },
  { value: 'dedupe', label: t('org_tabDedupe') },
];

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

// ---- 精确重复（本地） ----
const dupGroups = ref([]);
const dupScanning = ref(false);
const dupScanned = ref(false);
let titleMap = new Map();

// ---- 语义相似（AI） ----
/** 默认关：开启即代表同意把标题与 URL 发给模型，不能替用户默认勾上。 */
const simEnabled = ref(false);
const simLoading = ref(false);
const simScanned = ref(false);
const simGroups = ref([]);
const simUsage = ref(null);
const simPairs = ref(0);
const simError = ref('');
/** id → { title, url, path }，供结果展示。 */
let simMeta = new Map();

// ---- 取消控制 ----
/** 归类（buildPlan → planOrganize）的 AbortController；非空时显示「停止」按钮。 */
const classifyController = ref(null);
/** 语义判重（runSimCheck）的 AbortController；非空时显示「停止」按钮。 */
const simController = ref(null);
/** apply 的停止标志：置真后 applyPlan 的 shouldStop 在下一轮返回 true，停在已完成位置。 */
const applyShouldStop = ref(false);

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

/**
 * 切走 pane（或关标签页）时中止在途请求：否则 promise 仍会跑完、继续烧 token、
 * 把结果写进一个已经不可见的组件。归类与语义判重各自持有独立的 controller。
 */
onBeforeUnmount(() => {
  classifyController.value?.abort();
  simController.value?.abort();
  classifyController.value = null;
  simController.value = null;
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
  // 每次新开归类都新建 controller：上一轮的 abort 不影响本轮，也避免复用已 aborted 的 signal
  classifyController.value = new AbortController();
  const signal = classifyController.value.signal;
  try {
    const [cfg, key] = await Promise.all([readAiConfig(), readApiKey()]);
    plan.value = await planOrganize(api.bookmarks, cfg, key, scopeId.value, signal);
    selected.value = plan.value.groups.map((g) => g.key);
    stage.value = 'plan';
    // 取消语义：已完成批次的方案仍展示，但明确告知用户是「部分完成」，别假装全量跑完
    if (plan.value.aborted) setStatus(t('org_partial', String(plan.value.groups.length)), false);
  } catch (e) {
    // 用户主动取消不是错误：不弹红字，保持已生成的部分方案可见
    if (signal.aborted) {
      if (plan.value && plan.value.groups.length > 0) {
        stage.value = 'plan';
        setStatus(t('org_partial', String(plan.value.groups.length)), false);
      }
      return;
    }
    setStatus(describeError(e), true);
  } finally {
    planning.value = false;
    classifyController.value = null;
  }
}

/** 用户点「停止」：中止归类请求。已完成的批次结果保留，未发起的不发。 */
function stopClassify() {
  classifyController.value?.abort();
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
  applyShouldStop.value = false;
  setStatus('');
  // shouldStop 是个函数：applyPlan 每步前调用，返回 true 即停在已完成的位置（半程不回滚）
  const shouldStop = () => applyShouldStop.value;
  try {
    const r = await applyPlan(
      api.bookmarks,
      plan.value,
      selected.value,
      (done, total) => {
        setStatus(t('org_progress', String(done), String(total)));
      },
      shouldStop,
    );
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

/** 用户点「停止」：applyPlan 下一轮检查 shouldStop 时会停在已完成位置。 */
function stopApply() {
  applyShouldStop.value = true;
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

/** 精确去重：全树扫，不受「选定范围」限制 —— 重复书签散在各处。 */
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

function toggleSim() {
  simEnabled.value = !simEnabled.value;
  simError.value = '';
}

/**
 * 语义判重：全树取候选 → 交模型判定。
 *
 * 候选生成在本地完成（buildCandidates），只把「值得问」的几十到几百对发出去，
 * 所以花费与书签总量基本无关，只与疑似重复的数量有关。
 */
async function runSimCheck() {
  if (simLoading.value) return;
  simLoading.value = true;
  simError.value = '';
  simGroups.value = [];
  simUsage.value = null;
  simPairs.value = 0;
  // 每次新开都新建 controller（同 buildPlan 的理由）
  simController.value = new AbortController();
  const signal = simController.value.signal;
  try {
    const tree = await api.bookmarks.getTree();
    const items = collectBookmarks(tree);
    simMeta = new Map(items.map((b) => [b.id, b]));
    const pairs = buildCandidates(items.map((b) => ({ id: b.id, title: b.title, url: b.url })));
    simPairs.value = pairs.length;
    if (pairs.length === 0) {
      simScanned.value = true;
      return;
    }
    const [cfg, key] = await Promise.all([readAiConfig(), readApiKey()]);
    const r = await classifySemanticDupes(cfg, key, items, pairs, signal);
    simGroups.value = r.groups;
    simUsage.value = r.usage ?? null;
    simScanned.value = true;
    if (r.aborted) simError.value = t('sdpe_aborted', String(r.groups.length));
  } catch (e) {
    // 用户主动取消不是错误：保留已生成的部分结果，不弹红字
    if (signal.aborted) {
      simScanned.value = true;
      if (simGroups.value.length > 0)
        simError.value = t('sdpe_aborted', String(simGroups.value.length));
      return;
    }
    simError.value = describeError(e);
  } finally {
    simLoading.value = false;
    simController.value = null;
  }
}

/** 用户点「停止」：中止语义判重请求。已完成的批次结果保留，未发起的不发。 */
function stopSim() {
  simController.value?.abort();
}

function titleOf(id) {
  return titleMap.get(id) || id;
}

function simTitleOf(id) {
  return simMeta.get(id)?.title || simMeta.get(id)?.url || id;
}

function simUrlOf(id) {
  return simMeta.get(id)?.url || '';
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
.org-h4-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.org-banner-sub {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  margin-top: 2px;
}
.org-sim-start {
  margin-top: 8px;
}
.org-rescan {
  margin-top: 8px;
}
.org-group-reason {
  margin: 0;
  padding: 0 12px 9px 34px;
  font-size: var(--fs-badge);
  color: var(--text-quaternary);
}
</style>
