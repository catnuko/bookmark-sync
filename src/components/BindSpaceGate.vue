<template>
  <div class="flex max-h-screen min-h-screen flex-col overflow-y-auto p-6">
    <div class="m-auto w-full max-w-[420px]" data-test="bind-gate">
      <div
        class="mx-auto mb-3.5 grid size-12 place-items-center rounded-full bg-info-tint text-info-text"
      >
        <Bookmark class="size-6" :stroke-width="1.75" />
      </div>
      <h2 class="text-center text-title-lg font-semibold" data-test="bind-title">
        {{ t('bind_title') }}
      </h2>
      <p
        class="mt-2 text-center text-body-sm leading-(--text-body-sm--line-height) text-(--text-secondary-c)"
        data-test="bind-sub"
      >
        {{ t('bind_body', state.bindLocalCount) }}
      </p>

      <!-- 选空间：单选，必选。点即选。 -->
      <RadioGroupRoot
        class="mt-4.5 flex flex-col gap-1.5"
        :aria-label="t('bind_title')"
        :model-value="spaceModel"
        :disabled="state.bindBusy"
        @update:model-value="onSpacePick"
      >
        <label
          v-for="s in state.bindSpaces"
          :key="s.id"
          class="flex cursor-pointer items-center gap-2.5 rounded-md border p-2.5 px-3 transition-colors duration-100 hover:bg-scrim"
          :class="spaceOptCls(!state.bindCreating && state.bindTarget === s.id)"
        >
          <RadioGroupItem :value="s.id" :data-value="s.id" />
          <span class="flex items-center gap-1.5 text-body font-medium [overflow-wrap:anywhere]">
            {{ s.name }}
            <Badge v-if="s.is_default" variant="secondary">{{ t('spaceslist_default') }}</Badge>
          </span>
        </label>

        <!-- 新建入口只在账号还能新建空间时给（免费档上限 1 个）：一个点下去必然
             撞 plan_locked、只能弹升级的选项，不如不给。 -->
        <template v-if="state.canCreateSpace">
          <div v-if="state.bindCreating" class="flex items-center gap-2">
            <Input
              v-model="state.bindNewName"
              class="min-w-0 flex-1"
              :placeholder="t('spaceslist_newPh')"
              maxlength="50"
              :aria-label="t('spaceslist_newPh')"
              :disabled="state.bindBusy"
              data-test="bind-new-input"
              @keyup.enter="doBindSpace"
            />
            <Button variant="ghost" size="sm" :disabled="state.bindBusy" @click="cancelCreate">
              {{ t('common_cancel') }}
            </Button>
          </div>
          <label
            v-else
            class="flex cursor-pointer items-center gap-2.5 rounded-md border p-2.5 px-3 transition-colors duration-100 hover:bg-scrim"
            :class="spaceOptCls(state.bindCreating)"
          >
            <RadioGroupItem value="__new__" data-value="__new__" />
            <span class="text-body font-medium">{{ t('bind_new') }}</span>
          </label>
        </template>
      </RadioGroupRoot>

      <!-- 本机书签的去向：并入（默认）或覆盖。本机没有书签时两者无区别，不展示。 -->
      <div v-if="state.bindLocalCount > 0" class="mt-4.5 flex flex-col gap-1.5">
        <div class="text-caption font-medium text-(--text-secondary-c)">
          {{ t('bind_modeLabel') }}
        </div>
        <RadioGroupRoot
          v-model="state.bindMode"
          :disabled="state.bindBusy"
          class="flex flex-col gap-1.5"
        >
          <label
            class="flex cursor-pointer items-center gap-2.5 rounded-md border p-2.5 px-3 transition-colors duration-100 hover:bg-scrim"
            :class="spaceOptCls(state.bindMode === 'merge')"
          >
            <RadioGroupItem value="merge" />
            <span class="min-w-0 flex-1">
              <span class="block text-body font-medium">{{ t('bind_merge') }}</span>
              <span
                class="block text-body-sm leading-(--text-body-sm--line-height) text-(--text-secondary-c)"
                >{{ t('bind_mergeSub', state.bindLocalCount) }}</span
              >
            </span>
          </label>
          <label
            class="flex cursor-pointer items-center gap-2.5 rounded-md border p-2.5 px-3 transition-colors duration-100 hover:bg-scrim"
            :class="spaceOptCls(state.bindMode === 'overwrite')"
          >
            <RadioGroupItem value="overwrite" />
            <span class="min-w-0 flex-1">
              <span class="block text-body font-medium text-destructive-text">
                {{ t('bind_overwrite') }}
              </span>
              <span
                class="block text-body-sm leading-(--text-body-sm--line-height) text-(--text-secondary-c)"
                >{{ t('bind_overwriteSub', state.bindLocalCount) }}</span
              >
            </span>
          </label>
        </RadioGroupRoot>
      </div>

      <div class="mt-4.5 flex">
        <ArmedButton
          v-if="state.bindMode === 'overwrite'"
          class="h-10 flex-1"
          data-test="bind-cta"
          :label="t('bind_ctaOverwrite')"
          :confirm-label="t('bind_ctaOverwriteConfirm')"
          :armed="armed"
          :countdown="armed ? countdown : 0"
          :disabled="!canBind || state.bindBusy"
          @press="press"
        />
        <Button
          v-else
          class="h-10 flex-1"
          data-test="bind-cta"
          :disabled="!canBind || state.bindBusy"
          @click="doBindSpace"
        >
          {{
            state.bindBusy ? t('bind_busy') : state.bindCreating ? t('bind_ctaNew') : t('bind_cta')
          }}
        </Button>
      </div>
      <p
        class="mt-2.5 text-center text-caption leading-(--text-caption--line-height) text-tertiary"
        data-test="bind-hint"
      >
        {{ t('bind_required') }}
      </p>
    </div>
  </div>
</template>

<script setup>
import { computed, onUnmounted, ref } from 'vue';
import { Bookmark } from '@lucide/vue';
import { RadioGroupRoot, RadioGroupItem } from 'reka-ui';
import { state, doBindSpace } from '../store.js';
import { t } from '../lib/i18n.js';
import ArmedButton from './biz/ArmedButton.vue';
import Badge from './ui/badge/Badge.vue';
import Button from './ui/button/Button.vue';
import Input from './ui/input/Input.vue';

// 首绑门禁（**整页，不可关闭**）：本机从未绑定过、且**有真选择**时，登录取数后
// 就挡住主界面，直到用户决定这台电脑加入哪个空间。
//
// 「有真选择」= 云端有 ≥2 个空间，或账号还能新建空间（付费档）——两种情况都值得
// 问：前者加入哪个都说得通，后者「给这台电脑单开一个」是合理诉求，而且这里是唯一
// 一次能「新建 + 绑定」的时机（之后新建完还得换绑，换绑要清空本机书签）。
//
// 为什么不是弹窗：选择是**必须**的。能关掉的弹窗等于让人卡在「有插件、没同步」
// 的半残状态里，而用户还以为自己关掉的只是一句提示。必选的决定要用页面呈现。
// 全新账号（0 个空间）会自动建「默认空间」，免费档在新设备上只有一个旧空间可加入，
// 这两种都没有可选项，看不见这一页。

const armed = ref(false);
const countdown = ref(3);
let timer = null;

const canBind = computed(() =>
  state.bindCreating ? !!state.bindNewName.trim() : !!state.bindTarget,
);

// reka RadioGroup 的受控值：新建入口是唯一「选中态在 store 之外」的选项
// （bindCreating = true 时不选任何空间），映射成哨兵值 __new__。
const spaceModel = computed(() => (state.bindCreating ? '__new__' : state.bindTarget));

function onSpacePick(value) {
  if (value === '__new__') {
    startCreate();
    return;
  }
  const s = state.bindSpaces.find((x) => x.id === value);
  if (s) pickSpace(s);
}

// 选中卡片：info 边框 + scrim 底（旧 .bg-opt.on，规范 §5.3）
function spaceOptCls(on) {
  return on ? 'border-info bg-scrim' : '';
}

function pickSpace(s) {
  state.bindCreating = false;
  state.bindTarget = s.id;
}

function startCreate() {
  state.bindCreating = true;
  state.bindTarget = '';
  state.bindNewName = '';
}

function cancelCreate() {
  state.bindCreating = false;
  state.bindTarget =
    state.bindSpaces.find((s) => s.is_default)?.id ?? state.bindSpaces[0]?.id ?? '';
}

function resetArm() {
  armed.value = false;
  clearInterval(timer);
  timer = null;
}

// 「覆盖本机」会删掉本机书签，按危险操作走两步确认（与其它危险入口一致）。
function press() {
  if (!armed.value) {
    armed.value = true;
    countdown.value = 3;
    clearInterval(timer);
    timer = setInterval(() => {
      countdown.value -= 1;
      if (countdown.value <= 0) resetArm();
    }, 1000);
    return;
  }
  resetArm();
  doBindSpace();
}

onUnmounted(resetArm);
</script>
