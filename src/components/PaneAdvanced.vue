<template>
  <section class="pane active">
    <template v-if="!bare">
      <h2>高级</h2>
      <p class="pane-sub">与浏览器原生同步的共存策略，以及操作日志存储维护。</p>
    </template>

    <div class="grp">
      <h4>与浏览器自带同步共存</h4>
      <div class="inset-group">
        <div class="inset-row">
          <span class="lede"><Icon name="globe" /></span>
          <div class="r-main">
            <div class="r-title">不接管 Chrome Sync</div>
            <div class="r-sub">通过 chrome.bookmarks 接口同步本机书签树，不接管 Chrome 原生「同步」功能</div>
          </div>
          <span class="badge badge-neutral badge-sub">独立</span>
        </div>
        <div class="inset-row">
          <span class="lede"><Icon name="check-circle" /></span>
          <div class="r-main">
            <div class="r-title">两者同开不丢数据</div>
            <div class="r-sub">本机任何书签变化（无论来自哪个来源）都会进入同步日志，Move-CRDT 合并后收敛为同一棵树</div>
          </div>
          <span class="badge badge-success badge-sub">安全</span>
        </div>
        <div class="inset-row">
          <span class="lede"><Icon name="alert" /></span>
          <div class="r-main">
            <div class="r-title">建议二选一</div>
            <div class="r-sub">两套云端各自保存书签状态，删除/合并语义叠加后可能难以判断「哪个是权威」</div>
          </div>
          <span class="badge badge-warning badge-sub">建议</span>
        </div>
      </div>
    </div>

    <div class="grp">
      <h4>数据维护</h4>
      <div class="inset-group">
        <div class="inset-row">
          <span class="lede"><Icon name="folder" /></span>
          <div class="r-main">
            <div class="r-title">最近一次日志压缩</div>
            <div class="r-sub">云端自动合并历史操作记录并压缩存储，无需手动维护</div>
          </div>
          <span class="badge" :class="state.lastGcAt ? 'badge-success' : 'badge-neutral'">{{ state.lastGcAt ? '已压缩' : '未触发' }}</span>
        </div>
      </div>
      <p class="foot">日志压缩仅合并历史操作记录，不删除任何书签。由云端按需自动执行。</p>
    </div>

    <div class="grp">
      <h4>本机设置</h4>
      <div class="inset-group">
        <div class="inset-row">
          <span class="lede"><Icon name="sync" /></span>
          <div class="r-main">
            <div class="r-title">自动同步</div>
            <div class="r-sub">检测到本地书签变更后，自动在后台加密上传并拉取增量</div>
          </div>
          <SwitchToggle :model-value="state.autoSync" aria-label="自动同步" @update:model-value="toggleAutoSync" />
        </div>
        <div class="inset-row">
          <span class="lede"><Icon name="log-out" /></span>
          <div class="r-main">
            <div class="r-title">退出登录</div>
            <div class="r-sub">退出当前账号，本机密钥与同步口令保留，重新登录后可直接继续同步</div>
          </div>
          <button class="btn btn-secondary btn-sm" @click="logout">退出登录</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { state, toggleAutoSync, logout, fmt } from "../store.js";
import SwitchToggle from "./ui/SwitchToggle.vue";
import Icon from "./ui/Icon.vue";

defineProps({ bare: { type: Boolean, default: false } });
</script>
