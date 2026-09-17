<script setup>
// 用户详情：profile + 订阅 + 空间 + 设备 + 最近订单；支持改 plan / 重置用量
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { adminApi } from "../lib/client.js";
import StatusBadge from "../components/StatusBadge.vue";
import {
  formatBytes, formatCount, formatTime, planLabel, planTone,
  orderStatusMeta, subStatusMeta,
} from "../lib/format.js";

const route = useRoute();
const data = ref(null);
const loading = ref(true);
const error = ref("");
const newPlan = ref("");

onMounted(async () => {
  try {
    data.value = await adminApi.getUser(route.params.id);
    newPlan.value = data.value.profile?.plan || "free";
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
});

async function savePlan() {
  if (!confirm(`确认将该用户 plan 改为 ${newPlan.value}？`)) return;
  try {
    await adminApi.setUserPlan(route.params.id, newPlan.value);
    data.value = await adminApi.getUser(route.params.id);
  } catch (e) {
    alert(e.message);
  }
}

async function resetUsage() {
  if (!confirm("确认清零该用户的 used_bytes / used_count？（客服补偿用）")) return;
  try {
    await adminApi.resetUsage(route.params.id);
    data.value = await adminApi.getUser(route.params.id);
  } catch (e) {
    alert(e.message);
  }
}

const clearing = ref(false);
const clearMsg = ref("");

async function clearUserData() {
  if (clearMsg.value) clearMsg.value = "";
  const first = confirm(
    `确认清空 ${data.value?.email ?? "该用户"} 的全部云端同步数据？\n\n将删除：空间、操作日志、快照、设备登记，并重置 E2EE 盐与用量。\n此操作不可恢复！`
  );
  if (!first) return;
  const second = confirm("再次确认：该用户的同步数据将被永久删除，仅保留浏览器本地的书签。确定继续？");
  if (!second) return;
  try {
    clearing.value = true;
    const r = await adminApi.resetUserData(route.params.id);
    data.value = await adminApi.getUser(route.params.id);
    clearMsg.value = `已清空 ${r?.email ?? ""}：空间 ${r?.spaces ?? 0} 个、操作日志 ${r?.op_log ?? 0} 条、快照 ${r?.snapshots ?? 0} 份、设备 ${r?.devices ?? 0} 台。`;
  } catch (e) {
    alert(e.message);
  } finally {
    clearing.value = false;
  }
}
</script>

<template>
  <div class="page">
    <RouterLink to="/admin/users" class="back">← 返回用户列表</RouterLink>
    <h2 v-if="data">{{ data.email }}</h2>
    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="loading">加载中…</p>

    <template v-else-if="data">
      <div class="cols">
        <section class="card">
          <h3>档案</h3>
          <p>plan：<StatusBadge :label="planLabel(data.profile?.plan)" :tone="planTone(data.profile?.plan)" /></p>
          <p>用量：{{ formatBytes(data.profile?.used_bytes) }} / {{ formatBytes(data.profile?.quota_bytes) }}</p>
          <p>条数：{{ formatCount(data.profile?.used_count) }}</p>
          <p>购买时间：{{ formatTime(data.profile?.purchased_at) }}</p>
          <p>E2EE salt：{{ data.profile?.e2ee_salt ? "已设置" : "未设置（未开启口令模式）" }}</p>
          <div class="actions">
            <select v-model="newPlan">
              <option value="free">free</option>
              <option value="plus">plus</option>
              <option value="pro">pro</option>
              <option value="lifetime">lifetime</option>
            </select>
            <button class="btn" @click="savePlan">保存 plan</button>
            <button class="btn-danger" @click="resetUsage">重置用量</button>
          </div>
        </section>

        <section class="card">
          <h3>订阅</h3>
          <p v-if="!data.subscription" class="muted">无订阅（free 用户）</p>
          <template v-else>
            <p>状态：<StatusBadge :label="subStatusMeta(data.subscription.status).label" :tone="subStatusMeta(data.subscription.status).tone" /></p>
            <p>plan：{{ data.subscription.plan }}</p>
            <p>当前周期截止：{{ formatTime(data.subscription.current_period_end) }}</p>
            <p class="muted">creem_customer_id：{{ data.subscription.creem_customer_id || "—" }}</p>
          </template>
        </section>
      </div>

      <div class="cols">
        <section class="card">
          <h3>空间（{{ data.spaces?.length || 0 }}）</h3>
          <table class="mini">
            <thead><tr><th>名称</th><th>默认</th><th>op 数</th><th>设备数</th><th>创建</th></tr></thead>
            <tbody>
              <tr v-for="s in data.spaces" :key="s.id">
                <td>{{ s.name }}<span v-if="s.is_default" class="tag">default</span></td>
                <td>{{ s.is_default ? "✓" : "" }}</td>
                <td>{{ formatCount(s.op_count) }}</td>
                <td>{{ s.device_count }}</td>
                <td>{{ formatTime(s.created_at) }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="card">
          <h3>设备（{{ data.devices?.length || 0 }}）</h3>
          <table class="mini">
            <thead><tr><th>名称</th><th>空间</th><th>最后在线</th></tr></thead>
            <tbody>
              <tr v-for="d in data.devices" :key="d.id">
                <td>{{ d.name || "(未命名)" }}</td>
                <td>{{ d.space_name }}</td>
                <td>{{ formatTime(d.last_seen_at) }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <section class="card">
        <h3>最近订单（{{ data.recent_orders?.length || 0 }}）</h3>
        <table class="mini">
          <thead><tr><th>时间</th><th>plan</th><th>金额</th><th>状态</th></tr></thead>
          <tbody>
            <tr v-for="o in data.recent_orders" :key="o.id">
              <td>{{ formatTime(o.created_at) }}</td>
              <td>{{ o.plan }}</td>
              <td>{{ o.amount_cents ? (o.amount_cents/100).toFixed(2) + ' ' + o.currency : "—" }}</td>
              <td><StatusBadge :label="orderStatusMeta(o.status).label" :tone="orderStatusMeta(o.status).tone" /></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="card danger">
        <h3>危险操作：清空测试数据</h3>
        <p class="muted">
          清空该用户在云端的全部同步数据（空间 / 操作日志 / 快照 / 设备）并重置 E2EE 盐与用量，
          仅保留浏览器本地的书签。用于测试账号清理，不可恢复。
        </p>
        <div class="actions">
          <button class="btn-danger" :disabled="clearing" @click="clearUserData">
            {{ clearing ? "清空中…" : "一键清空该用户的同步数据" }}
          </button>
        </div>
        <p v-if="clearMsg" class="clear-msg">{{ clearMsg }}</p>
      </section>

      <p class="notice">⚠ 书签内容为端到端加密，后台不展示、也无法解密。</p>
    </template>
  </div>
</template>

<style scoped>
.back { font-size: 13px; color: var(--color-text-muted); text-decoration: none; }
h2 { margin: 8px 0 16px; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
.card { background: #fff; border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 16px; margin-bottom: 14px; }
.card h3 { margin: 0 0 10px; font-size: 14px; }
.card p { margin: 4px 0; font-size: 13px; }
.mini { width: 100%; border-collapse: collapse; font-size: 13px; }
.mini th, .mini td { padding: 6px 8px; border-bottom: 1px solid var(--color-border); text-align: left; }
.actions { margin-top: 10px; display: flex; gap: 8px; align-items: center; }
.actions select { padding: 5px 8px; border: 1px solid var(--color-border); border-radius: 6px; }
.btn { padding: 6px 14px; background: var(--color-accent); color: #fff; border: 0; border-radius: 6px; cursor: pointer; }
.btn-danger { padding: 6px 14px; background: #b91c1c; color: #fff; border: 0; border-radius: 6px; cursor: pointer; }
.muted { color: var(--color-text-faint); }
.card.danger { border-color: #fca5a5; background: #fff7f7; }
.card.danger h3 { color: #b91c1c; }
.clear-msg { margin-top: 10px; font-size: 13px; color: #15803d; }
.tag { font-size: 11px; color: var(--color-text-faint); margin-left: 6px; }
.err { color: #b91c1c; }
.notice { background: #fffbeb; border: 1px solid #fde68a; padding: 10px 14px; border-radius: 6px; font-size: 13px; color: #92400e; }
@media (max-width: 900px) { .cols { grid-template-columns: 1fr; } }
</style>
