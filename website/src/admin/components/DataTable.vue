<script setup>
// 通用数据表格：表头插槽 + 行插槽 + 分页
defineProps({
  loading: { type: Boolean, default: false },
  rows: { type: Array, default: () => [] },
  total: { type: Number, default: 0 },
  page: { type: Number, default: 1 },
  pageSize: { type: Number, default: 50 },
  emptyText: { type: String, default: '暂无数据' },
});
defineEmits(['update:page']);
</script>

<template>
  <div class="table-wrap">
    <table class="table">
      <thead>
        <tr>
          <slot name="head" />
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="99" class="cell muted">加载中…</td>
        </tr>
        <tr v-else-if="!rows.length">
          <td colspan="99" class="cell muted">{{ emptyText }}</td>
        </tr>
        <tr v-for="(row, i) in rows" v-else :key="row.id || row.user_id || i">
          <slot :row="row" :index="i" />
        </tr>
      </tbody>
    </table>
    <div v-if="total > pageSize" class="pager">
      <button :disabled="page <= 1" @click="$emit('update:page', page - 1)">上一页</button>
      <span
        >第 {{ page }} 页 / 共 {{ Math.max(1, Math.ceil(total / pageSize)) }} 页（{{
          total
        }}
        条）</span
      >
      <button :disabled="page * pageSize >= total" @click="$emit('update:page', page + 1)">
        下一页
      </button>
    </div>
  </div>
</template>

<style scoped>
.table-wrap {
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.table th,
.table td {
  padding: 10px 14px;
  text-align: left;
  border-bottom: 1px solid var(--color-border);
}
.table th {
  background: var(--color-bg-muted);
  color: var(--color-text-muted);
  font-weight: 600;
}
.cell.muted {
  text-align: center;
  color: var(--color-text-faint);
  padding: 24px;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  font-size: 13px;
  color: var(--color-text-muted);
}
.pager button {
  border: 1px solid var(--color-border);
  background: #fff;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.pager button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
