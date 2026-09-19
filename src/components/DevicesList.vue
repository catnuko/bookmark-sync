<template>
  <div class="grp">
    <h4>{{ t("devices_title") }}</h4>
    <div v-if="state.devices.length" class="inset-group">
      <div v-for="d in state.devices" :key="d.device_id" class="inset-row">
        <template v-if="state.renamingDeviceId === d.device_id">
          <input
            v-model="state.deviceRenameInput"
            class="input"
            maxlength="50"
            :placeholder="t('devices_namePh')"
            :aria-label="t('devices_namePh')"
            @keyup.enter="submitDeviceRename(d)"
            @keyup.esc="state.renamingDeviceId = ''"
          />
          <button class="btn btn-secondary btn-sm" :disabled="!state.deviceRenameInput.trim()" @click="submitDeviceRename(d)">{{ t("common_save") }}</button>
          <button class="btn btn-ghost btn-sm" @click="state.renamingDeviceId = ''">{{ t("common_cancel") }}</button>
        </template>
        <template v-else>
          <span class="lede"><Icon :name="isMobile(d) ? 'phone' : 'monitor'" /></span>
          <div class="r-main">
            <div class="r-title">
              {{ deviceLabel(d) }}
              <span v-if="d.device_id === state.myDeviceId" class="badge badge-info badge-sub">{{ t("devices_thisDevice") }}</span>
            </div>
            <div v-if="deviceSpaceName(d) || d.last_sync_at" class="r-sub">
              {{ deviceSpaceName(d) ? deviceSpaceName(d) + ' · ' : '' }}{{ d.last_sync_at ? t("devices_lastSync", fmtRelative(d.last_sync_at)) : "" }}
            </div>
          </div>
          <button class="icon-btn" :title="t('devices_renameTitle', deviceLabel(d))" :aria-label="t('devices_rename')" @click="startDeviceRename(d)">
            <Icon name="pencil" />
          </button>
          <ArmedButton
            v-if="d.device_id !== state.myDeviceId"
            :label="t('devices_disconnect')"
            :armed="state.armed === `device:${d.device_id}`"
            :countdown="state.armed === `device:${d.device_id}` ? state.armedLeft : 0"
            @press="doRemoveDevice(d)"
          />
        </template>
      </div>
    </div>
    <div v-else class="banner banner-info">
      <Icon name="monitor" />
      <span>{{ t("devices_empty") }}</span>
    </div>
    <p class="foot">
      {{ t("devices_foot") }}
    </p>
  </div>
</template>

<script setup>
import { state, doRemoveDevice, startDeviceRename, submitDeviceRename, deviceLabel, deviceSpaceName, fmtRelative } from "../store.js";
import { t } from "../lib/i18n.js";
import ArmedButton from "./ui/ArmedButton.vue";
import Icon from "./ui/Icon.vue";

function isMobile(d) {
  const n = String(d.name ?? "").toLowerCase();
  return n.includes("android") || n.includes("iphone") || n.includes("ipad") || n.includes("mobile");
}
</script>
