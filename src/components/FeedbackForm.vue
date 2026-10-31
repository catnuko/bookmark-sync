<template>
  <div class="grp">
    <h4 v-if="!bare">{{ t('feedback_title') }}</h4>
    <p class="pane-sub">{{ t('feedback_sub') }}</p>
    <p class="feedback-thanks">{{ t('feedback_thanks') }}</p>

    <div class="field">
      <label>{{ t('feedback_kindLabel') }}</label>
      <SegTabs v-model="kind" :options="kindOptions" :aria-label="t('feedback_kindLabel')" />
    </div>

    <div class="field">
      <label for="fbBody">{{ t('feedback_bodyLabel') }}</label>
      <textarea
        id="fbBody"
        v-model="body"
        class="textarea"
        :class="{ 'is-error': result && !result.ok }"
        maxlength="2000"
        :placeholder="t('feedback_bodyPh')"
        :aria-label="t('feedback_bodyLabel')"
      ></textarea>
    </div>

    <div class="field">
      <label for="fbEmail">{{ t('feedback_emailLabel') }}</label>
      <input
        id="fbEmail"
        v-model="contactEmail"
        class="input"
        type="email"
        maxlength="200"
        :placeholder="t('feedback_emailPh')"
        :aria-label="t('feedback_emailLabel')"
      />
      <div class="fb-hint">{{ t('feedback_emailHint') }}</div>
    </div>

    <button class="btn btn-primary" :disabled="!body.trim() || busy" @click="submit">
      <span v-if="busy" class="spinner" />
      {{ busy ? t('feedback_submitting') : t('feedback_submit') }}
    </button>

    <div v-if="result" class="banner" :class="result.ok ? 'banner-success' : 'banner-danger'">
      <Icon :name="result.ok ? 'check-circle' : 'alert'" />
      <span>{{ result.ok ? t('feedback_okBody') : t(errKey) }}</span>
    </div>

    <p class="foot">{{ t('feedback_envNote') }}</p>
    <p class="foot">{{ t('feedback_privacyHint') }}</p>
    <p class="foot">
      <button
        type="button"
        class="link-btn"
        :title="t('common_opensInNewTab')"
        @click="openFeedbackIssues()"
      >
        {{ t('feedback_githubIssues') }}
        <Icon class="foot-ext" name="external-link" />
      </button>
    </p>
  </div>
</template>

<script setup>
// 反馈表单：自包含（本地 ref，不进 store）—— 没有跨组件共享需求，塞 store 只会膨胀 state。
// 提交是**用户主动行为**：失败必须可见，所以这里把 submitFeedback 的结果码翻成文案，
// 而不像 telemetry 那样静默。服务端见 supabase/migrations/0045_feedback.sql。
import { ref, computed } from 'vue';
import { t } from '../lib/i18n.js';
import { submitFeedback, openFeedbackIssues } from '../lib/feedback.js';
import SegTabs from './ui/SegTabs.vue';
import Icon from './ui/Icon.vue';

// bare：嵌在抽屉里时抽屉标题已显示「反馈」，隐藏自身的 h4，避免标题重复。
defineProps({ bare: { type: Boolean, default: false } });

const kind = ref('bug');
const body = ref('');
const contactEmail = ref('');
const busy = ref(false);
const result = ref(null);

const kindOptions = computed(() => [
  { value: 'bug', label: t('feedback_kindBug') },
  { value: 'idea', label: t('feedback_kindIdea') },
  { value: 'other', label: t('feedback_kindOther') },
]);

/** 服务端错误码 → i18n key（未知码回落到「网络失败」）。 */
const ERR_KEYS = {
  empty: 'feedback_errEmpty',
  invalid_email: 'feedback_errEmail',
  rate_limited: 'feedback_errRate',
  unauthenticated: 'feedback_errAuth',
  network: 'feedback_errNetwork',
};
const errKey = computed(() => ERR_KEYS[result.value?.error] ?? 'feedback_errNetwork');

async function submit() {
  if (busy.value || !body.value.trim()) return;
  busy.value = true;
  result.value = null;
  try {
    result.value = await submitFeedback({
      kind: kind.value,
      body: body.value,
      contactEmail: contactEmail.value.trim() || undefined,
    });
    if (result.value.ok) body.value = '';
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.feedback-thanks {
  margin: 0 0 10px;
  font-size: var(--fs-secondary);
  line-height: var(--lh-secondary);
  color: var(--text-secondary);
}
.fb-hint {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
}
.foot-ext {
  width: 1em;
  height: 1em;
  vertical-align: -0.12em;
}
</style>
