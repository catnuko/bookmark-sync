<template>
  <div class="grp">
    <h4>{{ t("spaceslist_title") }}</h4>
    <div class="inset-group">
      <!-- 空间行 -->
      <div v-for="s in state.spaces" :key="s.id" class="inset-row space-row">
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
          <span class="dot" :class="{ 'dot-current': state.activeSpace?.id === s.id }"></span>
          <div class="r-main">
            <div class="r-title">
              <button type="button" class="space-name" :title="t('spaceslist_switchTitle')" @click="doSwitchSpace(s)">
                {{ s.name }}
              </button>
              <span v-if="s.is_default" class="badge badge-neutral badge-sub">{{ t("spaceslist_default") }}</span>
              <span v-if="state.activeSpace?.id === s.id" class="badge badge-success badge-sub">{{ t("spaceslist_current") }}</span>
            </div>
            <div v-if="deviceCountForSpace(s.id) > 0" class="r-sub">{{ t("spaceslist_deviceCount", deviceCountForSpace(s.id)) }}</div>
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
import { state, doSwitchSpace, doCreateSpace, startRename, submitRename, doDeleteSpace, deviceCountForSpace, spaceLimit, planLabel } from "../store.js";
import { t } from "../lib/i18n.js";
import ArmedButton from "./ui/ArmedButton.vue";
import Icon from "./ui/Icon.vue";
</script>

<style scoped>
.space-name { font: inherit; color: inherit; font-weight: inherit; text-align: left; border-radius: var(--radius-xs); padding: 2px 4px; margin: -2px -4px; }
.space-name:hover { background: var(--bg-scrim); }
</style>
