<script setup>
// 审计日志：谁(admin_email) 何时 做了什么(action) 改了谁(target_email)，detail 存改前/改后值
import { onMounted, ref, watch } from 'vue';
import { adminApi } from '../lib/client.js';
import DataTable from '../components/DataTable.vue';
import { formatTime, actionLabel, formatAuditDetail } from '../lib/format.js';

const rows = ref([]);
const total = ref(0);
const loading = ref(false);
const page = ref(1);
const pageSize = 50;
const action = ref('');

const actionOptions = [
  { value: '', label: '全部操作' },
  { value: 'set_plan', label: '改 plan' },
  { value: 'reset_usage', label: '重置用量' },
  { value: 'reset_user_data', label: '清空数据' },
  { value: 'set_gc_threshold', label: '改 GC 阈值' },
  { value: 'request_gc', label: '请求 GC' },
];

async function load() {
  loading.value = true;
  try {
    const res = await adminApi.listAuditLogs({
      action: action.value || null,
      limit: pageSize,
      offset: (page.value - 1) * pageSize,
    });
    rows.value = res.rows || [];
    total.value = res.total || 0;
  } catch (e) {
    alert(e.message);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch([page, action], load);
</script>

<template>
  <div class="page">
    <div class="bar">
      <h2>操作审计</h2>
      <select v-model="action" @change="page = 1">
        <option v-for="opt in actionOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
    </div>
    <p class="muted">
      后台全部写操作留痕：改 plan / 重置用量 / 清空数据 / GC
      阈值与请求，均记录操作人、时间与改前改后值。
    </p>
    <DataTable
      :loading="loading"
      :rows="rows"
      :total="total"
      :page="page"
      :page-size="pageSize"
      @update:page="page = $event"
    >
      <template #head>
        <th>时间</th>
        <th>操作人</th>
        <th>操作</th>
        <th>目标用户</th>
        <th>变更明细</th>
      </template>
      <template #default="{ row }">
        <td class="nowrap">{{ formatTime(row.created_at) }}</td>
        <td>{{ row.admin_email || row.admin_id }}</td>
        <td>
          <span class="tag">{{ actionLabel(row.action) }}</span>
        </td>
        <td>{{ row.target_email || row.target_user || '—' }}</td>
        <td class="detail">{{ formatAuditDetail(row.detail) }}</td>
      </template>
    </DataTable>
  </div>
</template>

<style scoped>
h2 {
  margin: 0 0 6px;
}
.bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
select {
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
}
.muted {
  font-size: 12.5px;
  color: var(--color-text-faint);
  margin: 0 0 12px;
}
.tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-bg-muted);
  color: var(--color-text-soft);
  font-size: 12px;
}
.detail {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-text-soft);
  word-break: break-all;
}
.nowrap {
  white-space: nowrap;
}
</style>
