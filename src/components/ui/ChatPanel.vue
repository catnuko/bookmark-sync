<template>
  <section class="chat">
    <!-- 消息区 -->
    <div ref="scroller" class="chat-scroll">
      <div v-if="messages.length === 0" class="chat-empty">
        <span class="empty-mark"><Icon name="chat" /></span>
        <p class="empty-title">{{ t('qa_emptyTitle') }}</p>
        <p class="empty-sub">{{ t('qa_emptySub') }}</p>
      </div>

      <div v-for="(m, i) in messages" :key="i" class="turn" :class="m.role">
        <div class="bubble" :class="{ 'is-error': m.error }">
          <span class="bubble-text">{{ m.text }}</span>
          <!-- 流式光标：只在「最后一条 + 助手 + 正在生成」时出现 -->
          <span
            v-if="streaming && i === messages.length - 1 && m.role === 'assistant'"
            class="caret"
          />
        </div>
        <p v-if="m.note" class="turn-note">{{ m.note }}</p>
      </div>
    </div>

    <!-- 前置条件未满足：把原因说清楚，而不是让输入框静默失败 -->
    <div v-if="gate" class="banner banner-warning chat-gate">
      <Icon name="alert" />
      <span>{{ gate }}</span>
    </div>

    <p v-else-if="searching" class="chat-status">
      <span class="spinner" />
      {{ t('qa_searching') }}
    </p>

    <!-- 输入区 -->
    <div class="chat-input">
      <textarea
        v-model="draft"
        class="textarea chat-ta"
        rows="2"
        :placeholder="t('qa_placeholder')"
        :disabled="streaming"
        @keydown.enter.exact.prevent="send"
      />
      <button
        v-if="!streaming"
        class="btn btn-primary chat-send"
        :disabled="!canSend"
        @click="send"
      >
        <Icon name="send" />
        {{ t('qa_send') }}
      </button>
      <button v-else class="btn chat-send" @click="stop">
        <Icon name="stop" />
        {{ t('qa_stop') }}
      </button>
    </div>

    <div class="chat-foot">
      <span class="foot-hint">{{ t('qa_footHint') }}</span>
      <button
        v-if="messages.length > 0"
        type="button"
        class="link-btn"
        :disabled="streaming"
        @click="clear"
      >
        {{ t('qa_clear') }}
      </button>
    </div>
  </section>
</template>

<script setup>
/**
 * ChatPanel.vue — 书签问答面板（自绘，不依赖任何 UI 框架）。
 *
 * ## 为什么是自绘
 *
 * 评估过 deep-chat / ai-elements-vue / @ai-sdk/vue 三条现成路线，都不划算：
 *   - deep-chat：shadow DOM 把 tokens.css 挡在外面，主题化只能写 JS 样式对象，
 *     工作量与自绘相当，却多背一个 378KB 黑盒；
 *   - ai-elements-vue：要引入 Tailwind + shadcn-vue + 157 个组件文件，且在本项目的
 *     Vite 配置下编译不过；
 *   - @ai-sdk/vue：headless，本身不含对话框，等于没省。
 * 这里只做了最必要的一件事：消息列表 + 输入框 + 流式追加。
 *
 * ## 数据流（每一步都在本机完成，只有候选子集离开浏览器）
 *
 *   用户提问 → 本地关键词检索出 top-N 候选（ai/qa.ts）→ 只把候选拼进 prompt
 *   → streamComplete() 逐块返回 → 追加到最后一条助手消息上
 *
 * ## 单轮 vs 多轮
 *
 * 历史只回放**原始提问文本**，不回放拼好的 prompt —— 每轮都重新检索并附上最新的
 * 候选列表。这样多轮追问时的代词（「那它的地址呢」）能靠历史解析，而引用编号始终
 * 以**当前这条消息**里的列表为准，不会因为跨轮复用而过期。
 */

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { t } from '../../lib/i18n.js';
import { describeError } from '../../lib/errors.js';
import { api } from '../../lib/ext.js';
import { showToast } from '../../store.js';
import { streamComplete } from '../../ai/provider.js';
import { readAiConfig, readApiKey } from '../../ai/config.js';
import { QA_SYSTEM_PROMPT, buildQaPrompt, flattenBookmarks, searchBookmarks } from '../../ai/qa.js';
import Icon from './Icon.vue';

const MAX_QUESTION_CHARS = 500;
/** 回放的历史轮数上限（一问一答算两轮）。再多只增成本，收益很小。 */
const HISTORY_TURNS = 4;

const messages = ref([]);
const draft = ref('');
const streaming = ref(false);
const searching = ref(false);
const gate = ref('');

const scroller = ref(null);
let controller = null;

const canSend = computed(() => draft.value.trim().length > 0 && !streaming.value && !gate.value);

/** 算上前面几轮的原始提问，用于多轮追问时的检索召回。 */
function recentQuestions() {
  return messages.value
    .filter((m) => m.role === 'user')
    .slice(-HISTORY_TURNS)
    .map((m) => m.raw ?? m.text);
}

async function send() {
  const question = draft.value.trim().slice(0, MAX_QUESTION_CHARS);
  if (!question || streaming.value) return;

  draft.value = '';
  messages.value.push({ role: 'user', text: question, raw: question });

  // 配置/密钥每次现读：用户可能刚在「AI 设置」里改完就切过来提问
  const [cfg, key] = await Promise.all([readAiConfig(), readApiKey()]);
  if (!cfg.enabled || !key) {
    messages.value.push({
      role: 'assistant',
      text: cfg.enabled ? t('qa_gateNoKey') : t('qa_gateDisabled'),
      error: true,
    });
    return;
  }

  // 本地检索：这一步不发任何网络请求
  searching.value = true;
  let all = [];
  let candidates = [];
  try {
    const tree = await api.bookmarks.getTree();
    all = flattenBookmarks(tree);
    candidates = searchBookmarks(tree, question);
    // 追问（「那它的地址是？」）自身关键词很弱 → 拼上上一轮提问再试一次
    if (candidates.length === 0) {
      const prev = recentQuestions().slice(0, -1).at(-1);
      if (prev) candidates = searchBookmarks(tree, `${prev} ${question}`);
    }
  } catch (e) {
    messages.value.push({ role: 'assistant', text: describeError(e), error: true });
    searching.value = false;
    return;
  }
  searching.value = false;

  const note =
    candidates.length > 0
      ? t('qa_note', String(all.length), String(candidates.length))
      : t('qa_noteNone', String(all.length));

  const reply = { role: 'assistant', text: '', note };
  messages.value.push(reply);
  const idx = messages.value.length - 1;

  // 历史只回放原文，不回放拼好的 prompt（见文件头「单轮 vs 多轮」）
  const history = messages.value
    .slice(0, idx)
    .filter((m) => !m.error && m.text.trim())
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.role === 'user' ? (m.raw ?? m.text) : m.text }));

  controller = new AbortController();
  streaming.value = true;
  try {
    const stream = streamComplete({ ...cfg }, key, {
      system: QA_SYSTEM_PROMPT,
      messages: [...history, { role: 'user', content: buildQaPrompt(question, candidates) }],
      maxTokens: 1024,
      temperature: 0.2,
      signal: controller.signal,
    });
    for await (const chunk of stream) {
      messages.value[idx].text += chunk;
    }
    if (!messages.value[idx].text.trim()) {
      messages.value[idx].text = t('qa_emptyReply');
      messages.value[idx].error = true;
    }
  } catch (e) {
    // 用户点「停止」不是错误：保留已生成的部分，不弹红字
    if (controller?.signal.aborted) {
      if (!messages.value[idx].text.trim()) messages.value.splice(idx, 1);
    } else {
      const partial = messages.value[idx].text.trim();
      messages.value[idx].text = partial ? `${partial}\n\n${describeError(e)}` : describeError(e);
      messages.value[idx].error = true;
      showToast('danger', t('qa_errorTitle'), '');
    }
  } finally {
    streaming.value = false;
    controller = null;
  }
}

function stop() {
  controller?.abort();
}

function clear() {
  if (streaming.value) return;
  messages.value = [];
}

/** 内容或高度变化后贴到底部 —— 流式追加时不跟随的话，用户得手动往下拖。 */
function scrollToEnd() {
  const el = scroller.value;
  if (el) el.scrollTop = el.scrollHeight;
}

watch(
  () => [messages.value.length, messages.value.at(-1)?.text],
  () => void nextTick(scrollToEnd),
);

onMounted(async () => {
  const cfg = await readAiConfig();
  if (!cfg.enabled) gate.value = t('qa_gateDisabled');
  else if (!(await readApiKey())) gate.value = t('qa_gateNoKey');
});

// 离开页面（切 pane / 关标签）时掐断在途请求，别让它在后台继续烧 token
onBeforeUnmount(() => controller?.abort());
</script>

<style scoped>
/* tokens.css 里没有 chat 相关原语，气泡与滚动区只在本组件内定义，不污染全局 */
.chat {
  display: flex;
  flex-direction: column;
  /* 设置页是整页滚动，这里给个上限让消息区自己滚，避免整页跟着长 */
  height: min(620px, calc(100vh - 260px));
  min-height: 360px;
}
.chat-scroll {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 2px 12px;
}
.chat-empty {
  margin: auto;
  text-align: center;
  color: var(--text-tertiary);
  max-width: 320px;
}
.chat-empty .empty-mark {
  display: inline-flex;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  background: var(--bg-inset);
  color: var(--text-secondary);
  margin-bottom: 10px;
}
.chat-empty .empty-mark svg {
  width: 22px;
  height: 22px;
}
.empty-title {
  font-size: var(--fs-secondary);
  font-weight: var(--fw-medium);
  color: var(--text-primary);
  margin-bottom: 4px;
}
.empty-sub {
  font-size: var(--fs-caption);
  line-height: var(--lh-caption);
}

.turn {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 88%;
}
.turn.user {
  align-self: flex-end;
  align-items: flex-end;
}
.turn.assistant {
  align-self: flex-start;
}
.bubble {
  padding: 9px 12px;
  border-radius: var(--radius-md);
  font-size: var(--fs-secondary);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--bg-elevated);
  color: var(--text-primary);
}
.turn.user .bubble {
  background: var(--brand);
  color: var(--brand-foreground);
}
.bubble.is-error {
  background: var(--danger-tint);
  color: var(--danger-text);
}
.turn-note {
  font-size: var(--fs-badge);
  color: var(--text-quaternary);
  padding: 0 2px;
}
.caret {
  display: inline-block;
  width: 7px;
  height: 14px;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: currentColor;
  opacity: 0.55;
  animation: caretBlink 1s steps(2, start) infinite;
}
@keyframes caretBlink {
  50% {
    opacity: 0;
  }
}

.chat-gate {
  margin-top: 4px;
}
.chat-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: var(--fs-caption);
  color: var(--text-secondary);
}
.chat-input {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  margin-top: 8px;
}
.chat-ta {
  flex: 1;
  min-height: 56px;
  resize: none;
  font-family: inherit;
}
.chat-send {
  flex: none;
  height: 40px;
}
.chat-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
}
.foot-hint {
  font-size: var(--fs-badge);
  color: var(--text-quaternary);
}
</style>
