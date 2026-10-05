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
            :aria-checked="cfg.enabled"
            role="switch"
            :aria-label="t('ai_enable')"
            @click="toggleEnabled"
          />
        </div>
      </div>
    </div>

    <template v-if="cfg.enabled">
      <!-- 服务商 -->
      <div class="grp">
        <div class="field">
          <label for="ai-provider">{{ t('ai_provider') }}</label>
          <select id="ai-provider" v-model="providerSel" class="input" @change="onProviderChange">
            <option v-for="p in providerList" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
        </div>

        <div class="field">
          <label for="ai-base">{{ t('ai_baseUrl') }}</label>
          <input
            id="ai-base"
            v-model="cfg.baseUrl"
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
            v-model="cfg.model"
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

        <p v-if="msg" class="foot" :class="msgBad ? 'hint-error' : 'hint-ok'">{{ msg }}</p>

        <!--
          CORS 被挡时的出口。按钮只在需要时出现，且 click handler 的第一句就是
          permissions.request() —— 中间插入任何 await 都会消费掉用户手势导致静默失败。
        -->
        <button v-if="needHost" class="btn btn-secondary" @click="grantHost">
          <Icon name="shield" />
          {{ t('ai_grantHost') }}
        </button>
      </div>

      <!-- 隐私边界：这一段是本功能最需要说清楚的事，不能折叠进 README -->
      <div class="grp">
        <div class="banner banner-info">
          <Icon name="shield" />
          <span>{{ t('ai_privacy') }}</span>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup>
/**
 * PaneAI.vue — AI 面板（BYOK 配置），挂在设置页，是设置页目前唯一的 pane。
 *
 * 只做配置，不跑归类 —— 理由：配置是低频的宽表单，popup 窄屏塞不下；
 * 而批量归类要看到结果再确认，将来放 popup 更顺手（`ai/classify.ts` 已就绪但
 * 尚未接 UI，接的时候应落在 popup 侧，不要加到这个面板里）。
 *
 * 关键约束（见 ai/provider.ts 与 ai/hostAccess.ts）：
 *   - API Key 只存 chrome.storage.local，不进同步存储（不漫游到其它设备）。
 *   - 默认零 host 权限；自建端点挡 CORS 时才在用户手势内申请。
 *   - 用户不点「保存」就不落盘，避免半填状态被当成有效配置。
 */
import { ref, reactive, computed, onMounted } from 'vue';
import { t } from '../lib/i18n.js';
import { showToast } from '../store.js';
import { describeError } from '../lib/errors.js';
import { PROVIDER_DEFAULTS, complete, isCorsBlocked } from '../ai/provider.js';
import {
  readAiConfig,
  writeAiConfig,
  readApiKey,
  writeApiKey,
  clearAi,
  switchProvider,
} from '../ai/config.js';
import { hasHostAccess, requestHostAccess, originOf } from '../ai/hostAccess.js';
import Icon from './ui/Icon.vue';

const PROVIDERS = Object.keys(PROVIDER_DEFAULTS);
const providerList = PROVIDERS.map((id) => ({ id, label: PROVIDER_DEFAULTS[id].label }));

const cfg = reactive({ provider: 'anthropic', baseUrl: '', model: '', enabled: false });
const keyInput = ref('');
const keyRevealed = ref(false);
const busy = ref(''); // '' | 'test' | 'save'
const msg = ref('');
const msgBad = ref(false);
const loaded = ref(false); // 配置是否已从存储载入（未载入前不显示，避免闪默认值）

const providerSel = computed({
  get: () => cfg.provider,
  set: (v) => {
    cfg.provider = v;
  },
});

const dirty = computed(
  () =>
    loaded.value &&
    (!loadedCfg || JSON.stringify(cfg) !== JSON.stringify(loadedCfg) || keyDirty.value),
);
const keyDirty = computed(() => keyInput.value !== loadedKey.value);
const canTest = computed(
  () => !!cfg.baseUrl.trim() && !!cfg.model.trim() && !!keyInput.value.trim(),
);
/** 测试报了 CORS 且尚未授权 → 露出「授权访问」按钮。 */
const needHost = ref(false);

let loadedCfg = null;
let loadedKey = '';

onMounted(async () => {
  const c = await readAiConfig();
  Object.assign(cfg, c);
  loadedCfg = { ...c };
  loadedKey = await readApiKey();
  keyInput.value = loadedKey;
  loaded.value = true;
});

function setMsg(text, bad = false) {
  msg.value = text;
  msgBad.value = bad;
}

async function persist() {
  await writeAiConfig({ ...cfg });
  loadedCfg = { ...cfg };
}

async function toggleEnabled() {
  cfg.enabled = !cfg.enabled;
  await persist();
}

async function onProviderChange(e) {
  const next = e.target.value;
  // 只有当前值还是默认值时才跟着换，否则保留用户手填的代理地址
  const merged = await switchProvider({ ...cfg, provider: cfg.provider }, next);
  Object.assign(cfg, merged);
  await persist();
  setMsg('');
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
  const origin = originOf(cfg.baseUrl);
  try {
    const res = await complete(
      { provider: cfg.provider, baseUrl: cfg.baseUrl, model: cfg.model },
      keyInput.value.trim(),
      { messages: [{ role: 'user', content: 'ping' }], maxTokens: 1 },
    );
    const usage = res.usage ? ` · ${res.usage.input}+${res.usage.output} tokens` : '';
    setMsg(t('ai_testOk', res.model ?? cfg.model, usage.replace(/^ · /, '')));
    showToast('success', t('ai_testOkTitle'), cfg.model);
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
  const origin = originOf(cfg.baseUrl);
  if (!origin) {
    setMsg(t('ai_badUrl'), true);
    return;
  }
  const ok = await requestHostAccess(origin);
  needHost.value = !ok;
  setMsg(ok ? t('ai_hostGranted', origin) : t('ai_hostDenied'), !ok);
}

async function save() {
  busy.value = 'save';
  try {
    await persist();
    await writeApiKey(keyInput.value);
    loadedKey = keyInput.value;
    needHost.value = false;
    setMsg(t('ai_saved'));
    showToast('success', t('ai_savedTitle'), '');
  } catch (e) {
    setMsg(describeError(e), true);
    showToast('danger', t('ai_saveFailTitle'), '');
  } finally {
    busy.value = '';
  }
}

async function wipe() {
  await clearAi();
  const c = await readAiConfig();
  Object.assign(cfg, c);
  loadedCfg = { ...c };
  loadedKey = '';
  keyInput.value = '';
  keyRevealed.value = false;
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
</style>
