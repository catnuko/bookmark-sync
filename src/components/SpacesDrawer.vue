<template>
  <div class="flex flex-col gap-3">
    <SpacesList />
    <DevicesList />
  </div>
</template>

<script setup>
import SpacesList from './biz/SpacesList.vue';
import DevicesList from './biz/DevicesList.vue';
</script>
