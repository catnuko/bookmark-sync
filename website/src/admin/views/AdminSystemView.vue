<script setup>
// 系统监控：op_log 量、GC 时间、Top 用户
import { onMounted, ref } from 'vue';
import { adminApi } from '../lib/client.js';
import StatCard from '../components/StatCard.vue';
import { formatBytes, formatCount, timeAgo } from '../lib/format.js';

const data = ref(null);
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    data.value = await adminApi.systemStats();
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page">
    <h2>系统监控</h2>
    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="loading">加载中…</p>
    <template v-else-if="data">
      <div class="grid">
        <StatCard label="op_log 总行数" :value="formatCount(data.oplog_rows)" />
        <StatCard label="op_log 占用" :value="formatBytes(data.oplog_bytes)" />
        <StatCard label="快照数" :value="formatCount(data.snapshot_count)" />
        <StatCard
          label="最近 GC"
          :value="data.latest_snapshot_at ? timeAgo(data.latest_snapshot_at) : '—'"
          :hint="data.latest_snapshot_at || '暂无快照'"
        />
        <StatCard
          label="待响应 GC 用户"
          :value="formatCount(data.pending_gc_users)"
          :hint="'后台已请求、设备尚未执行的用户数'"
        />
        <StatCard
          label="超阈值空间"
          :value="formatCount(data.over_threshold_spaces)"
          :hint="'op 行数超过各自用户动态阈值的空间数（即将自动压缩）'"
        />
      </div>

      <section class="card">
        <h3>op_log 占用 Top 10 用户（仅元数据，不解密）</h3>
        <table>
          <thead>
            <tr>
              <th>邮箱</th>
              <th>op 行数</th>
              <th>字节</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in data.top_users" :key="u.user_id">
              <td>{{ u.email || u.user_id }}</td>
              <td>{{ formatCount(u.oplog_rows) }}</td>
              <td>{{ formatBytes(u.oplog_bytes) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<style scoped>
h2 {
  margin: 0 0 16px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 14px;
  margin-bottom: 18px;
}
.card {
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 16px;
}
.card h3 {
  margin: 0 0 10px;
  font-size: 14px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th,
td {
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid var(--color-border);
}
th {
  background: var(--color-bg-muted);
  color: var(--color-text-muted);
}
.err {
  color: #b91c1c;
}
</style>
