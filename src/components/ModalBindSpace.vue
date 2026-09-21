<template>
  <div class="overlay" @click.self="dismissBindModal">
    <div class="modal">
      <div class="m-ico info"><Icon name="bookmark" /></div>
      <div class="m-title">{{ t("bind_title") }}</div>
      <p class="m-body">{{ t("bind_body", state.bindLocalCount) }}</p>

      <!-- 空间列表：点选即目标 -->
      <div class="m-stack bind-list">
        <button
          v-for="s in state.bindSpaces"
          :key="s.id"
          type="button"
          class="bind-opt"
          :class="{ on: !state.bindCreating && state.bindTarget === s.id }"
          :disabled="state.bindBusy"
          @click="pickSpace(s)"
        >
          <span class="dot" :class="{ 'dot-current': !state.bindCreating && state.bindTarget === s.id }"></span>
          <span class="r-main">
            <span class="r-title">{{ s.name }}</span>
          </span>
          <span v-if="s.is_default" class="badge badge-neutral badge-sub">{{ t("spaceslist_default") }}</span>
          <Icon v-if="!state.bindCreating && state.bindTarget === s.id" name="check" />
        </button>

        <template v-if="state.bindCreating">
          <div class="inset-row">
            <input
              v-model="state.bindNewName"
              class="input"
              :placeholder="t('spaceslist_newPh')"
              maxlength="50"
              :aria-label="t('spaceslist_newPh')"
              @keyup.enter="doBindSpace"
            />
            <button class="btn btn-ghost btn-sm" :disabled="state.bindBusy" @click="cancelCreate">
              {{ t("common_cancel") }}
            </button>
          </div>
        </template>
        <button v-else type="button" class="bind-opt" :disabled="state.bindBusy" @click="startCreate">
          <span class="lede"><Icon name="plus" /></span>
          <span class="r-main"><span class="r-title">{{ t("bind_new") }}</span></span>
        </button>
      </div>

      <!-- 本机书签的去向：并入（默认）或覆盖。本机没有书签时两者无区别，不展示。 -->
      <div v-if="state.bindLocalCount > 0" class="bind-mode">
        <label class="bind-mode-opt" :class="{ on: state.bindMode === 'merge' }">
          <input v-model="state.bindMode" type="radio" value="merge" :disabled="state.bindBusy" />
          <span class="r-main">
            <span class="r-title">{{ t("bind_merge") }}</span>
            <span class="r-sub">{{ t("bind_mergeSub", state.bindLocalCount) }}</span>
          </span>
        </label>
        <label class="bind-mode-opt" :class="{ on: state.bindMode === 'overwrite' }">
          <input v-model="state.bindMode" type="radio" value="overwrite" :disabled="state.bindBusy" />
          <span class="r-main">
            <span class="r-title danger">{{ t("bind_overwrite") }}</span>
            <span class="r-sub">{{ t("bind_overwriteSub", state.bindLocalCount) }}</span>
          </span>
        </label>
      </div>

      <div class="m-actions">
        <ArmedButton
          v-if="state.bindMode === 'overwrite'"
          style="height:36px;flex:2"
          :label="t('bind_ctaOverwrite')"
          :confirm-label="t('bind_ctaOverwriteConfirm')"
          :armed="armed"
          :countdown="armed ? countdown : 0"
          :disabled="!canBind || state.bindBusy"
          @press="press"
        />
        <button
          v-else
          class="btn btn-primary bind-cta"
          :disabled="!canBind || state.bindBusy"
          @click="doBindSpace"
        >
          {{ t("bind_cta") }}
        </button>
        <button class="btn btn-ghost" :disabled="state.bindBusy" @click="dismissBindModal">
          {{ t("bind_later") }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
// 首绑引导：本机从未绑定过 + 云端有多个空间时，同步前弹一次。
// 这是「这台电脑加入哪个空间」的**唯一**选择时机——绑定写下去之后就只剩换绑了。
import { computed, onUnmounted, ref } from "vue";
import { state, doBindSpace, dismissBindModal } from "../store.js";
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
.bind-list { gap: 6px; }
.bind-opt {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 40px;
  padding: 8px 12px;
  font: inherit;
  color: inherit;
  text-align: left;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color var(--dur-instant), background var(--dur-instant);
}
.bind-opt.on { border-color: var(--accent); background: var(--bg-scrim); }
.bind-mode { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
.bind-mode-opt {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
}
.bind-mode-opt.on { border-color: var(--accent); background: var(--bg-scrim); }
.bind-mode-opt input { margin-top: 3px; flex: none; }
.m-actions .bind-cta { flex: 2; }
.danger { color: var(--danger-text); }
</style>
