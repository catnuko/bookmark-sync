<script setup>
// License 卡管理
import { onMounted, ref, watch } from "vue";
import { adminApi } from "../lib/client.js";
import DataTable from "../components/DataTable.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { formatTime } from "../lib/format.js";

const rows = ref([]);
const total = ref(0);
const loading = ref(false);
const page = ref(1);
const pageSize = 50;
const activeFilter = ref(""); // "" / "true" / "false"

async function load() {
  loading.value = true;
  try {
    const res = await adminApi.listLicenses({
      active: activeFilter.value === "" ? null : activeFilter.value === "true",
      limit: pageSize,
      offset: (page.value - 1) * pageSize,
    });
    rows.value = res.rows || [];
    total.value = res.total || 0;
  } catch (e) { alert(e.message); } finally { loading.value = false; }
}
onMounted(load);
watch([page, activeFilter], load);

async function toggle(row) {
  if (!confirm(`确认${row.is_active ? "停用" : "启用"} ${row.license_key}？`)) return;
  try {
    await adminApi.setLicenseActive(row.id, !row.is_active);
    await load();
  } catch (e) { alert(e.message); }
}
</script>

<template>
  <div class="page">
    <div class="bar">
      <h2>License 卡</h2>
      <select v-model="activeFilter" @change="page = 1">
        <option value="">全部</option>
        <option value="true">启用中</option>
        <option value="false">已停用</option>
      </select>
    </div>
    <DataTable :loading="loading" :rows="rows" :total="total" :page="page" :page-size="pageSize"
      @update:page="page = $event">
      <template #head><th>卡号</th><th>到期</th><th>用量</th><th>状态</th><th>创建</th><th>最近使用</th><th></th></template>
      <template #default="{ row }">
        <td class="mono">{{ row.license_key }}</td>
        <td>{{ formatTime(row.expire_date) }}</td>
        <td>{{ row.used_count }} / {{ row.max_usage }}</td>
        <td><StatusBadge :label="row.is_active ? '启用' : '停用'" :tone="row.is_active ? 'success' : 'neutral'" /></td>
        <td>{{ formatTime(row.created_at) }}</td>
        <td>{{ formatTime(row.last_used_at) }}</td>
        <td><button class="link" @click="toggle(row)">{{ row.is_active ? "停用" : "启用" }}</button></td>
      </template>
    </DataTable>
  </div>
</template>

<style scoped>
h2 { margin: 0 0 14px; }
.bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
select { padding: 6px 10px; border: 1px solid var(--color-border); border-radius: 6px; }
.mono { font-family: var(--font-mono); font-size: 12px; }
.link { background: none; border: 0; color: var(--color-accent); cursor: pointer; font-size: 13px; }
</style>
