<template>
  <div class="overlay" @click.self="dismissFirstSync">
    <div class="modal">
      <!-- 分支 1：云端密文，本设备无密钥 -->
      <template v-if="state.firstSyncInfo?.remoteEncrypted">
        <div class="m-ico warning"><Icon name="lock" /></div>
        <div class="m-title">{{ t("fs_phraseTitle") }}</div>
        <p class="m-body">
          {{ t("fs_phraseBody1") }}<b>{{ t("fs_phraseBodyBold") }}</b>{{ t("fs_phraseBody2") }}
        </p>

        <div class="m-stack">
          <input
            v-model="state.firstSyncPhraseInput"
            class="input"
            type="password"
            :placeholder="t('fs_phrasePh')"
            autocomplete="new-password"
            @keyup.enter="phraseFirstSyncKey"
          />
          <button class="btn btn-primary" :disabled="!state.firstSyncPhraseInput" @click="phraseFirstSyncKey">{{ t("fs_phraseCta") }}</button>
        </div>

        <div class="m-stack">
          <button class="btn btn-ghost" @click="dismissFirstSync">{{ t("fs_later") }}</button>
        </div>

        <p v-if="state.firstSyncKeyMsg" class="hint" style="margin-top:10px;justify-content:center;color:var(--danger-text)">{{ state.firstSyncKeyMsg }}</p>
      </template>

      <!-- 分支 2：双方都有书签，四象限决策 -->
      <template v-else>
        <div class="m-ico info"><Icon name="list" /></div>
        <div class="m-title">{{ t("fs_bothTitle") }}</div>
        <p class="m-body">
          {{ t("fs_bothBody", state.firstSyncInfo?.localCount ?? "?", state.firstSyncInfo?.remoteCount ?? "?") }}
        </p>

        <div class="m-stack">
          <div class="plan-card reco">
            <div class="pc-top">
              <span class="pc-name">{{ t("fs_mergeName") }}</span>
              <span class="badge badge-success badge-sub">{{ t("plan_reco") }}</span>
            </div>
            <ul>
              <li><Icon name="check" />{{ t("fs_mergeFeat1", state.firstSyncInfo?.remoteCount ?? "?", state.firstSyncInfo?.localCount ?? "?") }}</li>
              <li><Icon name="check" />{{ t("fs_mergeFeat2") }}</li>
            </ul>
            <button class="btn btn-primary" style="width:100%;margin-top:12px" @click="firstSyncMerge">{{ t("fs_mergeCta") }}</button>
          </div>

          <div class="plan-card">
            <div class="pc-top">
              <span class="pc-name" style="color:var(--danger-text)">{{ t("fs_overName") }}</span>
            </div>
            <ul>
              <li><Icon name="alert" style="color:var(--danger-text)" />{{ t("fs_overFeat1", state.firstSyncInfo?.localOnlyCount ?? "?") }}</li>
              <li><Icon name="alert" style="color:var(--danger-text)" />{{ t("fs_overFeat2") }}</li>
            </ul>
            <ArmedButton
              class="fs-overwrite"
              style="width:100%;margin-top:12px;height:36px"
              :label="t('fs_overCta')"
              :confirm-label="t('fs_overConfirm')"
              :armed="state.overwriteArmed"
              :countdown="state.overwriteArmed ? state.overwriteLeft : 0"
              @press="firstSyncOverwrite"
            />
          </div>
        </div>

        <div class="m-actions">
          <button class="btn btn-ghost" @click="dismissFirstSync">{{ t("fs_later") }}</button>
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
import { t } from "../lib/i18n.js";
import ArmedButton from "./ui/ArmedButton.vue";
import Icon from "./ui/Icon.vue";
</script>
