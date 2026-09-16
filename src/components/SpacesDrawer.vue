<template>
  <div class="drawer-spaces">
    <SpacesList />
    <DevicesList />
  </div>
</template>

<script setup>
import SpacesList from "./SpacesList.vue";
import DevicesList from "./DevicesList.vue";
</script>

<style scoped>
.drawer-spaces { display: flex; flex-direction: column; gap: var(--popup-block-gap); }
</style>
