<script setup>
// 反馈与错误上报：两个 tab 共用一个页面。
//   · 反馈（0045 的 bsync_feedback）：用户主动提交，可标记处理状态（写审计）。
//   · 错误上报（0042 的 bsync_error_reports）：插件自动上报，此前只写不读，这里补上读取。
// 两者数据形状与操作不同，故各自持有 rows/total/page/filters（切 tab 懒加载）。
import { onMounted, ref, watch } from 'vue';
import { adminApi } from '../lib/client.js';
import DataTable from '../components/DataTable.vue';
import StatusBadge from '../components/StatusBadge.vue';
import {
  formatTime,
  timeAgo,
  formatCount,
  formatAuditDetail,
  feedbackKindMeta,
  feedbackStatusMeta,
} from '../lib/format.js';

const tab = ref('feedback');

const STATUS_OPTIONS = [
  { value: 'new', label: '待处理' },
  { value: 'read', label: '已读' },
  { value: 'resolved', label: '已处理' },
  { value: 'wontfix', label: '不处理' },
];

const pageSize = 50;

// ---------- tab 1：反馈 ----------
const fbRows = ref([]);
const fbTotal = ref(0);
const fbLoading = ref(false);
const fbPage = ref(1);
const fbStatus = ref('');
const fbKind = ref('');
const fbBusy = ref(false);
const fbDetail = ref(null);

const KIND_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'bug', label: '问题' },
  { value: 'idea', label: '建议' },
  { value: 'other', label: '其他' },
];

async function loadFeedback() {
  fbLoading.value = true;
  try {
    const res = await adminApi.listFeedback({
      status: fbStatus.value || null,
      kind: fbKind.value || null,
      limit: pageSize,
      offset: (fbPage.value - 1) * pageSize,
    });
    fbRows.value = res.rows || [];
    fbTotal.value = res.total || 0;
  } catch (e) {
    alert(e.message);
  } finally {
    fbLoading.value = false;
  }
}

async function setStatus(row, status) {
  if (status === row.status) return;
  if (!confirm(`确认把这条反馈标记为「${feedbackStatusMeta(status).label}」？`)) {
    return;
  }
  fbBusy.value = true;
  try {
    await adminApi.setFeedbackStatus(row.id, status);
    if (fbDetail.value?.id === row.id) fbDetail.value.status = status;
    await loadFeedback();
  } catch (e) {
    alert(e.message);
    await loadFeedback(); // 失败时回滚下拉框显示
  } finally {
    fbBusy.value = false;
  }
}

// ---------- tab 2：错误上报 ----------
const erRows = ref([]);
const erTotal = ref(0);
const erLoading = ref(false);
const erPage = ref(1);
const erPhase = ref('');
const erVersion = ref('');
const erGroup = ref('row');
const erLoaded = ref(false);
const erDetail = ref(null);
const erDetailLoading = ref(false);

const GROUP_OPTIONS = [
  { value: 'row', label: '按时间' },
  { value: 'fingerprint', label: '按指纹聚合' },
];

async function loadErrors() {
  erLoading.value = true;
  try {
    const res = await adminApi.listErrorReports({
      phase: erPhase.value || null,
      appVersion: erVersion.value || null,
      group: erGroup.value,
      limit: pageSize,
      offset: (erPage.value - 1) * pageSize,
    });
    erRows.value = res.rows || [];
    erTotal.value = res.total || 0;
    erLoaded.value = true;
  } catch (e) {
    alert(e.message);
  } finally {
    erLoading.value = false;
  }
}

async function openErrorDetail(row) {
  erDetailLoading.value = true;
  erDetail.value = { id: row.id, phase: row.phase };
  try {
    erDetail.value = await adminApi.getErrorReport(row.id);
  } catch (e) {
    alert(e.message);
    erDetail.value = null;
  } finally {
    erDetailLoading.value = false;
  }
}

onMounted(loadFeedback);
watch([fbPage, fbStatus, fbKind], loadFeedback);
watch([erPage, erPhase, erVersion, erGroup], loadErrors);
// 懒加载：切到错误 tab 才拉第一次（之后由上面的 watch 负责）
watch(tab, (t) => {
  if (t === 'errors' && !erLoaded.value) loadErrors();
});
</script>

<template>
  <div class="page">
    <div class="bar">
      <h2>反馈</h2>
      <div class="tabs">
        <button :class="{ active: tab === 'feedback' }" @click="tab = 'feedback'">用户反馈</button>
        <button :class="{ active: tab === 'errors' }" @click="tab = 'errors'">错误上报</button>
      </div>
    </div>

    <!-- ============ 用户反馈 ============ -->
    <template v-if="tab === 'feedback'">
      <div class="filters">
        <select v-model="fbStatus" @change="fbPage = 1">
          <option value="">全部状态</option>
          <option v-for="o in STATUS_OPTIONS" :key="o.value" :value="o.value">
            {{ o.label }}
          </option>
        </select>
        <select v-model="fbKind" @change="fbPage = 1">
          <option v-for="o in KIND_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>
      <p class="muted">
        用户在插件内主动提交的反馈。环境列（版本 / 浏览器 / 语言 / 错误阶段）由插件自动附带，
        绝不含书签内容。
      </p>

      <DataTable
        :loading="fbLoading"
        :rows="fbRows"
        :total="fbTotal"
        :page="fbPage"
        :page-size="pageSize"
        @update:page="fbPage = $event"
      >
        <template #head>
          <th>时间</th>
          <th>类型</th>
          <th>内容</th>
          <th>提交者</th>
          <th>环境</th>
          <th>状态</th>
          <th>标记</th>
        </template>
        <template #default="{ row }">
          <td class="nowrap">{{ formatTime(row.created_at) }}</td>
          <td>
            <StatusBadge
              :label="feedbackKindMeta(row.kind).label"
              :tone="feedbackKindMeta(row.kind).tone"
            />
          </td>
          <td class="body-cell">
            <span class="body-preview">{{ row.body }}</span>
            <button class="link" @click="fbDetail = row">查看</button>
          </td>
          <td>{{ row.email || '—' }}</td>
          <td class="env">{{ row.app_version || '—' }} · {{ row.platform || '—' }}</td>
          <td>
            <StatusBadge
              :label="feedbackStatusMeta(row.status).label"
              :tone="feedbackStatusMeta(row.status).tone"
            />
          </td>
          <td>
            <select
              :value="row.status"
              :disabled="fbBusy"
              @change="setStatus(row, $event.target.value)"
            >
              <option v-for="o in STATUS_OPTIONS" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </select>
          </td>
        </template>
        <template #card="{ row }">
          <article class="card">
            <div class="c-head">
              <StatusBadge
                :label="feedbackKindMeta(row.kind).label"
                :tone="feedbackKindMeta(row.kind).tone"
              />
              <StatusBadge
                :label="feedbackStatusMeta(row.status).label"
                :tone="feedbackStatusMeta(row.status).tone"
              />
              <span class="c-time">{{ formatTime(row.created_at) }}</span>
            </div>
            <p class="c-body">{{ row.body }}</p>
            <div class="c-row">
              <span class="c-k">提交者</span><span>{{ row.email || '—' }}</span>
            </div>
            <div class="c-row">
              <span class="c-k">环境</span>
              <span>{{ row.app_version || '—' }} · {{ row.platform || '—' }}</span>
            </div>
            <div class="c-actions">
              <button class="link" @click="fbDetail = row">查看详情</button>
              <select
                :value="row.status"
                :disabled="fbBusy"
                @change="setStatus(row, $event.target.value)"
              >
                <option v-for="o in STATUS_OPTIONS" :key="o.value" :value="o.value">
                  {{ o.label }}
                </option>
              </select>
            </div>
          </article>
        </template>
      </DataTable>
    </template>

    <!-- ============ 错误上报 ============ -->
    <template v-else>
      <div class="filters">
        <select v-model="erGroup" @change="erPage = 1">
          <option v-for="o in GROUP_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <input
          v-model.trim="erPhase"
          placeholder="phase（如 sync）"
          @keyup.enter="
            erPage = 1;
            loadErrors();
          "
        />
        <input
          v-model.trim="erVersion"
          placeholder="版本（如 2.7.0）"
          @keyup.enter="
            erPage = 1;
            loadErrors();
          "
        />
        <button
          class="btn"
          @click="
            erPage = 1;
            loadErrors();
          "
        >
          筛选
        </button>
      </div>
      <p class="muted">
        插件自动上报的同步错误元数据（0042）。只有错误类型与调用阶段，不含书签内容。
        「按指纹聚合」按总次数排序，用于判断哪个错误影响面最大。
      </p>

      <DataTable
        :loading="erLoading"
        :rows="erRows"
        :total="erTotal"
        :page="erPage"
        :page-size="pageSize"
        @update:page="erPage = $event"
      >
        <template #head>
          <th>最后出现</th>
          <th>次数</th>
          <th v-if="erGroup === 'fingerprint'">影响用户</th>
          <th>阶段</th>
          <th>原因</th>
          <th>错误</th>
          <th>消息</th>
          <th>版本 / 平台</th>
          <th v-if="erGroup === 'row'">用户</th>
          <th v-if="erGroup === 'row'"></th>
        </template>
        <template #default="{ row }">
          <td class="nowrap">{{ timeAgo(row.last_seen_at) }}</td>
          <td>{{ formatCount(row.occurrences) }}</td>
          <td v-if="erGroup === 'fingerprint'">{{ formatCount(row.user_count) }}</td>
          <td class="nowrap">{{ row.phase }}</td>
          <td class="nowrap">{{ row.reason }}</td>
          <td class="nowrap">{{ row.error_name || '—' }}</td>
          <td class="body-cell">
            <span class="body-preview">{{ row.error_message || '—' }}</span>
          </td>
          <td class="env">{{ row.app_version || '—' }} · {{ row.platform || '—' }}</td>
          <td v-if="erGroup === 'row'">{{ row.email || '—' }}</td>
          <td v-if="erGroup === 'row'">
            <button class="link" @click="openErrorDetail(row)">详情</button>
          </td>
        </template>
        <template #card="{ row }">
          <article class="card">
            <div class="c-head">
              <span class="c-time">{{ timeAgo(row.last_seen_at) }}</span>
              <span class="c-badge">{{ formatCount(row.occurrences) }} 次</span>
              <span v-if="erGroup === 'fingerprint'" class="c-badge">
                {{ formatCount(row.user_count) }} 人
              </span>
            </div>
            <div class="c-row">
              <span class="c-k">阶段</span><span>{{ row.phase }} / {{ row.reason }}</span>
            </div>
            <div class="c-row">
              <span class="c-k">错误</span><span>{{ row.error_name || '—' }}</span>
            </div>
            <p class="c-body">{{ row.error_message || '—' }}</p>
            <div class="c-actions">
              <span class="c-k">{{ row.app_version || '—' }} · {{ row.platform || '—' }}</span>
              <button v-if="erGroup === 'row'" class="link" @click="openErrorDetail(row)">
                详情
              </button>
            </div>
          </article>
        </template>
      </DataTable>
    </template>

    <!-- 反馈详情 -->
    <div v-if="fbDetail" class="overlay" @click.self="fbDetail = null">
      <div class="modal">
        <div class="m-head">
          <h3>反馈详情</h3>
          <button class="link" @click="fbDetail = null">关闭</button>
        </div>
        <div class="m-meta">
          <StatusBadge
            :label="feedbackKindMeta(fbDetail.kind).label"
            :tone="feedbackKindMeta(fbDetail.kind).tone"
          />
          <StatusBadge
            :label="feedbackStatusMeta(fbDetail.status).label"
            :tone="feedbackStatusMeta(fbDetail.status).tone"
          />
          <span>{{ formatTime(fbDetail.created_at) }}</span>
        </div>
        <pre class="m-body">{{ fbDetail.body }}</pre>
        <div class="m-row">
          <span class="c-k">提交者</span><span>{{ fbDetail.email || '—' }}</span>
        </div>
        <div class="m-row">
          <span class="c-k">回信邮箱</span
          ><span>{{ fbDetail.contact_email || '（未填，无法回复）' }}</span>
        </div>
        <div class="m-row">
          <span class="c-k">环境</span>
          <span>
            {{ fbDetail.app_version || '—' }} · {{ fbDetail.platform || '—' }} ·
            {{ fbDetail.locale || '—' }} · 错误阶段 {{ fbDetail.last_error_phase || '—' }}
          </span>
        </div>
        <div class="m-actions">
          <button
            v-for="o in STATUS_OPTIONS"
            :key="o.value"
            class="btn"
            :class="{ primary: o.value === fbDetail.status }"
            :disabled="fbBusy"
            @click="setStatus(fbDetail, o.value)"
          >
            {{ o.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- 错误上报详情 -->
    <div v-if="erDetail" class="overlay" @click.self="erDetail = null">
      <div class="modal">
        <div class="m-head">
          <h3>错误详情</h3>
          <button class="link" @click="erDetail = null">关闭</button>
        </div>
        <p v-if="erDetailLoading" class="muted">加载中…</p>
        <template v-else>
          <div class="m-row">
            <span class="c-k">阶段 / 原因</span
            ><span>{{ erDetail.phase }} / {{ erDetail.reason }}</span>
          </div>
          <div class="m-row">
            <span class="c-k">错误</span><span>{{ erDetail.error_name || '—' }}</span>
          </div>
          <div class="m-row">
            <span class="c-k">用户</span><span>{{ erDetail.email || '—' }}</span>
          </div>
          <div class="m-row">
            <span class="c-k">版本 / 平台</span>
            <span>{{ erDetail.app_version || '—' }} · {{ erDetail.platform || '—' }}</span>
          </div>
          <div class="m-row">
            <span class="c-k">次数 / 区间</span>
            <span>
              {{ formatCount(erDetail.occurrences) }} 次 ·
              {{ formatTime(erDetail.first_seen_at) }} →
              {{ formatTime(erDetail.last_seen_at) }}
            </span>
          </div>
          <div class="m-row">
            <span class="c-k">指纹</span><span class="mono">{{ erDetail.fingerprint }}</span>
          </div>
          <h4>错误消息</h4>
          <pre class="m-body">{{ erDetail.error_message || '—' }}</pre>
          <h4>调用栈</h4>
          <pre class="m-body">{{ erDetail.error_stack || '（无）' }}</pre>
          <h4>上下文</h4>
          <pre class="m-body">{{ formatAuditDetail(erDetail.context) }}</pre>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
h2 {
  margin: 0;
}
.bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.tabs {
  display: flex;
  gap: 6px;
}
.tabs button {
  padding: 6px 14px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}
.tabs button.active {
  background: var(--color-text);
  color: #fff;
  border-color: var(--color-text);
}
.filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.filters select,
.filters input {
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
}
.btn {
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}
.btn.primary {
  background: var(--color-text);
  color: #fff;
  border-color: var(--color-text);
}
.muted {
  font-size: 12.5px;
  color: var(--color-text-faint);
  margin: 0 0 12px;
}
.nowrap {
  white-space: nowrap;
}
.env {
  font-size: 12px;
  color: var(--color-text-soft);
  white-space: nowrap;
}
.body-cell {
  max-width: 320px;
}
.body-preview {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}
.link {
  border: none;
  background: none;
  color: var(--color-accent, #2563eb);
  cursor: pointer;
  padding: 0 0 0 6px;
  font-size: 12.5px;
  white-space: nowrap;
}
td select {
  padding: 4px 6px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 12.5px;
}

/* 移动端卡片 */
.card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  font-size: 13px;
}
.c-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.c-time,
.c-badge {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-left: auto;
}
.c-badge {
  margin-left: 0;
}
.c-body {
  margin: 6px 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color-text-soft);
}
.c-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 0;
}
.c-k {
  color: var(--color-text-muted);
  flex: none;
}
.c-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--color-border);
}

/* 弹窗 */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 50;
}
.modal {
  background: #fff;
  border-radius: var(--radius-md);
  padding: 18px 20px;
  width: min(720px, 100%);
  max-height: 85vh;
  overflow-y: auto;
  font-size: 13px;
}
.m-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.m-head h3 {
  margin: 0;
}
.m-head .link {
  padding: 0;
}
.m-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  color: var(--color-text-muted);
  font-size: 12.5px;
}
.m-body {
  background: var(--color-bg-muted);
  border-radius: 6px;
  padding: 10px 12px;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12.5px;
  line-height: 1.6;
  margin: 6px 0 10px;
  font-family: var(--font-mono);
}
.m-row {
  display: flex;
  gap: 12px;
  padding: 3px 0;
}
.m-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
}
.mono {
  font-family: var(--font-mono);
  word-break: break-all;
}
h4 {
  margin: 12px 0 0;
  font-size: 13px;
}
</style>
