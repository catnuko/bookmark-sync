<template>
  <section class="pane active">
    <h2>空间与设备</h2>
    <p class="pane-sub">每个空间是一棵独立书签树，可分别绑定不同浏览器资料（如工作 / 个人）。</p>

    <div class="grp">
      <SpacesList />
    </div>
    <div class="grp">
      <DevicesList />
    </div>
  </section>
</template>

<script setup>
import SpacesList from "./SpacesList.vue";
import DevicesList from "./DevicesList.vue";
</script>
