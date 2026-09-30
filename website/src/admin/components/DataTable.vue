<script setup>
// 通用数据表格：表头插槽 + 行插槽 + 分页。
// ≤768px：若调用方提供了 #card 插槽，则改为渲染卡片列表（scope 同 #default：{ row, index }），
// 否则表格自身横向滚动。卡片内部样式由调用方的 scoped style 负责。
defineProps({
  loading: { type: Boolean, default: false },
  rows: { type: Array, default: () => [] },
  total: { type: Number, default: 0 },
  page: { type: Number, default: 1 },
  pageSize: { type: Number, default: 50 },
  emptyText: { type: String, default: '暂无数据' },
});
defineEmits(['update:page']);

function rowKey(row, i) {
  return row.id || row.user_id || i;
}
</script>

<template>
  <div class="table-wrap" :class="{ 'has-cards': !!$slots.card }">
    <div class="table-scroll">
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
          <tr v-for="(row, i) in rows" v-else :key="rowKey(row, i)">
            <slot :row="row" :index="i" />
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="$slots.card" class="cards">
      <p v-if="loading" class="cards-msg">加载中…</p>
      <p v-else-if="!rows.length" class="cards-msg">{{ emptyText }}</p>
      <template v-else>
        <template v-for="(row, i) in rows" :key="rowKey(row, i)">
          <slot name="card" :row="row" :index="i" />
        </template>
      </template>
    </div>

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
.table-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
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
  white-space: nowrap;
}
.cell.muted {
  text-align: center;
  color: var(--color-text-faint);
  padding: 24px;
}
/* 卡片容器：仅移动端可见（见下方 media query），桌面端不渲染（v-if $slots.card）时也不存在 */
.cards {
  display: none;
}
.cards-msg {
  text-align: center;
  color: var(--color-text-faint);
  padding: 24px;
  font-size: 13px;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
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

@media (max-width: 768px) {
  .has-cards .table-scroll {
    display: none;
  }
  .has-cards .cards {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
  }
  .table th,
  .table td {
    padding: 8px 10px;
  }
  .pager {
    flex-wrap: wrap;
    padding: 10px 12px;
  }
  .pager button {
    min-height: 40px;
    padding: 4px 14px;
  }
}
</style>
