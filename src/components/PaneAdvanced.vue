<template>
  <section class="pane active">
    <h2>高级</h2>
    <p class="pane-sub">与浏览器原生同步的共存策略，以及操作日志存储维护。</p>

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
      <h4>操作日志维护</h4>
      <div class="inset-group">
        <div class="inset-row">
          <span class="lede"><Icon name="list" /></span>
          <div class="r-main">
            <div class="r-title">日志 GC 阈值</div>
            <div class="r-sub">超过该条数时自动压缩为一份加密快照并截断旧日志，防止云端无限增长</div>
          </div>
          <input
            v-model="state.gcThresholdInput"
            class="input"
            type="number"
            min="0"
            step="500"
            placeholder="例如 2000"
            aria-label="GC 阈值"
            style="width:110px"
            @keyup.enter="saveGcThreshold"
          />
          <button class="btn btn-secondary btn-sm" @click="saveGcThreshold">保存</button>
        </div>
        <div class="inset-row">
          <span class="lede"><Icon name="folder" /></span>
          <div class="r-main">
            <div class="r-title">最近一次日志压缩</div>
            <div class="r-sub">{{ state.lastGcAt ? fmt(state.lastGcAt) : '尚未触发' }}</div>
          </div>
          <span class="badge" :class="state.lastGcAt ? 'badge-success' : 'badge-neutral'">{{ state.lastGcAt ? '已压缩' : '未触发' }}</span>
        </div>
      </div>
      <p class="foot">压缩仅合并历史操作记录，不删除任何书签。阈值设为 0 关闭自动压缩。</p>
    </div>

    <div class="grp">
      <h4>测试工具</h4>
      <div class="danger-zone">
        <div class="inset-row">
          <span class="lede" style="color:var(--danger-text)"><Icon name="trash" /></span>
          <div class="r-main">
            <div class="r-title">一键清空测试数据</div>
            <div class="r-sub">清空当前账号在云端的所有同步数据（空间 / 操作日志 / 设备 / 快照）、清除本机缓存并登出，仅保留浏览器书签</div>
          </div>
          <ArmedButton
            :label="'清空测试数据'"
            :confirm-label="'再次点击以确认'"
            :armed="state.armed === 'reset'"
            :countdown="state.armed === 'reset' ? state.armedLeft : 0"
            :disabled="state.resetBusy"
            @press="onResetPress"
          />
        </div>
      </div>
      <p v-if="state.resetMsg" class="foot">{{ state.resetMsg }}</p>
    </div>
  </section>
</template>

<script setup>
import { state, saveGcThreshold, resetTestData, armAction, fmt } from "../store.js";
import ArmedButton from "./ui/ArmedButton.vue";
import Icon from "./ui/Icon.vue";

function onResetPress() {
  armAction("reset", () => resetTestData());
}
</script>
