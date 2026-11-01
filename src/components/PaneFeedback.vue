<template>
  <section class="max-w-[620px]">
    <h2 v-if="!bare" class="text-[22px] font-semibold tracking-[-0.02em]">
      {{ t('feedback_title') }}
    </h2>

    <ListGroup v-if="!showForm" :class="bare ? '' : 'mt-[22px]'">
      <ListRow as="button" clickable data-test="feedback-github" @click="openFeedbackIssues()">
        <template #leading>
          <CodeXml :stroke-width="1.75" />
        </template>
        <div class="text-body font-medium">{{ t('feedback_menuGithub') }}</div>
        <template #tail>
          <ExternalLink class="size-4 text-quaternary" :stroke-width="1.75" />
        </template>
      </ListRow>
      <ListRow as="button" clickable data-test="feedback-email" @click="showForm = true">
        <template #leading>
          <Mail :stroke-width="1.75" />
        </template>
        <div class="text-body font-medium">{{ t('feedback_menuEmail') }}</div>
        <template #tail>
          <ChevronRight class="size-4 text-quaternary" :stroke-width="1.75" />
        </template>
      </ListRow>
    </ListGroup>

    <FeedbackForm v-else :bare="true" />
  </section>
</template>

<script setup>
import { ref } from 'vue';
import { ChevronRight, CodeXml, ExternalLink, Mail } from '@lucide/vue';
import { t } from '../lib/i18n.js';
import { openFeedbackIssues } from '../lib/feedback.js';
import FeedbackForm from './biz/FeedbackForm.vue';
import ListGroup from './biz/ListGroup.vue';
import ListRow from './biz/ListRow.vue';

// 「反馈」面板：先出两级菜单（GitHub 外链 / 邮件表单），popup 抽屉与设置页共用。
// bare：嵌在抽屉里时抽屉标题已显示「反馈」，隐藏自身的 h2，避免标题重复。
defineProps({ bare: { type: Boolean, default: false } });

const showForm = ref(false);
</script>
