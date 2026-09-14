<script setup>
// 概览 Dashboard：指标卡 + 近 30 天趋势（手绘 SVG 折线，不引第三方图表库）
import { onMounted, ref, computed } from "vue";
import { adminApi } from "../lib/client.js";
import {
  formatBytes, formatCount, formatMoney, formatRate,
} from "../lib/format.js";
import StatCard from "../components/StatCard.vue";

const data = ref(null);
const loading = ref(true);
const error = ref("");

onMounted(async () => {
  try {
    data.value = await adminApi.overview();
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
});

// 把 [{d, n}] 数组转成 SVG polyline points（归一化到 600x160）
function toPoints(arr, key) {
  if (!arr || !arr.length) return "";
  const W = 600, H = 160, PAD = 4;
  const vals = arr.map((x) => Number(x[key]) || 0);
  const max = Math.max(1, ...vals);
  return arr
    .map((x, i) => {
      const px = PAD + (i / (arr.length - 1 || 1)) * (W - PAD * 2);
      const py = H - PAD - ((Number(x[key]) || 0) / max) * (H - PAD * 2);
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(" ");
}

const newPoints = computed(() => toPoints(data.value?.daily_new, "n"));
const gmvPoints = computed(() => toPoints(data.value?.daily_gmv_cents, "cents"));
</script>

<template>
  <div class="page">
    <h2>概览</h2>
    <p v-if="error" class="err">加载失败：{{ error }}</p>

    <div v-if="loading" class="muted">加载中…</div>
    <template v-else-if="data">
      <div class="grid">
        <StatCard label="总用户" :value="formatCount(data.total_users)" :hint="`今日新增 ${formatCount(data.new_today)} · 7日 ${formatCount(data.new_7d)}`" />
        <StatCard label="付费用户" :value="formatCount(data.paid_users)" :hint="`付费率 ${formatRate(data.paid_rate)}`" />
        <StatCard label="24h 活跃设备" :value="formatCount(data.active_devices_24h)" />
        <StatCard label="今日 GMV" :value="formatMoney(data.gmv_today_cents)" :hint="`订单 ${formatCount(data.orders_today)} 笔`" />
        <StatCard label="op_log 行数" :value="formatCount(data.oplog_rows)" :hint="formatBytes(data.oplog_bytes)" />
        <StatCard label="超 80% 配额用户" :value="formatCount(data.over_quota_users)" />
      </div>

      <div class="charts">
        <div class="chart-card">
          <h3>近 30 天新增用户</h3>
          <svg viewBox="0 0 600 160" preserveAspectRatio="none" class="chart">
            <polyline :points="newPoints" fill="none" stroke="#0066ff" stroke-width="2" />
          </svg>
        </div>
        <div class="chart-card">
          <h3>近 30 天 GMV（分）</h3>
          <svg viewBox="0 0 600 160" preserveAspectRatio="none" class="chart">
            <polyline :points="gmvPoints" fill="none" stroke="#047857" stroke-width="2" />
          </svg>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page h2 { margin: 0 0 16px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; }
.charts { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 18px; }
.chart-card { background: #fff; border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 14px; }
.chart-card h3 { margin: 0 0 8px; font-size: 14px; }
.chart { width: 100%; height: 160px; }
.err { color: #b91c1c; }
.muted { color: var(--color-text-muted); }
@media (max-width: 900px) { .charts { grid-template-columns: 1fr; } }
</style>
