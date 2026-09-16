<template>
  <div class="grp">
    <h4>同步中的浏览器</h4>
    <div v-if="state.devices.length" class="inset-group">
      <div v-for="d in state.devices" :key="d.device_id" class="inset-row">
        <span class="lede"><Icon :name="isMobile(d) ? 'phone' : 'monitor'" /></span>
        <div class="r-main">
          <div class="r-title">
            {{ deviceLabel(d) }}
            <span v-if="d.device_id === state.myDeviceId" class="badge badge-info badge-sub">本设备</span>
          </div>
          <div v-if="deviceSpaceName(d) || d.last_sync_at" class="r-sub">
            {{ deviceSpaceName(d) ? deviceSpaceName(d) + ' · ' : '' }}最近同步 {{ fmtRelative(d.last_sync_at) }}
          </div>
        </div>
        <ArmedButton
          v-if="d.device_id !== state.myDeviceId"
          :label="'解除'"
          :armed="state.armed === `device:${d.device_id}`"
          :countdown="state.armed === `device:${d.device_id}` ? state.armedLeft : 0"
          @press="doRemoveDevice(d)"
        />
      </div>
    </div>
    <div v-else class="banner banner-info">
      <Icon name="monitor" />
      <span>尚无记录，完成一次同步后自动登记。</span>
    </div>
    <p class="foot">
      「解除」用于电脑转手 / 重装：该浏览器退出列表，不再影响你的书签。
    </p>
  </div>
</template>

<script setup>
import { state, doRemoveDevice, deviceLabel, deviceSpaceName, fmtRelative } from "../store.js";
import ArmedButton from "./ui/ArmedButton.vue";
import Icon from "./ui/Icon.vue";

function isMobile(d) {
  const n = String(d.name ?? "").toLowerCase();
  return n.includes("android") || n.includes("iphone") || n.includes("ipad") || n.includes("mobile");
}
</script>
