<template>
  <div class="grp">
    <h4>同步空间</h4>
    <div class="inset-group">
      <!-- 空间行 -->
      <div v-for="s in state.spaces" :key="s.id" class="inset-row space-row">
        <template v-if="state.renamingId === s.id">
          <input
            v-model="state.renameInput"
            class="input"
            maxlength="50"
            aria-label="空间名称"
            @keyup.enter="submitRename(s)"
            @keyup.esc="state.renamingId = ''"
          />
          <button class="btn btn-secondary btn-sm" :disabled="!state.renameInput.trim()" @click="submitRename(s)">保存</button>
          <button class="btn btn-ghost btn-sm" @click="state.renamingId = ''">取消</button>
        </template>
        <template v-else>
          <span class="dot" :class="{ 'dot-current': state.activeSpace?.id === s.id }"></span>
          <div class="r-main">
            <div class="r-title">
              <button type="button" class="space-name" :title="'点击切换到该空间'" @click="doSwitchSpace(s)">
                {{ s.name }}
              </button>
              <span v-if="s.is_default" class="badge badge-neutral badge-sub">默认</span>
              <span v-if="state.activeSpace?.id === s.id" class="badge badge-success badge-sub">当前</span>
            </div>
            <div v-if="deviceCountForSpace(s.id) > 0" class="r-sub">{{ deviceCountForSpace(s.id) }} 台设备</div>
          </div>
          <button class="icon-btn" :title="'重命名 ' + s.name" aria-label="重命名" @click="startRename(s)">
            <Icon name="pencil" />
          </button>
          <ArmedButton
            v-if="!s.is_default"
            :label="'删除'"
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
            placeholder="新空间名称"
            maxlength="50"
            aria-label="新空间名称"
            @keyup.enter="doCreateSpace"
          />
          <button class="btn btn-primary btn-sm" :disabled="!state.newSpaceName.trim() || state.spaceBusy" @click="doCreateSpace">创建</button>
          <button class="btn btn-ghost btn-sm" @click="state.creatingSpace = false">取消</button>
        </div>
      </template>
      <button v-else type="button" class="inset-row clickable" @click="state.creatingSpace = true">
        <span class="lede"><Icon name="plus" /></span>
        <span class="r-main"><span class="r-title">新建空间</span></span>
        <span class="sc-tail">{{ planLabel }} 限 {{ spaceLimit }} 个 · 已用 {{ state.spaces.length }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { state, doSwitchSpace, doCreateSpace, startRename, submitRename, doDeleteSpace, deviceCountForSpace, spaceLimit, planLabel } from "../store.js";
import ArmedButton from "./ui/ArmedButton.vue";
import Icon from "./ui/Icon.vue";
</script>

<style scoped>
.space-name { font: inherit; color: inherit; font-weight: inherit; text-align: left; border-radius: var(--radius-xs); padding: 2px 4px; margin: -2px -4px; }
.space-name:hover { background: var(--bg-scrim); }
</style>
