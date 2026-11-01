<template>
  <div class="flex h-full flex-col">
    <PopupChrome v-if="!embedded">
      <span
        class="grid size-[18px] flex-none place-items-center rounded-xs bg-primary text-[9px] font-bold text-primary-foreground"
        aria-hidden="true"
        >B</span
      >
      <span class="text-caption font-semibold">Bookmark Sync</span>
    </PopupChrome>

    <div class="scroll-y flex flex-col gap-3.5 px-4 py-3.5">
      <div class="flex flex-col items-center gap-1.5 pt-2.5 pb-0.5">
        <div
          class="mb-3 grid size-12 place-items-center rounded-lg bg-primary text-[22px] font-bold text-primary-foreground"
          aria-hidden="true"
        >
          B
        </div>
        <h1 class="text-title-lg font-semibold">{{ t('auth_h1') }}</h1>
        <p class="text-body-sm text-(--text-secondary-c)">{{ t('auth_sub') }}</p>
      </div>

      <SegTabs
        v-model="state.mode"
        :options="[
          { value: 'login', label: t('auth_login') },
          { value: 'register', label: t('auth_register') },
        ]"
        :aria-label="t('auth_tabsAria')"
      />

      <div>
        <Label for="email" class="mb-1.5 block">{{ t('auth_email') }}</Label>
        <Input
          id="email"
          v-model="state.email"
          type="email"
          :placeholder="t('auth_emailPh')"
          autocomplete="email"
          :aria-label="t('auth_email')"
        />
      </div>
      <div>
        <Label for="password" class="mb-1.5 block">{{ t('auth_password') }}</Label>
        <Input
          id="password"
          v-model="state.password"
          type="password"
          :placeholder="state.mode === 'login' ? t('auth_pwPhLogin') : t('auth_pwPhRegister')"
          autocomplete="current-password"
          :aria-label="t('auth_password')"
          @keyup.enter="submit"
        />
      </div>

      <Button id="authSubmit" size="xl" :disabled="state.busy" @click="submit">
        <LoaderCircle v-if="state.busy" class="animate-spin" :stroke-width="1.75" />
        {{ state.mode === 'login' ? t('auth_login') : t('auth_create') }}
      </Button>

      <Alert v-if="state.authSuccess" variant="success">
        <CircleCheck :stroke-width="1.75" />
        <span>{{ state.authSuccess }}</span>
      </Alert>
      <Alert v-if="state.authError" variant="destructive">
        <CircleAlert :stroke-width="1.75" />
        <span>{{ state.authError }}</span>
      </Alert>

      <div class="flex items-center justify-center gap-1.5 text-caption text-(--text-secondary-c)">
        {{ t('auth_hint') }}
      </div>

      <div
        class="mt-auto flex justify-center gap-1.5 border-t border-(--border-subtle) pt-3 text-caption text-tertiary"
      >
        <button
          type="button"
          class="hit-slop relative rounded-xs p-2 leading-4 transition-colors duration-100 hover:bg-scrim hover:text-foreground"
          @click="openHelp"
        >
          {{ t('auth_forgot') }}
        </button>
        <i class="h-3 w-px self-center bg-(--border-strong)"></i>
        <button
          type="button"
          class="hit-slop relative rounded-xs p-2 leading-4 transition-colors duration-100 hover:bg-scrim hover:text-foreground"
          @click="openHelp"
        >
          {{ t('common_help') }}
        </button>
        <i class="h-3 w-px self-center bg-(--border-strong)"></i>
        <!-- 未登录是硬门禁（App.vue 只渲染本组件），所以反馈入口只能放这儿 -->
        <a
          class="hit-slop relative no-underline rounded-xs p-2 leading-4 transition-colors duration-100 hover:bg-scrim hover:text-foreground"
          :href="mailtoHref"
        >
          {{ t('feedback_mailto') }}
        </a>
      </div>
    </div>
  </div>
</template>

<script setup>
import { CircleAlert, CircleCheck, LoaderCircle } from '@lucide/vue';
import { state, submit, openHelp } from '../store.js';
import { t } from '../lib/i18n.js';
import { buildMailto } from '../lib/feedback.js';
import Alert from './ui/alert/Alert.vue';
import Button from './ui/button/Button.vue';
import Input from './ui/input/Input.vue';
import Label from './ui/label/Label.vue';
import PopupChrome from './biz/PopupChrome.vue';
import SegTabs from './biz/SegTabs.vue';

// 登录页的反馈兜底：带版本/平台直接发邮件（用户可能正是因为登录不上才需要反馈）
const mailtoHref = buildMailto(t('feedback_title'), t('feedback_bodyPh'));

// embedded：options 设置页内嵌（居中 360px 列）时不渲染 popup 顶栏（规范 §5.1）
defineProps({ embedded: { type: Boolean, default: false } });
</script>
