<template>
  <div class="bg-wrap">
    <div class="bg-card">
      <div class="bg-ico"><Icon name="bookmark" /></div>
      <h2 class="bg-title">{{ t("bind_title") }}</h2>
      <p class="bg-sub">{{ t("bind_body", state.bindLocalCount) }}</p>

      <!-- 选空间：单选，必选。点即选。 -->
      <div class="bg-group" role="radiogroup" :aria-label="t('bind_title')">
        <label
          v-for="s in state.bindSpaces"
          :key="s.id"
          class="bg-opt"
          :class="{ on: !state.bindCreating && state.bindTarget === s.id }"
        >
          <input
            type="radio"
            name="bg-space"
            :value="s.id"
            :checked="!state.bindCreating && state.bindTarget === s.id"
            :disabled="state.bindBusy"
            @change="pickSpace(s)"
          />
          <span class="r-main">
            <span class="r-title">
              {{ s.name }}
              <span v-if="s.is_default" class="badge badge-neutral badge-sub">{{ t("spaceslist_default") }}</span>
            </span>
          </span>
        </label>

        <!-- 新建入口只在账号还能新建空间时给（免费档上限 1 个）：一个点下去必然
             撞 plan_locked、只能弹升级的选项，不如不给。 -->
        <template v-if="state.canCreateSpace">
          <div v-if="state.bindCreating" class="bg-new">
            <input
              v-model="state.bindNewName"
              class="input"
              :placeholder="t('spaceslist_newPh')"
              maxlength="50"
              :aria-label="t('spaceslist_newPh')"
              :disabled="state.bindBusy"
              @keyup.enter="doBindSpace"
            />
            <button class="btn btn-ghost btn-sm" :disabled="state.bindBusy" @click="cancelCreate">
              {{ t("common_cancel") }}
            </button>
          </div>
          <label v-else class="bg-opt" :class="{ on: state.bindCreating }">
            <input
              type="radio"
              name="bg-space"
              value="__new__"
              :checked="state.bindCreating"
              :disabled="state.bindBusy"
              @change="startCreate"
            />
            <span class="r-main">
              <span class="r-title">{{ t("bind_new") }}</span>
            </span>
          </label>
        </template>
      </div>

      <!-- 本机书签的去向：并入（默认）或覆盖。本机没有书签时两者无区别，不展示。 -->
      <div v-if="state.bindLocalCount > 0" class="bg-group">
        <div class="bg-label">{{ t("bind_modeLabel") }}</div>
        <label class="bg-opt" :class="{ on: state.bindMode === 'merge' }">
          <input v-model="state.bindMode" type="radio" value="merge" :disabled="state.bindBusy" />
          <span class="r-main">
            <span class="r-title">{{ t("bind_merge") }}</span>
            <span class="r-sub">{{ t("bind_mergeSub", state.bindLocalCount) }}</span>
          </span>
        </label>
        <label class="bg-opt" :class="{ on: state.bindMode === 'overwrite' }">
          <input v-model="state.bindMode" type="radio" value="overwrite" :disabled="state.bindBusy" />
          <span class="r-main">
            <span class="r-title danger">{{ t("bind_overwrite") }}</span>
            <span class="r-sub">{{ t("bind_overwriteSub", state.bindLocalCount) }}</span>
          </span>
        </label>
      </div>

      <div class="bg-actions">
        <ArmedButton
          v-if="state.bindMode === 'overwrite'"
          :label="t('bind_ctaOverwrite')"
          :confirm-label="t('bind_ctaOverwriteConfirm')"
          :armed="armed"
          :countdown="armed ? countdown : 0"
          :disabled="!canBind || state.bindBusy"
          @press="press"
        />
        <button
          v-else
          class="btn btn-primary"
          :disabled="!canBind || state.bindBusy"
          @click="doBindSpace"
        >
          {{ state.bindBusy ? t("bind_busy") : state.bindCreating ? t("bind_ctaNew") : t("bind_cta") }}
        </button>
      </div>
      <p class="bg-hint">{{ t("bind_required") }}</p>
    </div>
  </div>
</template>

<script setup>
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
import { computed, onUnmounted, ref } from "vue";
import { state, doBindSpace } from "../store.js";
import { t } from "../lib/i18n.js";
import ArmedButton from "./ui/ArmedButton.vue";
import Icon from "./ui/Icon.vue";

const armed = ref(false);
const countdown = ref(3);
let timer = null;

const canBind = computed(() =>
  state.bindCreating ? !!state.bindNewName.trim() : !!state.bindTarget,
);

function pickSpace(s) {
  state.bindCreating = false;
  state.bindTarget = s.id;
}

function startCreate() {
  state.bindCreating = true;
  state.bindTarget = "";
  state.bindNewName = "";
}

function cancelCreate() {
  state.bindCreating = false;
  state.bindTarget =
    state.bindSpaces.find((s) => s.is_default)?.id ?? state.bindSpaces[0]?.id ?? "";
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

<style scoped>
/* 整页门禁：列方向 + margin:auto 居中——行方向配 align-items:center 时，内容
   超过一屏会被裁掉顶部；列方向 + auto margin 溢出时正常滚动。 */
.bg-wrap {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  max-height: 100vh;
  overflow-y: auto;
  box-sizing: border-box;
  padding: 24px;
}
.bg-card { margin: auto; width: 100%; max-width: 420px; }
.bg-ico {
  width: 48px; height: 48px; margin: 0 auto 14px;
  border-radius: 50%; display: grid; place-items: center;
  background: var(--info-tint); color: var(--info-text);
}
.bg-title { font-size: var(--fs-title-lg); font-weight: var(--fw-semibold); text-align: center; }
.bg-sub {
  margin-top: 8px; font-size: var(--fs-secondary); line-height: var(--lh-secondary);
  color: var(--text-secondary); text-align: center;
}

.bg-group { display: flex; flex-direction: column; gap: 6px; margin-top: 18px; }
.bg-label { font-size: var(--fs-caption); font-weight: var(--fw-medium); color: var(--text-secondary); }
.bg-opt {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color var(--dur-instant), background var(--dur-instant);
}
.bg-opt:hover { background: var(--bg-scrim); }
.bg-opt.on { border-color: var(--accent); background: var(--bg-scrim); }
.bg-opt input { flex: none; margin: 0; }
.bg-opt .r-title { font-size: var(--fs-body); font-weight: var(--fw-medium); }
.bg-new { display: flex; align-items: center; gap: 8px; }
.bg-new .input { flex: 1; min-width: 0; }

.bg-actions { display: flex; margin-top: 18px; }
.bg-actions .btn { flex: 1; height: 40px; }
.bg-hint {
  margin-top: 10px; font-size: var(--fs-caption); line-height: var(--lh-caption);
  color: var(--text-tertiary); text-align: center;
}
.danger { color: var(--danger-text); }
</style>
