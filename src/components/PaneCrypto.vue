<template>
  <section class="pane active">
    <h2>加密</h2>
    <p class="pane-sub">端到端加密（AES-256-GCM）强制开启，不可关闭。同步密钥是解密云端数据的唯一凭证。</p>

    <div class="grp">
      <KeyPanel />
    </div>
  </section>
</template>

<script setup>
import KeyPanel from "./KeyPanel.vue";
</script>
