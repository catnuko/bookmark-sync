<template>
  <div class="grp">
    <h4>{{ t("spaceslist_title") }}</h4>
    <div class="inset-group">
      <!-- 空间行（+ 换绑确认条） -->
      <template v-for="s in state.spaces" :key="s.id">
        <div class="inset-row space-row">
          <template v-if="state.renamingId === s.id">
            <input
              v-model="state.renameInput"
              class="input"
              maxlength="50"
              :aria-label="t('spaceslist_nameAria')"
              @keyup.enter="submitRename(s)"
              @keyup.esc="state.renamingId = ''"
            />
            <button class="btn btn-secondary btn-sm" :disabled="!state.renameInput.trim()" @click="submitRename(s)">{{ t("common_save") }}</button>
            <button class="btn btn-ghost btn-sm" @click="state.renamingId = ''">{{ t("common_cancel") }}</button>
          </template>
          <template v-else>
            <span class="dot" :class="{ 'dot-current': isBoundSpace(s.id) }"></span>
            <div class="r-main">
              <div class="r-title">
                <button type="button" class="space-name" :title="t('spaceslist_switchTitle')" @click="armRebind(s)">
                  {{ s.name }}
                </button>
                <span v-if="s.is_default" class="badge badge-neutral badge-sub">{{ t("spaceslist_default") }}</span>
                <span v-if="isBoundSpace(s.id)" class="badge badge-success badge-sub">{{ t("spaceslist_bound") }}</span>
              </div>
              <!-- 副行：该空间已登记的其它设备数（本机绑定态由徽标表达） -->
              <div v-if="deviceCountForSpace(s.id) > 0" class="r-sub">
                {{ t("spaceslist_deviceCount", deviceCountForSpace(s.id)) }}
              </div>
            </div>
            <button class="icon-btn" :title="t('spaceslist_renameTitle', s.name)" :aria-label="t('spaceslist_rename')" @click="startRename(s)">
              <Icon name="pencil" />
            </button>
            <ArmedButton
              v-if="!s.is_default"
              :label="t('spaceslist_delete')"
              :armed="state.armed === `space:${s.id}`"
              :countdown="state.armed === `space:${s.id}` ? state.armedLeft : 0"
              @press="doDeleteSpace(s)"
            />
          </template>
        </div>
        <!-- 换绑确认条：换绑 = 清空本机书签并从该空间重建，是破坏性动作，
             必须显式二次确认（不使用 ArmedButton，因为需要展示完整后果说明）。 -->
        <div v-if="state.rebindTarget === s.id" class="inset-row rebind-row">
          <span class="r-main">
            <span class="r-sub rebind-note">{{ t(state.activeSpace ? "spaceslist_rebindConfirm" : "spaceslist_bindConfirm", s.name) }}</span>
          </span>
          <button class="btn btn-destructive btn-sm" :disabled="state.spaceBusy" @click="doRebindSpace(s)">
            {{ t("spaceslist_rebindBtn") }}
          </button>
          <button class="btn btn-ghost btn-sm" @click="state.rebindTarget = ''">{{ t("common_cancel") }}</button>
        </div>
      </template>

      <!-- 新建空间：点击展开输入 -->
      <template v-if="state.creatingSpace">
        <div class="inset-row">
          <input
            v-model="state.newSpaceName"
            class="input"
            :placeholder="t('spaceslist_newPh')"
            maxlength="50"
            :aria-label="t('spaceslist_newPh')"
            @keyup.enter="doCreateSpace"
          />
          <button class="btn btn-primary btn-sm" :disabled="!state.newSpaceName.trim() || state.spaceBusy" @click="doCreateSpace">{{ t("spaceslist_create") }}</button>
          <button class="btn btn-ghost btn-sm" @click="state.creatingSpace = false">{{ t("common_cancel") }}</button>
        </div>
      </template>
      <button v-else type="button" class="inset-row clickable" @click="state.creatingSpace = true">
        <span class="lede"><Icon name="plus" /></span>
        <span class="r-main"><span class="r-title">{{ t("spaceslist_new") }}</span></span>
        <span class="sc-tail">{{ t("spaceslist_limit", planLabel, spaceLimit, state.spaces.length) }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { state, isBoundSpace, armRebind, doRebindSpace, doCreateSpace, startRename, submitRename, doDeleteSpace, deviceCountForSpace, spaceLimit, planLabel } from "../store.js";
import { t } from "../lib/i18n.js";
import ArmedButton from "./ui/ArmedButton.vue";
import Icon from "./ui/Icon.vue";
</script>

<style scoped>
.space-name { font: inherit; color: inherit; font-weight: inherit; text-align: left; border-radius: var(--radius-xs); padding: 2px 4px; margin: -2px -4px; }
.space-name:hover { background: var(--bg-scrim); }
.rebind-row { background: var(--bg-scrim); }
.rebind-note { white-space: normal; }
</style>
