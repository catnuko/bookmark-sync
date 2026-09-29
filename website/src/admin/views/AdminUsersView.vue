<script setup>
// 用户列表：搜索 + plan 过滤 + 分页
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { adminApi } from '../lib/client.js';
import DataTable from '../components/DataTable.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { formatBytes, formatCount, formatTime, planLabel, planTone } from '../lib/format.js';

const router = useRouter();
const rows = ref([]);
const total = ref(0);
const loading = ref(false);
const page = ref(1);
const pageSize = 50;
const search = ref('');
const plan = ref('');

async function load() {
  loading.value = true;
  try {
    const res = await adminApi.listUsers({
      search: search.value || null,
      plan: plan.value || null,
      sort: 'recent',
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
watch([page], load);

function onSearch() {
  page.value = 1;
  load();
}
function openUser(id) {
  router.push(`/admin/users/${id}`);
}
</script>

<template>
  <div class="page">
    <div class="bar">
      <h2>用户</h2>
      <div class="filters">
        <input v-model="search" placeholder="搜索邮箱…" @keyup.enter="onSearch" />
        <select v-model="plan" @change="onSearch">
          <option value="">全部 plan</option>
          <option value="free">Free</option>
          <option value="plus">Plus</option>
          <option value="pro">Pro</option>
          <option value="lifetime">Lifetime</option>
        </select>
        <button class="btn" @click="onSearch">查询</button>
      </div>
    </div>

    <DataTable
      :loading="loading"
      :rows="rows"
      :total="total"
      :page="page"
      :page-size="pageSize"
      @update:page="page = $event"
    >
      <template #head>
        <th>邮箱</th>
        <th>plan</th>
        <th>用量</th>
        <th>条数</th>
        <th>设备</th>
        <th>空间</th>
        <th>注册时间</th>
        <th>最后活跃</th>
        <th></th>
      </template>
      <template #default="{ row }">
        <td>{{ row.email }}</td>
        <td><StatusBadge :label="planLabel(row.plan)" :tone="planTone(row.plan)" /></td>
        <td>{{ formatBytes(row.used_bytes) }} / {{ formatBytes(row.quota_bytes) }}</td>
        <td>{{ formatCount(row.used_count) }}</td>
        <td>{{ row.device_count }}</td>
        <td>{{ row.space_count }}</td>
        <td>{{ formatTime(row.created_at) }}</td>
        <td>{{ formatTime(row.last_seen_at) }}</td>
        <td><button class="link" @click="openUser(row.user_id)">详情 →</button></td>
      </template>
      <template #card="{ row }">
        <article class="u-card">
          <div class="u-head">
            <span class="u-mail">{{ row.email }}</span>
            <StatusBadge :label="planLabel(row.plan)" :tone="planTone(row.plan)" />
          </div>
          <div class="u-row">
            <span class="u-k">用量</span>
            <span class="u-v"
              >{{ formatBytes(row.used_bytes) }} / {{ formatBytes(row.quota_bytes) }}</span
            >
          </div>
          <div class="u-row">
            <span class="u-k">条数</span>
            <span class="u-v">{{ formatCount(row.used_count) }}</span>
          </div>
          <div class="u-row">
            <span class="u-k">设备 / 空间</span>
            <span class="u-v">{{ row.device_count }} / {{ row.space_count }}</span>
          </div>
          <div class="u-row">
            <span class="u-k">注册时间</span>
            <span class="u-v">{{ formatTime(row.created_at) }}</span>
          </div>
          <div class="u-row">
            <span class="u-k">最后活跃</span>
            <span class="u-v">{{ formatTime(row.last_seen_at) }}</span>
          </div>
          <button class="link u-open" @click="openUser(row.user_id)">详情 →</button>
        </article>
      </template>
    </DataTable>
  </div>
</template>

<style scoped>
.page h2 {
  margin: 0 0 14px;
}
.bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}
.filters {
  display: flex;
  gap: 8px;
}
.filters input,
.filters select {
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
}
.btn {
  padding: 6px 14px;
  background: var(--color-accent);
  color: #fff;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.link {
  background: none;
  border: 0;
  color: var(--color-accent);
  cursor: pointer;
  font-size: 13px;
}

/* 移动端卡片（插槽内容编译在父作用域，此处 scoped 样式直接生效） */
.u-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  font-size: 13px;
}
.u-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}
.u-mail {
  font-weight: 600;
  font-size: 14px;
  word-break: break-all;
}
.u-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 0;
}
.u-k {
  color: var(--color-text-muted);
  flex: none;
}
.u-v {
  text-align: right;
  word-break: break-all;
}
.u-open {
  margin-top: 8px;
  min-height: 36px;
}

@media (max-width: 768px) {
  .filters {
    flex-wrap: wrap;
  }
  .filters input,
  .filters select {
    flex: 1 1 140px;
    font-size: 16px;
  }
}
</style>
