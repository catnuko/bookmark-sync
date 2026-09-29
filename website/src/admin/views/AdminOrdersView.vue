<script setup>
// 订单流水
import { onMounted, ref, watch } from 'vue';
import { adminApi } from '../lib/client.js';
import DataTable from '../components/DataTable.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { formatTime, formatMoney, orderStatusMeta } from '../lib/format.js';

const rows = ref([]);
const total = ref(0);
const loading = ref(false);
const page = ref(1);
const pageSize = 50;
const status = ref('');

async function load() {
  loading.value = true;
  try {
    const res = await adminApi.listOrders({
      status: status.value || null,
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
watch([page, status], load);
</script>

<template>
  <div class="page">
    <div class="bar">
      <h2>订单</h2>
      <select v-model="status" @change="page = 1">
        <option value="">全部状态</option>
        <option value="paid">已支付</option>
        <option value="pending">待支付</option>
        <option value="refunded">已退款</option>
        <option value="failed">失败</option>
      </select>
    </div>
    <DataTable
      :loading="loading"
      :rows="rows"
      :total="total"
      :page="page"
      :page-size="pageSize"
      @update:page="page = $event"
    >
      <template #head
        ><th>时间</th>
        <th>邮箱</th>
        <th>plan</th>
        <th>金额</th>
        <th>状态</th>
        <th>Creem Order ID</th></template
      >
      <template #default="{ row }">
        <td>{{ formatTime(row.created_at) }}</td>
        <td>{{ row.email || '—' }}</td>
        <td>{{ row.plan }}</td>
        <td>{{ formatMoney(row.amount_cents, row.currency) }}</td>
        <td>
          <StatusBadge
            :label="orderStatusMeta(row.status).label"
            :tone="orderStatusMeta(row.status).tone"
          />
        </td>
        <td class="mono">{{ row.creem_order_id || '—' }}</td>
      </template>
      <template #card="{ row }">
        <article class="o-card">
          <div class="o-head">
            <span class="o-amount">{{ formatMoney(row.amount_cents, row.currency) }}</span>
            <StatusBadge
              :label="orderStatusMeta(row.status).label"
              :tone="orderStatusMeta(row.status).tone"
            />
          </div>
          <div class="o-row">
            <span class="o-k">时间</span>
            <span class="o-v">{{ formatTime(row.created_at) }}</span>
          </div>
          <div class="o-row">
            <span class="o-k">邮箱</span>
            <span class="o-v">{{ row.email || '—' }}</span>
          </div>
          <div class="o-row">
            <span class="o-k">plan</span>
            <span class="o-v">{{ row.plan }}</span>
          </div>
          <div class="o-row">
            <span class="o-k">Creem Order ID</span>
            <span class="o-v mono">{{ row.creem_order_id || '—' }}</span>
          </div>
        </article>
      </template>
    </DataTable>
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
.mono {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-text-muted);
}

/* 移动端卡片 */
.o-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  font-size: 13px;
}
.o-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}
.o-amount {
  font-weight: 600;
  font-size: 15px;
}
.o-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 0;
}
.o-k {
  color: var(--color-text-muted);
  flex: none;
}
.o-v {
  text-align: right;
  word-break: break-all;
}

@media (max-width: 768px) {
  .bar {
    flex-wrap: wrap;
  }
  select {
    flex: 1 1 100%;
    font-size: 16px;
  }
}
</style>
