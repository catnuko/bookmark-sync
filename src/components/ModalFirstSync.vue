<template>
  <div class="overlay" @click.self="dismissFirstSync">
    <div class="modal">
      <!-- 分支 1：云端密文，本设备无密钥 -->
      <template v-if="state.firstSyncInfo?.remoteEncrypted">
        <div class="m-ico warning"><Icon name="lock" /></div>
        <div class="m-title">需要输入同步口令</div>
        <p class="m-body">
          云端书签已加密，本设备还没有同步口令，无法读取云端数据。请输入你在其他设备上设置的<b>同一口令</b>。
        </p>

        <div class="m-stack">
          <input
            v-model="state.firstSyncPhraseInput"
            class="input"
            type="password"
            placeholder="同一句口令（至少 8 位）"
            autocomplete="new-password"
            @keyup.enter="phraseFirstSyncKey"
          />
          <button class="btn btn-primary" :disabled="!state.firstSyncPhraseInput" @click="phraseFirstSyncKey">输入并继续</button>
        </div>

        <div class="m-stack">
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
import {
  state, dismissFirstSync, firstSyncMerge, firstSyncOverwrite,
  phraseFirstSyncKey,
} from "../store.js";
import ArmedButton from "./ui/ArmedButton.vue";
import Icon from "./ui/Icon.vue";
</script>
