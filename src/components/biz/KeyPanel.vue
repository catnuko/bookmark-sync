<template>
  <Alert variant="info">
    <ShieldCheck :stroke-width="1.75" />
    <span>{{ t('key_e2eBanner') }}</span>
  </Alert>

  <div class="flex flex-col">
    <div class="mb-1.5 text-caption font-semibold text-(--text-secondary-c)">
      {{ t('key_label') }}
    </div>
    <div v-if="state.passphraseStored" class="flex items-stretch gap-2">
      <Input
        :model-value="revealed ? state.passphraseStored : masked"
        readonly
        class="h-auto break-all py-2.5 font-mono text-caption"
        :aria-label="t('key_label')"
      />
      <Button
        variant="ghost"
        size="icon-sm"
        class="self-stretch"
        :title="t(revealed ? 'key_hide' : 'key_reveal')"
        :aria-label="t(revealed ? 'key_hide' : 'key_reveal')"
        :aria-pressed="revealed"
        @click="revealed = !revealed"
      >
        <EyeOff v-if="revealed" :stroke-width="1.75" />
        <Eye v-else :stroke-width="1.75" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        class="self-stretch"
        :title="t('key_copy')"
        :aria-label="t('key_copy')"
        @click="copyPhrase"
      >
        <Copy :stroke-width="1.75" />
      </Button>
    </div>
    <p class="mt-1.5 text-caption leading-(--text-caption--line-height) text-(--text-secondary-c)">
      {{ t('key_foot') }}
    </p>
  </div>
</template>

<script setup>
import { onMounted, ref, computed } from 'vue';
import { Copy, Eye, EyeOff, ShieldCheck } from '@lucide/vue';
import { state, loadKeyPanel, copyPhrase } from '../../store.js';
import { t } from '../../lib/i18n.js';
import Alert from '../ui/alert/Alert.vue';
import Button from '../ui/button/Button.vue';
import Input from '../ui/input/Input.vue';

onMounted(loadKeyPanel);

// 口令默认掩码显示：这个面板可能在他人可见的屏幕上被打开（屏幕共享 / 截图 / 旁边有人），
// 明文太容易被直接读走。点小眼睛才揭示；「复制」不受影响（复制的是真值）。
// 组件随抽屉 / 面板重建，故每次打开都回到隐藏态。
const revealed = ref(false);
const masked = computed(() => '*'.repeat(state.passphraseStored.length));
</script>
