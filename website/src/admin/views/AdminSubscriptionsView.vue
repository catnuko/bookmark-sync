<script setup>
// 订阅列表
import { onMounted, ref, watch } from 'vue';
import { adminApi } from '../lib/client.js';
import StatusBadge from '../components/StatusBadge.vue';
import { formatTime, subStatusMeta } from '../lib/format.js';

const rows = ref([]);
const loading = ref(true);
const status = ref('');

async function load() {
  loading.value = true;
  try {
    rows.value = await adminApi.listSubscriptions(status.value || null);
  } catch (e) {
    alert(e.message);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(status, load);
</script>

<template>
  <div class="page">
    <div class="bar">
      <h2>订阅</h2>
      <select v-model="status">
        <option value="">全部状态</option>
        <option value="active">生效中</option>
        <option value="scheduled_cancel">到期不续</option>
        <option value="past_due">扣款失败</option>
        <option value="canceled">已取消</option>
        <option value="expired">已过期</option>
      </select>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>邮箱</th>
            <th>plan</th>
            <th>状态</th>
            <th>当前周期截止</th>
            <th>取消时间</th>
            <th>更新于</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="6" class="muted">加载中…</td>
          </tr>
          <tr v-else-if="!rows.length">
            <td colspan="6" class="muted">暂无数据</td>
          </tr>
          <tr v-for="r in rows" :key="r.user_id">
            <td>{{ r.email || '—' }}</td>
            <td>{{ r.plan }}</td>
            <td>
              <StatusBadge
                :label="subStatusMeta(r.status).label"
                :tone="subStatusMeta(r.status).tone"
              />
            </td>
            <td>{{ formatTime(r.current_period_end) }}</td>
            <td>{{ formatTime(r.canceled_at) }}</td>
            <td>{{ formatTime(r.updated_at) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
h2 {
  margin: 0 0 14px;
}
.bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
select {
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
}
.table-wrap {
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th,
td {
  padding: 10px 14px;
  text-align: left;
  border-bottom: 1px solid var(--color-border);
}
th {
  background: var(--color-bg-muted);
  color: var(--color-text-muted);
}
.muted {
  text-align: center;
  color: var(--color-text-faint);
  padding: 24px;
}
</style>
