<template>
  <div>
    <h4 v-if="!bare" class="mb-2 ml-3.5 text-caption font-semibold tracking-[0.06em] text-(--text-secondary-c) uppercase">
      {{ t('feedback_title') }}
    </h4>
    <p class="mb-2.5 text-body-sm leading-(--text-body-sm--line-height) text-(--text-secondary-c)">
      {{ t('feedback_sub') }}
    </p>
    <p class="mb-2.5 text-body-sm leading-(--text-body-sm--line-height) text-(--text-secondary-c)">
      {{ t('feedback_thanks') }}
    </p>

    <div class="mb-3.5">
      <Label class="mb-1.5 block">{{ t('feedback_kindLabel') }}</Label>
      <SegTabs v-model="kind" :options="kindOptions" :aria-label="t('feedback_kindLabel')" />
    </div>

    <div class="mb-3.5">
      <Label for="fbBody" class="mb-1.5 block">{{ t('feedback_bodyLabel') }}</Label>
      <Textarea
        id="fbBody"
        v-model="body"
        :aria-invalid="result && !result.ok ? 'true' : undefined"
        maxlength="2000"
        :placeholder="t('feedback_bodyPh')"
        :aria-label="t('feedback_bodyLabel')"
      />
    </div>

    <div class="mb-3.5">
      <Label for="fbEmail" class="mb-1.5 block">{{ t('feedback_emailLabel') }}</Label>
      <Input
        id="fbEmail"
        v-model="contactEmail"
        type="email"
        maxlength="200"
        :placeholder="t('feedback_emailPh')"
        :aria-label="t('feedback_emailLabel')"
      />
      <div class="mt-1 text-caption text-(--text-secondary-c)">{{ t('feedback_emailHint') }}</div>
    </div>

    <Button :disabled="!body.trim() || busy" @click="submit">
      <LoaderCircle v-if="busy" class="animate-spin" :stroke-width="1.75" />
      {{ busy ? t('feedback_submitting') : t('feedback_submit') }}
    </Button>

    <Alert v-if="result" :variant="result.ok ? 'success' : 'destructive'" class="mt-3">
      <CircleCheck v-if="result.ok" :stroke-width="1.75" />
      <CircleAlert v-else :stroke-width="1.75" />
      <span>{{ result.ok ? t('feedback_okBody') : t(errKey) }}</span>
    </Alert>

    <p class="mt-1.5 text-caption leading-(--text-caption--line-height) text-(--text-secondary-c)">
      {{ t('feedback_envNote') }}
    </p>
    <p class="mt-1.5 text-caption leading-(--text-caption--line-height) text-(--text-secondary-c)">
      {{ t('feedback_privacyHint') }}
    </p>
    <p class="mt-1.5 text-caption leading-(--text-caption--line-height) text-(--text-secondary-c)">
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-xs text-caption text-(--text-secondary-c) hover:text-foreground"
        :title="t('common_opensInNewTab')"
        @click="openFeedbackIssues()"
      >
        {{ t('feedback_githubIssues') }}
        <ExternalLink class="size-3.5 self-center" :stroke-width="1.75" />
      </button>
    </p>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { CircleCheck, CircleAlert, ExternalLink, LoaderCircle } from '@lucide/vue';
import { t } from '../../lib/i18n.js';
import { submitFeedback, openFeedbackIssues } from '../../lib/feedback.js';
import Alert from '../ui/alert/Alert.vue';
import Button from '../ui/button/Button.vue';
import Input from '../ui/input/Input.vue';
import Label from '../ui/label/Label.vue';
import SegTabs from './SegTabs.vue';
import Textarea from '../ui/textarea/Textarea.vue';

// 反馈表单：自包含（本地 ref，不进 store）—— 没有跨组件共享需求，塞 store 只会膨胀 state。
// 提交是**用户主动行为**：失败必须可见，所以这里把 submitFeedback 的结果码翻成文案，
// 而不像 telemetry 那样静默。服务端见 supabase/migrations/0045_feedback.sql。

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
