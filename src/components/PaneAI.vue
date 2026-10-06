<template>
  <section class="pane active">
    <h2>{{ t('ai_title') }}</h2>
    <p class="pane-sub">{{ t('ai_sub') }}</p>

    <!-- 总开关 -->
    <div class="grp">
      <div class="inset-group">
        <div class="inset-row">
          <span class="lede"><Icon name="star" /></span>
          <div class="r-main">
            <div class="r-title">{{ t('ai_enable') }}</div>
            <div class="r-desc">{{ t('ai_enableDesc') }}</div>
          </div>
          <button
            class="switch"
            :aria-checked="enabled"
            role="switch"
            :aria-label="t('ai_enable')"
            @click="toggleEnabled"
          />
        </div>
      </div>
    </div>

    <!--
      ★ 没有条目时的空态。这是**常见状态**而不是边缘情况：AI 代码还没发版，
      商店用户装完就是空的。所以必须给一个明确的下一步，不能只显示一个空框。
    -->
    <div v-if="list.length === 0" class="grp">
      <div class="banner banner-info">
        <Icon name="info" />
        <span>{{ t('ai_noProviders') }}</span>
      </div>
    </div>

    <template v-else>
      <!-- ============ 模型列表 ============ -->
      <div class="grp">
        <h4>{{ t('ai_modelList') }}</h4>
        <div class="inset-group">
          <div
            v-for="e in list"
            :key="e.id"
            class="inset-row provider-row"
            :class="{ active: e.id === activeId }"
          >
            <button class="provider-main" type="button" @click="pick(e.id)">
              <span class="r-main">
                <span class="r-title">
                  <span v-if="e.id === activeId" class="badge badge-success">{{
                    t('ai_inUse')
                  }}</span>
                  {{ e.label || providerLabel(e.provider) }}
                </span>
                <span class="r-desc mono">{{ e.model }}</span>
              </span>
            </button>
            <button
              class="icon-btn"
              :title="t('ai_removeProvider')"
              :aria-label="t('ai_removeProvider')"
              :disabled="list.length === 1"
              @click="remove(e.id)"
            >
              <Icon name="trash" />
            </button>
          </div>
        </div>
        <p class="hint">{{ t('ai_modelListHint') }}</p>
      </div>

      <!-- ============ 加号：预设厂商 / 自定义 ============ -->
      <div v-if="pickerOpen" class="grp">
        <h4>{{ t('ai_addProvider') }}</h4>
        <div class="preset-grid">
          <button
            v-for="p in providerList"
            :key="p.id"
            type="button"
            class="btn preset-btn"
            @click="addPreset(p.id)"
          >
            {{ p.label }}
          </button>
        </div>
        <div class="field">
          <label for="ai-new-label">{{ t('ai_customProvider') }}</label>
          <input
            id="ai-new-label"
            v-model="newLabel"
            class="input"
            type="text"
            :placeholder="t('ai_customProviderPlaceholder')"
          />
          <p class="hint">{{ t('ai_customProviderHint') }}</p>
        </div>
        <div class="ai-actions">
          <button class="btn btn-primary" :disabled="!newLabel.trim()" @click="addCustom">
            <Icon name="plus" />
            {{ t('ai_add') }}
          </button>
          <button class="btn btn-ghost" @click="closePicker">{{ t('ai_cancel') }}</button>
        </div>
      </div>
      <button v-else class="btn btn-secondary add-row" type="button" @click="pickerOpen = true">
        <Icon name="plus" />
        {{ t('ai_addProvider') }}
      </button>

      <!-- ============ 当前条目的编辑表单 ============ -->
      <template v-if="cur">
        <div class="grp">
          <div class="field">
            <label for="ai-label">{{ t('ai_label') }}</label>
            <input id="ai-label" v-model="draft.label" class="input" type="text" />
            <p class="hint">{{ t('ai_labelHint') }}</p>
          </div>

          <div class="field">
            <label for="ai-provider-kind">{{ t('ai_providerKind') }}</label>
            <select
              id="ai-provider-kind"
              v-model="draft.provider"
              class="input"
              @change="onKindChange"
            >
              <option v-for="p in providerList" :key="p.id" :value="p.id">{{ p.label }}</option>
            </select>
            <p class="hint">{{ t('ai_providerKindHint') }}</p>
          </div>

          <div class="field">
            <label for="ai-base">{{ t('ai_baseUrl') }}</label>
            <input
              id="ai-base"
              v-model="draft.baseUrl"
              class="input mono"
              type="url"
              spellcheck="false"
              placeholder="https://api.anthropic.com"
            />
            <p class="hint">{{ t('ai_baseUrlHint') }}</p>
          </div>

          <div class="field">
            <label for="ai-model">{{ t('ai_model') }}</label>
            <input
              id="ai-model"
              v-model="draft.model"
              class="input mono"
              type="text"
              spellcheck="false"
            />
          </div>
        </div>

        <!-- API Key：默认掩码，同 KeyPanel 的理由（屏幕共享时明文太易被读走） -->
        <div class="grp">
          <div class="field">
            <label for="ai-key">{{ t('ai_apiKey') }}</label>
            <div class="key-row">
              <input
                id="ai-key"
                v-model="keyInput"
                class="input mono"
                :type="keyRevealed ? 'text' : 'password'"
                spellcheck="false"
                autocomplete="off"
                :placeholder="t('ai_apiKeyPlaceholder')"
              />
              <button
                class="icon-btn"
                :title="keyRevealed ? t('ai_hideKey') : t('ai_revealKey')"
                :aria-label="keyRevealed ? t('ai_hideKey') : t('ai_revealKey')"
                :aria-pressed="keyRevealed"
                @click="keyRevealed = !keyRevealed"
              >
                <Icon :name="keyRevealed ? 'eye-off' : 'eye'" />
              </button>
            </div>
            <p class="hint">{{ t('ai_apiKeyHint') }}</p>
          </div>

          <div class="ai-actions">
            <button class="btn btn-primary" :disabled="busy || !canTest" @click="testConnection">
              <Icon name="refresh" />
              {{ busy === 'test' ? t('ai_testing') : t('ai_test') }}
            </button>
            <button class="btn" :disabled="busy || !dirty" @click="save">
              <Icon name="check" />
              {{ t('ai_save') }}
            </button>
            <button class="btn btn-ghost" :disabled="busy" @click="wipe">
              <Icon name="trash" />
              {{ t('ai_clear') }}
            </button>
          </div>
        </div>

        <p v-if="msg" class="foot" :class="msgBad ? 'hint-error' : 'hint-ok'">{{ msg }}</p>

        <!--
          CORS 被挡时的出口。按钮只在需要时出现，且 click handler 的第一句就是
          permissions.request() —— 中间插入任何 await 都会消费掉用户手势导致静默失败。
        -->
        <button v-if="needHost" class="btn btn-secondary" @click="grantHost">
          <Icon name="shield" />
          {{ t('ai_grantHost') }}
        </button>
      </template>
    </template>

    <!-- 隐私边界：这一段是本功能最需要说清楚的事，不能折叠进 README -->
    <div class="grp">
      <div class="banner banner-info">
        <Icon name="shield" />
        <span>{{ t('ai_privacy') }}</span>
      </div>
    </div>
  </section>
</template>

<script setup>
/**
 * PaneAI.vue — AI 面板（BYOK 配置），设置页的第 1 个 pane。
 *
 * ## 列表形态（2026-10-06 起）
 *
 * 早期是「一个下拉 + 一套表单」：填第二个厂商就覆盖第一个。用户同时用
 * DeepSeek 测效果、用 Ollama 跑本地模型时只能反复重填 key。
 *
 * 现在是「列表 + 加号」：每条 provider 独立的 baseUrl / model / key，切一条
 * 不影响上一条。`id` 用本地随机串而非厂商名 —— 同一个厂商可以加两条（官方 +
 * 中转），用厂商名当 key 会互相覆盖。
 *
 * 关键约束（见 ai/provider.ts 与 ai/hostAccess.ts）：
 *   - API Key 只存 chrome.storage.local，不进同步存储（不漫游到其它设备）。
 *   - Key 与配置**分开存**（`ai.keys` vs `ai.providers`），见 config.ts 文件头。
 *   - 默认零 host 权限；自建端点挡 CORS 时才在用户手势内申请。
 *   - 用户不点「保存」就不落盘，避免半填状态被当成有效配置。
 */
import { ref, reactive, computed, onMounted } from 'vue';
import { t } from '../lib/i18n.js';
import { showToast } from '../store.js';
import { describeError } from '../lib/errors.js';
import { PROVIDER_DEFAULTS, complete, isCorsBlocked } from '../ai/provider.js';
import {
  addProvider,
  clearAi,
  migrateLegacy,
  readActiveId,
  readAllKeys,
  readEnabled,
  readProviders,
  removeProvider,
  setActiveProvider,
  setEnabled,
  updateProvider,
  writeAllKeys,
} from '../ai/config.js';
import { hasHostAccess, requestHostAccess, originOf } from '../ai/hostAccess.js';
import Icon from './ui/Icon.vue';

const PROVIDERS = Object.keys(PROVIDER_DEFAULTS);
const providerList = PROVIDERS.map((id) => ({ id, label: PROVIDER_DEFAULTS[id].label }));

const list = ref([]);
const activeId = ref('');
const keys = ref({});
const enabled = ref(false);
const loaded = ref(false); // 未载入前不显示，避免闪默认值

/** 当前正在编辑的那条的草稿（v-model 直接绑存储对象会在每次输入时写盘）。 */
const draft = reactive({ id: '', label: '', provider: 'custom', baseUrl: '', model: '' });
const keyInput = ref('');
const keyRevealed = ref(false);
const pickerOpen = ref(false);
const newLabel = ref('');
const busy = ref(''); // '' | 'test' | 'save'
const msg = ref('');
const msgBad = ref(false);
/** 测试报了 CORS 且尚未授权 → 露出「授权访问」按钮。 */
const needHost = ref(false);

/** 载入时的快照，用于算 dirty。 */
let snapCfg = null;
let snapKey = '';

const cur = computed(() => list.value.find((e) => e.id === activeId.value) ?? null);
const dirty = computed(
  () =>
    loaded.value &&
    cur.value &&
    (JSON.stringify(draft) !== JSON.stringify(snapCfg) || keyInput.value !== snapKey),
);
const canTest = computed(
  () => !!draft.baseUrl.trim() && !!draft.model.trim() && !!keyInput.value.trim(),
);

onMounted(async () => {
  await migrateLegacy(); // 旧结构（单条 ai.config）读时迁进列表
  const [ls, ak, ks, en] = await Promise.all([
    readProviders(),
    readActiveId(),
    readAllKeys(),
    readEnabled(),
  ]);
  list.value = ls;
  activeId.value = ak;
  keys.value = ks;
  enabled.value = en;
  if (ls.length > 0) loadDraft(ls, ak, ks);
  loaded.value = true;
});

// activeId 可能不在列表里（迁移残留/被删）→ 退回第一条
function resolveActive(ls, ak) {
  if (ls.length === 0) return '';
  return ls.some((e) => e.id === ak) ? ak : ls[0].id;
}

function loadDraft(ls, ak, ks) {
  const id = resolveActive(ls, ak);
  activeId.value = id;
  const e = ls.find((x) => x.id === id);
  if (!e) return;
  Object.assign(draft, {
    id: e.id,
    label: e.label,
    provider: e.provider,
    baseUrl: e.baseUrl,
    model: e.model,
  });
  keyInput.value = ks[id] ?? '';
  snapCfg = {
    id: draft.id,
    label: draft.label,
    provider: draft.provider,
    baseUrl: draft.baseUrl,
    model: draft.model,
  };
  snapKey = keyInput.value;
  needHost.value = false;
}

async function refresh() {
  const [ls, ak, ks] = await Promise.all([readProviders(), readActiveId(), readAllKeys()]);
  list.value = ls;
  keys.value = ks;
  loadDraft(ls, ak, ks);
}

function setMsg(text, bad = false) {
  msg.value = text;
  msgBad.value = bad;
}

function providerLabel(p) {
  return PROVIDER_DEFAULTS[p]?.label ?? p;
}

async function pick(id) {
  activeId.value = id;
  await setActiveProvider(id);
  loadDraft(list.value, id, keys.value);
}

async function addPreset(providerId) {
  const e = await addProvider(providerId);
  closePicker();
  await refresh();
  await setActiveProvider(e.id);
  loadDraft(list.value, e.id, keys.value);
  setMsg('');
}

async function addCustom() {
  const label = newLabel.value.trim();
  if (!label) return;
  // 自定义条目统一用 custom 协议族，baseUrl/model 由用户自己填
  const e = await addProvider('custom');
  await updateProvider(e.id, { label, baseUrl: '', model: '' });
  closePicker();
  await refresh();
  await setActiveProvider(e.id);
  loadDraft(list.value, e.id, keys.value);
  setMsg('');
}

function closePicker() {
  pickerOpen.value = false;
  newLabel.value = '';
}

async function remove(id) {
  if (list.value.length === 1) return; // 至少留一条，否则 UI 无处可编辑
  await removeProvider(id);
  const ak = activeId.value === id ? '' : activeId.value;
  await refresh();
  loadDraft(list.value, ak, keys.value);
  setMsg('');
}

async function toggleEnabled() {
  enabled.value = !enabled.value;
  await setEnabled(enabled.value);
}

async function save() {
  if (!draft.id) return;
  busy.value = 'save';
  try {
    await updateProvider(draft.id, {
      label: draft.label,
      provider: draft.provider,
      baseUrl: draft.baseUrl,
      model: draft.model,
    });
    const nextKeys = { ...keys.value };
    if (keyInput.value.trim()) nextKeys[draft.id] = keyInput.value.trim();
    else delete nextKeys[draft.id];
    await updateKeys(nextKeys);
    await refresh();
    setMsg(t('ai_saved'));
    showToast('success', t('ai_savedTitle'), '');
  } catch (e) {
    setMsg(describeError(e), true);
    showToast('danger', t('ai_saveFailTitle'), '');
  } finally {
    busy.value = '';
  }
}

/** key 映射的写入走 config.ts 的正规接口，保持「配置与 key 分开存」的不变式。 */
async function updateKeys(next) {
  await writeAllKeys(next);
}

/**
 * 换厂商类型时把 baseUrl/model 带过去 —— 但**只在它们还是上一个厂商的默认值
 * 时**才替换，否则会覆盖用户特意填的代理地址。
 */
function onKindChange() {
  const d = PROVIDER_DEFAULTS[draft.provider];
  if (!d) return;
  const isSomeDefault = Object.values(PROVIDER_DEFAULTS).some(
    (x) => x.baseUrl === draft.baseUrl || x.model === draft.model,
  );
  if (isSomeDefault || !draft.baseUrl.trim()) {
    draft.baseUrl = d.baseUrl;
    draft.model = d.model;
  }
  if (
    !draft.label.trim() ||
    Object.values(PROVIDER_DEFAULTS).some((x) => x.label === draft.label)
  ) {
    draft.label = d.label;
  }
}

/**
 * 测试连通性。
 *
 * 这里刻意用真实的一次小请求（maxTokens 极小）而不是 HEAD / 探活 —— 探活只能证明
 * 域名可达，证明不了 key 有效、模型名存在、协议兼容。用户要的就是这三件事。
 */
async function testConnection() {
  if (!canTest.value) return;
  busy.value = 'test';
  setMsg('');
  const origin = originOf(draft.baseUrl);
  try {
    const res = await complete(
      { provider: draft.provider, baseUrl: draft.baseUrl, model: draft.model },
      keyInput.value.trim(),
      { messages: [{ role: 'user', content: 'ping' }], maxTokens: 1 },
    );
    const usage = res.usage ? ` · ${res.usage.input}+${res.usage.output} tokens` : '';
    setMsg(t('ai_testOk', res.model ?? draft.model, usage.replace(/^ · /, '')));
    showToast('success', t('ai_testOkTitle'), draft.model);
  } catch (e) {
    // CORS 被挡 → 引导授权 host 权限。这是自建端点最常见的失败原因，
    // 错误文案本身不可读，所以单独识别并给出可操作的下一步。
    if (isCorsBlocked(e) || (e instanceof Error && e.message.includes('CORS'))) {
      if (origin && !(await hasHostAccess(origin))) {
        needHost.value = true;
        setMsg(t('ai_needHost'), true);
        showToast('danger', t('ai_needHostTitle'), origin);
      } else {
        setMsg(t('ai_corsBlocked'), true);
        showToast('danger', t('ai_corsBlockedTitle'), '');
      }
    } else {
      needHost.value = false;
      setMsg(describeError(e), true);
      showToast('danger', t('ai_testFailTitle'), '');
    }
  } finally {
    busy.value = '';
  }
}

/**
 * 申请 host 权限。
 *
 * ⚠ 必须由点击事件**直接**调用，且是 handler 第一句 —— 中间任何 await 都会消费掉
 * 用户手势，permissions.request() 随之失败（见 hostAccess.ts 文件头）。
 */
async function grantHost() {
  const origin = originOf(draft.baseUrl);
  if (!origin) {
    setMsg(t('ai_badUrl'), true);
    return;
  }
  const ok = await requestHostAccess(origin);
  needHost.value = !ok;
  setMsg(ok ? t('ai_hostGranted', origin) : t('ai_hostDenied'), !ok);
}

async function wipe() {
  await clearAi();
  list.value = [];
  activeId.value = '';
  keys.value = {};
  keyInput.value = '';
  keyRevealed.value = false;
  snapCfg = null;
  snapKey = '';
  setMsg(t('ai_cleared'));
  showToast('success', t('ai_clearedTitle'), '');
}
</script>

<style scoped>
.mono {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 13px;
}
.key-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}
.key-row .input {
  flex: 1;
}
.ai-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.hint {
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
  margin: 0;
}
.foot {
  margin: 8px 0 0;
  font-size: var(--fs-caption);
}
.hint-ok {
  color: var(--success-text);
}
select.input {
  cursor: pointer;
}

/* 列表行：整行可点切到该条，右侧垃圾桶删它 */
.provider-row {
  gap: 4px;
  padding-right: 8px;
}
.provider-row.active {
  background: var(--bg-inset);
}
.provider-main {
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
.provider-main .r-title {
  display: flex;
  align-items: center;
  gap: 6px;
}
.provider-main .r-desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.add-row {
  width: 100%;
  margin-top: 4px;
}
.preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
  margin-bottom: 4px;
}
.preset-btn {
  justify-content: center;
}
</style>
