<template>
  <div class="overlay" @click.self="dismissFirstSync">
    <div class="modal">
      <!-- 分支 1：云端密文，本设备无密钥 -->
      <template v-if="state.firstSyncInfo?.remoteEncrypted">
        <div class="m-ico warning"><Icon name="lock" /></div>
        <div class="m-title">尚无可用的同步密钥</div>
        <p class="m-body">
          云端书签已开启端到端加密，本设备还没有同步密钥，无法读取云端数据。请用口令设定或导入从其他设备复制的同步密钥。
        </p>

        <template v-if="fsMode === 'phrase'">
          <div class="m-stack">
            <input
              v-model="state.firstSyncPhraseInput"
              class="input"
              type="password"
              placeholder="同一句口令（至少 8 位）"
              autocomplete="new-password"
              @keyup.enter="phraseFirstSyncKey"
            />
            <button class="btn btn-primary" :disabled="!state.firstSyncPhraseInput" @click="phraseFirstSyncKey">设定并继续</button>
          </div>
        </template>
        <template v-else-if="fsMode === 'key'">
          <div class="m-stack">
            <input
              v-model="state.firstSyncKeyInput"
              class="input mono"
              placeholder="粘贴密钥（44 字符）"
              autocomplete="off"
              spellcheck="false"
              @keyup.enter="importFirstSyncKey"
            />
            <button class="btn btn-primary" :disabled="!state.firstSyncKeyInput" @click="importFirstSyncKey">导入并继续</button>
          </div>
        </template>

        <div class="m-stack">
          <button class="btn btn-secondary" @click="fsMode = fsMode === 'phrase' ? '' : 'phrase'">用口令设定</button>
          <button class="btn btn-secondary" @click="fsMode = fsMode === 'key' ? '' : 'key'">导入已有密钥</button>
          <button class="btn btn-ghost" @click="dismissFirstSync">暂不同步</button>
        </div>

        <p v-if="state.firstSyncKeyMsg" class="hint" style="margin-top:10px;justify-content:center;color:var(--danger-text)">{{ state.firstSyncKeyMsg }}</p>
      </template>

      <!-- 分支 2：双方都有书签，四象限决策 -->
      <template v-else>
        <div class="m-ico info"><Icon name="list" /></div>
        <div class="m-title">云端与本机都有书签</div>
        <p class="m-body">
          本机 {{ state.firstSyncInfo?.localCount ?? "?" }} 条 · 云端 {{ state.firstSyncInfo?.remoteCount ?? "?" }} 条书签。请选择如何处理：
        </p>

        <div class="m-stack">
          <div class="plan-card reco">
            <div class="pc-top">
              <span class="pc-name">合并</span>
              <span class="badge badge-success badge-sub">推荐</span>
            </div>
            <ul>
              <li><Icon name="check" />云端 {{ state.firstSyncInfo?.remoteCount ?? "?" }} 条与本地 {{ state.firstSyncInfo?.localCount ?? "?" }} 条取并集，双方书签都保留</li>
              <li><Icon name="check" />删除双向生效，之后继续增量同步</li>
            </ul>
            <button class="btn btn-primary" style="width:100%;margin-top:12px" @click="firstSyncMerge">合并并继续</button>
          </div>

          <div class="plan-card">
            <div class="pc-top">
              <span class="pc-name" style="color:var(--danger-text)">覆盖本机</span>
            </div>
            <ul>
              <li><Icon name="alert" style="color:var(--danger-text)" />将删除本机独有 {{ state.firstSyncInfo?.localOnlyCount ?? "?" }} 条书签</li>
              <li><Icon name="alert" style="color:var(--danger-text)" />以云端为准，本机书签树将被替换</li>
            </ul>
            <ArmedButton
              class="fs-overwrite"
              style="width:100%;margin-top:12px;height:36px"
              :label="'用云端覆盖本机'"
              :confirm-label="'再次点击以确认覆盖'"
              :armed="state.overwriteArmed"
              :countdown="state.overwriteArmed ? state.overwriteLeft : 0"
              @press="firstSyncOverwrite"
            />
          </div>
        </div>

        <div class="m-actions">
          <button class="btn btn-ghost" @click="dismissFirstSync">暂不同步</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import {
  state, dismissFirstSync, firstSyncMerge, firstSyncOverwrite,
  importFirstSyncKey, phraseFirstSyncKey,
} from "../store.js";
import ArmedButton from "./ui/ArmedButton.vue";
import Icon from "./ui/Icon.vue";

const fsMode = ref("");
</script>
