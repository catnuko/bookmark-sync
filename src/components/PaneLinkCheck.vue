<template>
  <section class="pane active">
    <h2>{{ t('lnk_title') }}</h2>
    <p class="pane-sub">{{ t('lnk_sub') }}</p>

    <!-- ============ 未授权：必须先拿到广域 host 权限才能读到真实状态码 ============ -->
    <template v-if="state === 'unauthorized'">
      <div class="grp">
        <div class="banner banner-warning">
          <Icon name="alert" />
          <div>
            <strong>{{ t('lnk_unauthTitle') }}</strong>
            <div class="lnk-banner-sub">{{ t('lnk_unauthDesc') }}</div>
          </div>
        </div>
        <div class="card lnk-card">
          <div class="lnk-grant-head">
            <span class="lede"><Icon name="globe" /></span>
            <div class="r-main">
              <div class="r-title">{{ t('lnk_unauthGrantTitle') }}</div>
              <div class="lnk-bullets">
                <p>· {{ t('lnk_unauthBullet1') }}</p>
                <p>· {{ t('lnk_unauthBullet2') }}</p>
                <p>· {{ t('lnk_unauthBullet3') }}</p>
              </div>
            </div>
          </div>
          <button class="btn btn-primary btn-lg" @click="grant">
            {{ t('lnk_unauthGrant') }}
          </button>
        </div>
      </div>
    </template>

    <!-- ============ 权限被拦截：给出可操作的手动路径 ============ -->
    <template v-else-if="state === 'permissionDenied'">
      <div class="grp">
        <div class="banner banner-warning">
          <Icon name="alert" />
          <div>
            <strong>{{ t('lnk_deniedTitle') }}</strong>
            <div class="lnk-banner-sub">{{ t('lnk_deniedDesc') }}</div>
          </div>
        </div>
        <div class="inset-group lnk-card">
          <button class="inset-row clickable" type="button" @click="openExtensionsPage">
            <span class="lede"><Icon name="external-link" /></span>
            <div class="r-main">
              <div class="r-title">{{ t('lnk_deniedOpen') }}</div>
              <div class="r-sub">{{ t('lnk_deniedOpenDesc') }}</div>
            </div>
            <Icon class="chev" name="chevron-right" />
          </button>
        </div>
        <button class="btn btn-secondary lnk-retry" @click="grant">
          {{ t('lnk_deniedRetry') }}
        </button>
      </div>
    </template>

    <!-- ============ 初始：选范围 + 开始 ============ -->
    <template v-else-if="state === 'idle'">
      <div class="grp">
        <div class="card">
          <div class="field">
            <label for="lnk-scope">{{ t('lnk_scopeLabel') }}</label>
            <select id="lnk-scope" v-model="scopeId" class="input">
              <option value="all">{{ t('lnk_scopeAll', String(allCount)) }}</option>
              <option v-for="f in scopes" :key="f.id" :value="f.id">
                {{ '　'.repeat(f.depth) }}{{ f.title }}
              </option>
            </select>
          </div>
          <button class="btn btn-primary btn-lg lnk-start" @click="startDetect">
            <Icon name="refresh" />
            {{ t('lnk_start') }}
          </button>
          <p class="foot lnk-center">{{ t('lnk_startNote') }}</p>
        </div>
      </div>
    </template>

    <!-- ============ 检测中 ============ -->
    <template v-else-if="state === 'detecting'">
      <div class="grp">
        <div class="progress">
          <i :style="{ width: progress + '%' }" />
        </div>
        <div class="lnk-progress-row">
          <span class="lnk-progress-text">
            {{ t('lnk_detectingStat', String(done), String(total), String(abnormal)) }}
          </span>
          <button class="btn btn-ghost btn-sm" @click="togglePause">
            {{ paused ? t('lnk_resume') : t('lnk_pause') }}
          </button>
        </div>
        <div class="lnk-running">
          <span class="spinner" />
          {{ t('lnk_detectingNote') }}
        </div>
      </div>
    </template>

    <!-- ============ 报告 ============ -->
    <template v-else-if="state === 'report'">
      <!-- 统计行 -->
      <div class="grp">
        <div class="inset-group">
          <div class="lnk-stats">
            <div v-for="s in statCells" :key="s.key" class="lnk-stat">
              <div class="lnk-stat-n">{{ s.count }}</div>
              <span class="badge badge-sub" :class="s.cls">{{ s.label }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- AI 建议的加载 / 失败说明 -->
      <div v-if="aiLoading" class="grp">
        <div class="inset-group">
          <div class="inset-row">
            <span class="spinner" />
            <div class="r-main">
              <div class="r-title">{{ t('lnk_aiLoading') }}</div>
              <div class="r-sub">{{ t('lnk_aiLoadingDesc', String(broken.length)) }}</div>
            </div>
          </div>
        </div>
      </div>
      <div v-else-if="aiSkipped" class="grp">
        <div class="banner banner-info">
          <Icon name="info" />
          <span>{{ aiSkipped }}</span>
        </div>
      </div>

      <!-- 失效 -->
      <div v-if="broken.length" class="grp">
        <h4 class="lnk-h4">
          {{ t('lnk_groupBroken') }}
          <span class="badge badge-danger badge-sub">{{ broken.length }}</span>
        </h4>
        <div class="inset-group">
          <div v-for="b in broken" :key="b.id">
            <div class="inset-row lnk-row">
              <input
                v-if="newUrlOf(b.id)"
                type="checkbox"
                class="lnk-check"
                :checked="selected.has(b.id)"
                :aria-label="b.title || b.url"
                @change="toggleSelect(b.id)"
              />
              <span v-else class="lnk-check-spacer" />
              <button class="lnk-row-main" type="button" @click="toggleExpand(b.id)">
                <span class="r-main">
                  <span class="r-title lnk-title">
                    {{ b.title || b.url }}
                    <span class="badge badge-danger badge-sub">{{ t('lnk_statusBroken') }}</span>
                  </span>
                  <span class="r-sub mono">{{ b.url }}</span>
                </span>
                <Icon
                  class="chev lnk-chev"
                  :class="{ 'is-open': expanded.has(b.id) }"
                  name="chevron-right"
                />
              </button>
            </div>
            <div v-if="expanded.has(b.id)" class="lnk-detail">
              <div v-if="suggestionOf(b.id)" class="lnk-suggest">
                <div class="lnk-suggest-row">
                  <span class="badge badge-neutral badge-sub">{{ t('lnk_aiOriginal') }}</span>
                  <span class="mono lnk-strike">{{ b.url }}</span>
                </div>
                <div class="lnk-suggest-row">
                  <span class="badge badge-info badge-sub">{{ t('lnk_aiSuggest') }}</span>
                  <span class="mono">{{ suggestionOf(b.id).newUrl }}</span>
                </div>
                <div class="lnk-suggest-src">
                  {{ t('lnk_aiSource')
                  }}<template v-if="suggestionOf(b.id).reason">
                    · {{ suggestionOf(b.id).reason }}</template
                  >
                </div>
              </div>
              <div v-else class="lnk-suggest-none">{{ t('lnk_aiNone') }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 重定向（探活确定，非 AI） -->
      <div v-if="redirect.length" class="grp">
        <h4 class="lnk-h4">
          {{ t('lnk_groupRedirect') }}
          <span class="badge badge-warning badge-sub">{{ redirect.length }}</span>
        </h4>
        <div class="inset-group">
          <div v-for="b in redirect" :key="b.id">
            <div class="inset-row lnk-row">
              <input
                type="checkbox"
                class="lnk-check"
                :checked="selected.has(b.id)"
                :aria-label="b.title || b.url"
                @change="toggleSelect(b.id)"
              />
              <button class="lnk-row-main" type="button" @click="toggleExpand(b.id)">
                <span class="r-main">
                  <span class="r-title lnk-title">
                    {{ b.title || b.url }}
                    <span class="badge badge-warning badge-sub">{{ t('lnk_statusRedirect') }}</span>
                  </span>
                  <span class="r-sub mono">{{ b.url }}</span>
                </span>
                <Icon
                  class="chev lnk-chev"
                  :class="{ 'is-open': expanded.has(b.id) }"
                  name="chevron-right"
                />
              </button>
            </div>
            <div v-if="expanded.has(b.id)" class="lnk-detail">
              <div class="lnk-suggest">
                <div class="lnk-suggest-label">{{ t('lnk_redirectNew') }}</div>
                <span class="mono">{{ b.finalUrl }}</span>
                <div class="lnk-suggest-src">{{ t('lnk_srcProbe') }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 疑似改版（跨域跳转，同样是探活确定的结果） -->
      <div v-if="changed.length" class="grp">
        <h4 class="lnk-h4">
          {{ t('lnk_groupChanged') }}
          <span class="badge badge-info badge-sub">{{ changed.length }}</span>
        </h4>
        <div class="inset-group">
          <div v-for="b in changed" :key="b.id">
            <div class="inset-row lnk-row">
              <input
                type="checkbox"
                class="lnk-check"
                :checked="selected.has(b.id)"
                :aria-label="b.title || b.url"
                @change="toggleSelect(b.id)"
              />
              <button class="lnk-row-main" type="button" @click="toggleExpand(b.id)">
                <span class="r-main">
                  <span class="r-title lnk-title">
                    {{ b.title || b.url }}
                    <span class="badge badge-info badge-sub">{{ t('lnk_statusChanged') }}</span>
                  </span>
                  <span class="r-sub mono">{{ b.url }}</span>
                </span>
                <Icon
                  class="chev lnk-chev"
                  :class="{ 'is-open': expanded.has(b.id) }"
                  name="chevron-right"
                />
              </button>
            </div>
            <div v-if="expanded.has(b.id)" class="lnk-detail">
              <div class="lnk-suggest">
                <div class="lnk-suggest-label">{{ t('lnk_redirectNew') }}</div>
                <span class="mono">{{ b.finalUrl }}</span>
                <div class="lnk-suggest-src">{{ t('lnk_srcProbe') }}</div>
              </div>
            </div>
          </div>
        </div>
        <p class="foot lnk-foot">{{ t('lnk_changedNote') }}</p>
      </div>

      <!-- 无法确认 -->
      <div v-if="unknown.length" class="grp">
        <h4 class="lnk-h4">
          {{ t('lnk_groupUnknown') }}
          <span class="badge badge-neutral badge-sub">{{ unknown.length }}</span>
        </h4>
        <div class="inset-group">
          <button
            v-for="b in unknown"
            :key="b.id"
            class="inset-row clickable"
            type="button"
            @click="openUrl(b.url)"
          >
            <span class="lnk-check-spacer" />
            <span class="r-main">
              <span class="r-title lnk-title">
                {{ b.title || b.url }}
                <span class="badge badge-neutral badge-sub">{{ t('lnk_statusUnknown') }}</span>
              </span>
              <span class="r-sub mono">{{ b.url }}</span>
              <span v-if="b.reason" class="lnk-reason">{{ b.reason }}</span>
            </span>
            <Icon class="ext" name="external-link" />
          </button>
        </div>
        <p class="foot lnk-foot">{{ t('lnk_unknownNote') }}</p>
      </div>

      <!-- 正常（只报告数量） -->
      <div v-if="okCount > 0" class="grp">
        <div class="inset-group">
          <div class="inset-row">
            <span class="badge badge-success badge-sub">{{ t('lnk_statOk') }}</span>
            <span class="lnk-ok-text">{{ t('lnk_healthyRow', String(okCount)) }}</span>
          </div>
        </div>
      </div>

      <p v-if="err" class="lnk-error">{{ err }}</p>

      <!-- 底部操作条 -->
      <div class="lnk-bar">
        <div class="lnk-bar-count">
          {{ t('lnk_selected', String(selectedCount)) }}
        </div>
        <div class="lnk-bar-note">{{ t('lnk_applyNote') }}</div>
        <ArmedButton
          :label="t('lnk_apply')"
          :confirm-label="t('lnk_apply')"
          :armed="armed"
          :countdown="armLeft"
          :disabled="selectedCount === 0 || applying"
          @press="onApplyPress"
        />
      </div>
    </template>

    <!-- ============ 全部健康 ============ -->
    <template v-else-if="state === 'allHealthy'">
      <div class="grp">
        <div class="banner banner-success">
          <Icon name="check-circle" />
          <div>
            <strong>{{ t('lnk_allHealthyTitle') }}</strong>
            <div class="lnk-banner-sub">{{ t('lnk_allHealthyDesc', String(total)) }}</div>
          </div>
        </div>
        <div class="card lnk-center-card">
          <div class="lnk-big-check"><Icon name="check" /></div>
          <div class="lnk-center-title">{{ t('lnk_allHealthyCardTitle') }}</div>
          <div class="lnk-banner-sub">{{ t('lnk_allHealthyCardDesc', String(total)) }}</div>
        </div>
        <button class="btn btn-ghost lnk-retry" @click="reset">{{ t('lnk_done') }}</button>
      </div>
    </template>

    <!-- ============ 采纳完成 ============ -->
    <template v-else-if="state === 'completed'">
      <div class="grp">
        <div class="banner banner-success">
          <Icon name="check-circle" />
          <div>
            <strong>{{ t('lnk_doneTitle', String(appliedCount)) }}</strong>
            <div class="lnk-banner-sub">{{ t('lnk_doneDesc') }}</div>
          </div>
        </div>
        <div class="lnk-actions">
          <button class="btn btn-secondary" :disabled="reverting" @click="revert">
            <span v-if="reverting" class="spinner" />
            <Icon v-else name="refresh" />
            {{ t('lnk_revert') }}
          </button>
          <button class="btn btn-ghost" @click="reset">{{ t('lnk_done') }}</button>
        </div>
        <p class="foot">{{ t('lnk_revertNote') }}</p>
      </div>
    </template>
  </section>
</template>

<script setup>
/**
 * PaneLinkCheck.vue — 「链接体检」pane。
 *
 * ## 七个界面状态
 *
 * unauthorized → idle → detecting → report → completed（另有 allHealthy / permissionDenied）。
 * 状态由真实流程驱动（原型里那排「原型演示状态」按钮是演示脚手架，不落地）。
 *
 * ## 探活在设置页跑
 *
 * 见 ai/linkCheck.ts 文件头：MV3 的 SW 会被回收，长任务必须由常驻页面驱动。
 * 所以**关掉这个标签页 = 中止检测**，这一点在 idle 态就写明了。
 *
 * ## 只改 URL，不删书签
 *
 * 采纳的动作是 `chrome.bookmarks.update(id, {url})`，撤销是写回旧 URL。全程不调
 * `remove` —— 删节点会经 onRemoved 产生墓碑并跨设备传播。
 */

import { computed, onUnmounted, reactive, ref } from 'vue';
import { t } from '../lib/i18n.js';
import { describeError } from '../lib/errors.js';
import { api } from '../lib/ext.js';
import { showToast } from '../store.js';
import { readAiConfig, readApiKey } from '../ai/config.js';
import { hasBroadHostAccess, requestBroadHostAccess } from '../ai/hostAccess.js';
import { listFolders } from '../ai/organize.js';
import { writeLinkSummary } from '../ai/health.js';
import {
  applyRepairs,
  collectHttpBookmarks,
  createLinkChecker,
  revertRepairs,
  suggestRepairs,
} from '../ai/linkCheck.js';
import Icon from './ui/Icon.vue';
import ArmedButton from './ui/ArmedButton.vue';

const state = ref('idle'); // unauthorized | idle | detecting | report | allHealthy | completed | permissionDenied
const scopes = ref([]);
const scopeId = ref('all');
const allCount = ref(0);

const progress = ref(0);
const done = ref(0);
const total = ref(0);
const abnormal = ref(0);
const paused = ref(false);

const results = ref([]);
const expanded = ref(new Set());
const selected = ref(new Set());

const aiLoading = ref(false);
const aiSkipped = ref('');
/** id → { newUrl, reason } */
const suggestions = reactive(new Map());

const armed = ref(false);
const armLeft = ref(0);
const applying = ref(false);
const reverting = ref(false);
const appliedCount = ref(0);
const err = ref('');

/** 当前这一轮探活器实例（暂停/停止/卸载时要用）。 */
let checker = null;
let armTimer = null;

const broken = computed(() => results.value.filter((r) => r.status === 'broken'));
const redirect = computed(() => results.value.filter((r) => r.status === 'redirect'));
const changed = computed(() => results.value.filter((r) => r.status === 'changed'));
const unknown = computed(() => results.value.filter((r) => r.status === 'unknown'));
const okCount = computed(() => results.value.filter((r) => r.status === 'ok').length);

const selectedCount = computed(() => selected.value.size);

const statCells = computed(() => [
  { key: 'ok', label: t('lnk_statOk'), count: okCount.value, cls: 'badge-success' },
  { key: 'broken', label: t('lnk_statBroken'), count: broken.value.length, cls: 'badge-danger' },
  {
    key: 'redirect',
    label: t('lnk_statRedirect'),
    count: redirect.value.length,
    cls: 'badge-warning',
  },
  { key: 'changed', label: t('lnk_statChanged'), count: changed.value.length, cls: 'badge-info' },
  {
    key: 'unknown',
    label: t('lnk_statUnknown'),
    count: unknown.value.length,
    cls: 'badge-neutral',
  },
]);

function suggestionOf(id) {
  return suggestions.get(id);
}

/** 该项可采纳的新地址：优先 AI 建议，其次探活得到的最终地址。 */
function newUrlOf(id) {
  return suggestions.get(id)?.newUrl || results.value.find((r) => r.id === id)?.finalUrl || '';
}

function toggleExpand(id) {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}

function toggleSelect(id) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

function openUrl(url) {
  if (url) void api.tabs?.create({ url });
}

function openExtensionsPage() {
  // Chrome / Edge 都是 chrome://extensions；Firefox 是 about:addons
  const url = /Firefox\//.test(navigator.userAgent) ? 'about:addons' : 'chrome://extensions';
  void api.tabs?.create({ url });
}

/** 授权：permissions.request 必须在手势第一句（见 hostAccess.ts）。 */
async function grant() {
  const ok = await requestBroadHostAccess();
  if (ok) {
    state.value = 'idle';
    await loadScopes();
  } else {
    state.value = 'permissionDenied';
  }
}

async function loadScopes() {
  try {
    const tree = await api.bookmarks.getTree();
    allCount.value = collectHttpBookmarks(tree).length;
    const folders = await listFolders(api.bookmarks);
    scopes.value = folders.map((f) => ({ id: f.id, title: f.title, depth: f.depth }));
  } catch (e) {
    err.value = describeError(e);
  }
}

function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = n.children ? findNode(n.children, id) : undefined;
    if (hit) return hit;
  }
  return undefined;
}

async function itemsForScope() {
  const tree = await api.bookmarks.getTree();
  if (scopeId.value === 'all') return collectHttpBookmarks(tree);
  const node = findNode(tree, scopeId.value);
  return node ? collectHttpBookmarks([node]) : [];
}

function togglePause() {
  paused.value = !paused.value;
  if (paused.value) checker?.pause();
  else checker?.resume();
}

async function startDetect() {
  err.value = '';
  results.value = [];
  expanded.value = new Set();
  selected.value = new Set();
  suggestions.clear();
  aiSkipped.value = '';
  progress.value = 0;
  done.value = 0;
  abnormal.value = 0;
  paused.value = false;
  state.value = 'detecting';

  try {
    const items = await itemsForScope();
    total.value = items.length;
    if (items.length === 0) {
      state.value = 'allHealthy';
      return;
    }
    checker = createLinkChecker(items, {
      onProgress: (d, tot, ab) => {
        done.value = d;
        total.value = tot;
        abnormal.value = ab;
        progress.value = Math.round((d / tot) * 100);
      },
    });
    results.value = await checker.start();
    checker = null;

    // 落一份摘要给「健康洞察」读（那边不重跑探活，只看这份数字）。失败静默。
    void writeLinkSummary({
      at: Date.now(),
      total: results.value.length,
      ok: results.value.filter((r) => r.status === 'ok').length,
      broken: results.value.filter((r) => r.status === 'broken').length,
      redirect: results.value.filter((r) => r.status === 'redirect').length,
      changed: results.value.filter((r) => r.status === 'changed').length,
      unknown: results.value.filter((r) => r.status === 'unknown').length,
    });

    if (results.value.every((r) => r.status === 'ok')) {
      state.value = 'allHealthy';
      return;
    }
    state.value = 'report';
    // 默认勾选「有可采纳新地址」的失效项（重定向/改版留空，由用户自己判断要不要动）
    selected.value = new Set(broken.value.filter((b) => !!newUrlOf(b.id)).map((b) => b.id));
    void fetchSuggestions();
  } catch (e) {
    err.value = describeError(e);
    state.value = 'idle';
  }
}

/**
 * 取 AI 修复建议。
 *
 * 只发失效项（不发 unknown —— 那些大多是被反爬挡住，模型也猜不准）。AI 未就绪时
 * 不报错、只留一句说明：链接体检的探活部分本来就不依赖模型。
 */
async function fetchSuggestions() {
  if (broken.value.length === 0) return;
  try {
    const [cfg, key] = await Promise.all([readAiConfig(), readApiKey()]);
    if (!cfg.enabled || !key) {
      aiSkipped.value = t('lnk_aiOff');
      return;
    }
    aiLoading.value = true;
    const r = await suggestRepairs(cfg, key, broken.value);
    for (const s of r.items) suggestions.set(s.id, { newUrl: s.newUrl, reason: s.reason });
    if (r.items.length === 0) aiSkipped.value = t('lnk_aiNoSuggestion');
    // 建议到了 → 勾选这些项
    const next = new Set(selected.value);
    for (const s of r.items) next.add(s.id);
    selected.value = next;
  } catch (e) {
    aiSkipped.value = t('lnk_aiFail', describeError(e));
  } finally {
    aiLoading.value = false;
  }
}

/** 两步确认：第一次点进入 armed 倒计时，倒计时内再点才真正执行。 */
function onApplyPress() {
  if (selectedCount.value === 0 || applying.value) return;
  if (!armed.value) {
    armed.value = true;
    armLeft.value = 3;
    clearInterval(armTimer ?? undefined);
    armTimer = setInterval(() => {
      armLeft.value -= 1;
      if (armLeft.value <= 0) {
        armed.value = false;
        clearInterval(armTimer ?? undefined);
        armTimer = null;
      }
    }, 1000);
    return;
  }
  clearInterval(armTimer ?? undefined);
  armTimer = null;
  armed.value = false;
  void doApply();
}

/** 会话内快照，供撤销。不落盘 —— 关掉页面就没了（UI 上写明了）。 */
let lastSnapshot = { updated: [] };

async function doApply() {
  const targets = [...selected.value]
    .map((id) => ({
      id,
      oldUrl: results.value.find((r) => r.id === id)?.url ?? '',
      newUrl: newUrlOf(id),
    }))
    .filter((x) => x.oldUrl && x.newUrl && x.oldUrl !== x.newUrl);
  if (targets.length === 0) return;

  applying.value = true;
  err.value = '';
  try {
    const r = await applyRepairs(api.bookmarks, targets);
    lastSnapshot = r.snapshot;
    appliedCount.value = r.applied;
    if (r.ok) {
      showToast('success', t('lnk_doneTitle', String(r.applied)), '');
      state.value = 'completed';
    } else {
      err.value = t('lnk_partialFail', String(r.failures.length));
      showToast('danger', t('lnk_partialFail', String(r.failures.length)), '');
      state.value = 'completed';
    }
  } catch (e) {
    err.value = describeError(e);
  } finally {
    applying.value = false;
  }
}

async function revert() {
  if (reverting.value || lastSnapshot.updated.length === 0) return;
  reverting.value = true;
  try {
    const r = await revertRepairs(api.bookmarks, lastSnapshot);
    showToast('success', t('lnk_reverted', String(r.reverted)), '');
    lastSnapshot = { updated: [] };
    appliedCount.value = 0;
    state.value = 'report';
  } catch (e) {
    err.value = describeError(e);
  } finally {
    reverting.value = false;
  }
}

function reset() {
  results.value = [];
  suggestions.clear();
  selected.value = new Set();
  expanded.value = new Set();
  progress.value = 0;
  done.value = 0;
  abnormal.value = 0;
  appliedCount.value = 0;
  aiSkipped.value = '';
  err.value = '';
  state.value = 'idle';
  void loadScopes();
}

// 挂载即判定权限：没有广域 host 权限时探活读不到状态码，直接进授权引导
void (async () => {
  if (await hasBroadHostAccess()) {
    state.value = 'idle';
    await loadScopes();
  } else {
    state.value = 'unauthorized';
  }
})();

onUnmounted(() => {
  checker?.stop();
  clearInterval(armTimer ?? undefined);
});
</script>

<style scoped>
.lnk-banner-sub {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  margin-top: 2px;
}
.lnk-card {
  margin-top: 12px;
}
.lnk-grant-head {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.lnk-bullets {
  margin-top: 6px;
  font-size: var(--fs-caption);
  line-height: var(--lh-caption);
  color: var(--text-secondary);
}
.lnk-start {
  margin-top: 14px;
}
.lnk-center {
  text-align: center;
}
.lnk-retry {
  margin-top: 12px;
}
.lnk-progress-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
}
.lnk-progress-text {
  font-size: var(--fs-secondary);
  color: var(--text-secondary);
}
.lnk-running {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
}
.lnk-stats {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
}
.lnk-stat {
  padding: 12px 10px;
  text-align: center;
}
.lnk-stat-n {
  font-size: 22px;
  font-weight: var(--fw-semibold);
  letter-spacing: -0.02em;
  margin-bottom: 4px;
}
.lnk-h4 {
  display: flex;
  align-items: center;
  gap: 6px;
}
.lnk-row {
  min-height: 56px;
}
.lnk-check {
  width: 16px;
  height: 16px;
  flex: none;
  accent-color: var(--brand);
}
.lnk-check-spacer {
  width: 16px;
  flex: none;
}
.lnk-row-main {
  flex: 1;
  display: flex;
  align-items: center;
  min-width: 0;
  background: none;
  border: 0;
  padding: 0;
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: inherit;
}
.lnk-title {
  font-size: var(--fs-secondary);
}
.lnk-chev {
  transition: transform var(--dur-fast);
}
.lnk-chev.is-open {
  transform: rotate(90deg);
}
.lnk-detail {
  padding: 0 14px 12px 42px;
  background: var(--bg-elevated);
}
.lnk-suggest {
  background: var(--bg);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
}
.lnk-suggest-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.lnk-suggest-row + .lnk-suggest-row {
  margin-top: 6px;
}
.lnk-strike {
  font-size: var(--fs-caption);
  color: var(--text-quaternary);
  text-decoration: line-through;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lnk-suggest-label {
  font-size: var(--fs-badge);
  color: var(--text-quaternary);
  margin-bottom: 4px;
}
.lnk-suggest-src {
  font-size: var(--fs-badge);
  color: var(--text-quaternary);
  margin-top: 6px;
}
.lnk-suggest-none {
  font-size: var(--fs-caption);
  color: var(--text-quaternary);
}
.lnk-reason {
  font-size: var(--fs-badge);
  color: var(--text-quaternary);
}
.lnk-foot {
  margin-left: 0;
}
.lnk-ok-text {
  font-size: var(--fs-secondary);
  color: var(--text-secondary);
  margin-left: 8px;
}
.lnk-error {
  margin-top: 12px;
  font-size: var(--fs-caption);
  color: var(--danger-text);
}
/* 底部操作条：负外边距抹掉 .opt-content 的 padding，贴住内容区下沿 */
.lnk-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 24px -32px -48px;
  padding: 12px 32px;
  background: var(--material-thick);
  backdrop-filter: var(--material-blur);
  -webkit-backdrop-filter: var(--material-blur);
  border-top: 1px solid var(--border);
}
.lnk-bar-count {
  font-size: var(--fs-secondary);
  color: var(--text-secondary);
}
.lnk-bar-note {
  flex: 1;
  text-align: right;
  font-size: var(--fs-badge);
  color: var(--text-quaternary);
}
.lnk-center-card {
  margin-top: 12px;
  text-align: center;
  padding: 32px 14px;
}
.lnk-big-check {
  width: 48px;
  height: 48px;
  margin: 0 auto 12px;
  background: var(--success-tint);
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--success-text);
}
.lnk-big-check svg {
  width: 28px;
  height: 28px;
}
.lnk-center-title {
  font-size: var(--fs-title);
  font-weight: var(--fw-semibold);
}
.lnk-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
</style>
