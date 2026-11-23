<template>
  <Dialog v-model:open="dialogOpen">
    <DialogContent data-test="delete-account-modal">
      <DialogIcon kind="danger">
        <CircleAlert class="size-[22px]" :stroke-width="1.75" />
      </DialogIcon>
      <DialogTitle class="text-center text-title-lg font-semibold tracking-[-0.02em]">
        {{ t('delacct_title') }}
      </DialogTitle>
      <DialogDescription as-child>
        <ul class="mt-3 space-y-2 text-left">
          <li
            v-for="line in warningLines"
            :key="line"
            class="flex items-start gap-2 text-body-sm leading-(--text-body-sm--line-height)"
          >
            <CircleAlert
              class="mt-0.5 size-4 flex-none text-destructive-text"
              :stroke-width="1.75"
            />
            <span>{{ line }}</span>
          </li>
        </ul>
      </DialogDescription>

      <div class="mt-4 flex gap-2">
        <Button
          variant="ghost"
          class="flex-1 border border-(--border-strong)"
          :disabled="busy"
          @click="dialogOpen = false"
        >
          {{ t('delacct_cancel') }}
        </Button>
        <Button variant="destructive" class="flex-1" :disabled="busy" @click="confirm">
          {{ busy ? t('delacct_busy') : t('delacct_confirm') }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup>
// 注销账户二次确认弹窗（ALNA-248）：文案三条硬要求——不可恢复 / 删除云端全部同步数据
// （空间 / 操作日志 / 快照 / 设备登记 / 个人资料）/ 浏览器本地书签不受影响。
// 确认后调 store.deleteAccount()；成功由它登出本地会话并 toast，失败 toast 报错且弹窗保持打开。
import { ref, computed } from 'vue';
import { CircleAlert } from '@lucide/vue';
import { DialogContent, DialogDescription, DialogTitle } from 'reka-ui';
import { deleteAccount } from '../store.js';
import { t } from '../lib/i18n.js';
import Dialog from './ui/dialog/Dialog.vue';
import Button from './ui/button/Button.vue';
import DialogIcon from './biz/DialogIcon.vue';

const dialogOpen = defineModel('open', { default: false });

const busy = ref(false);

const warningLines = computed(() => [t('delacct_body1'), t('delacct_body2'), t('delacct_body3')]);

async function confirm() {
  busy.value = true;
  try {
    await deleteAccount();
    dialogOpen.value = false; // 账户已删：store 内已清会话并弹成功 toast
  } catch {
    // 失败提示由 store.deleteAccount 内的 danger toast 负责；弹窗保持打开，可重试或放弃
  } finally {
    busy.value = false;
  }
}
</script>
