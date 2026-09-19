<template>
  <section class="pane active">
    <h2>{{ t("spaces_title") }}</h2>
    <p class="pane-sub">{{ t("spaces_sub") }}</p>

    <div class="grp">
      <SpacesList />
    </div>
    <div class="grp">
      <DevicesList />
    </div>
  </section>
</template>

<script setup>
import { t } from "../lib/i18n.js";
import SpacesList from "./SpacesList.vue";
import DevicesList from "./DevicesList.vue";
</script>
