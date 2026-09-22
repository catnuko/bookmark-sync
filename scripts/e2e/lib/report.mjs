/**
 * e2e/lib/report.mjs — 步骤记账与结果报告。
 *
 * 设计要点：**断言不抛异常**。E2E 里一步失败往往会让后面几步连锁失败，抛异常只能
 * 看到第一个错，而排障时最想看的是「哪几步坏了、坏成什么样」。所以每一步都记一条
 * 结果（ok / fail / info），跑完一次性打印，退出码由 fail 条数决定。
 *
 * 只有「前置无法建立」这种根本性情况才提前中止（比如云端不是干净起点）。
 */
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadEnvFile } from './env.mjs';

const ENV_FILE = loadEnvFile();

/**
 * 读一个整数配置，优先级与 env.mjs 保持一致：
 * `process.env` > `.workbuddy/e2e.env` > `fallback`。
 * **必须显式读 env 文件** —— 它只被解析成对象，并不会注入 `process.env`，
 * 否则写在 e2e.env 里的值会被静默忽略。空串按「没设置」处理（`Number('')` 是 0，
 * 会悄悄变成「永不裁剪」这种反直觉行为）。
 */
function envInt(key, fallback) {
  const raw = process.env[key] ?? ENV_FILE[key];
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** 每个场景保留最近多少份报告（`0` = 不裁剪）。 */
const KEEP_PER_SCENARIO = envInt('E2E_KEEP_REPORTS', 5);

/**
 * 裁掉每个场景只留最近 N 份报告。
 *
 * 为什么需要：报告文件只增不减（一次跑一份），而**默认清理会删掉 profile 现场** ——
 * 失败时这份 JSON 往往是仅存的证据，所以不能「跑完就删」；但不清理又会无限堆积
 * （2026-09-22 一看已攒了 33 份，其中只有 3 份是当次跑的）。
 * 文件名形如 `<场景>-<YYYY-MM-DDTHH-MM-SS>.json`，ISO 时间戳**字典序即时间序**，
 * 所以直接按字符串倒序排即可，不用 stat。场景名里本身含 `-`（如 two-device-sync），
 * 故必须从右侧锚定时间戳解析，不能按第一个 `-` 切。
 */
export function pruneReports(dir, keep) {
  if (!Number.isFinite(keep) || keep <= 0) return 0;
  let byScenario;
  try {
    byScenario = new Map();
    for (const f of readdirSync(dir)) {
      const m = /^(.+)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.json$/.exec(f);
      if (!m) continue;
      if (!byScenario.has(m[1])) byScenario.set(m[1], []);
      byScenario.get(m[1]).push({ f, stamp: m[2] });
    }
  } catch {
    return 0; // 目录都读不了就没什么可裁的
  }
  let removed = 0;
  for (const list of byScenario.values()) {
    list.sort((a, b) => (a.stamp < b.stamp ? 1 : -1)); // 新 → 旧
    for (const { f } of list.slice(keep)) {
      try {
        rmSync(join(dir, f));
        removed++;
      } catch {
        /* 被环境拦下（企业策略 / 沙箱批量删除守卫）不该影响测试结论 */
      }
    }
  }
  return removed;
}

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

export function createReport(title) {
  const rows = [];
  const t0 = Date.now();

  const push = (kind, name, detail) => rows.push({ kind, name, detail: detail ?? '' });

  return {
    section: (name) => push('section', name),
    info: (name, detail) => push('info', name, detail),
    ok: (name, detail) => push('ok', name, detail),
    fail: (name, detail) => push('fail', name, detail),

    /** 断言：条件为假记 fail 并返回 false（不抛）。 */
    assert(name, cond, detail = '') {
      if (cond) push('ok', name, detail);
      else push('fail', name, detail);
      return !!cond;
    },

    /** 相等断言，detail 里带上「期望 / 实际」，省去人工比对。 */
    equals(name, actual, expected, extra = '') {
      const same = actual === expected;
      const d = same
        ? `${JSON.stringify(actual)}${extra ? ` ${extra}` : ''}`
        : `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}${extra ? ` ${extra}` : ''}`;
      return this.assert(name, same, d);
    },

    get failures() {
      return rows.filter((r) => r.kind === 'fail');
    },

    /** 打印 + 写 JSON 报告；返回退出码（0 = 全绿）。 */
    finish({ scenario, extra = {} } = {}) {
      const dur = ((Date.now() - t0) / 1000).toFixed(1);
      const fails = this.failures;
      const lines = [];
      for (const r of rows) {
        if (r.kind === 'section') lines.push(`\n${C.bold}${C.cyan}▌ ${r.name}${C.reset}`);
        else if (r.kind === 'info')
          lines.push(`  ${C.dim}· ${r.name}${r.detail ? `: ${r.detail}` : ''}${C.reset}`);
        else if (r.kind === 'ok')
          lines.push(
            `  ${C.green}✓${C.reset} ${r.name}${r.detail ? ` ${C.dim}${r.detail}${C.reset}` : ''}`,
          );
        else lines.push(`  ${C.red}✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}${C.reset}`);
      }
      const verdict = fails.length
        ? `${C.red}${C.bold}失败 ${fails.length} 项${C.reset}`
        : `${C.green}${C.bold}全部通过${C.reset}`;
      lines.push('');
      lines.push(`${C.bold}${title}${C.reset} — ${verdict} ${C.dim}(${dur}s)${C.reset}`);

      const out = lines.join('\n');
      console.log(out);

      try {
        const dir = join(ROOT, 'scripts', 'e2e', '.reports');
        mkdirSync(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const path = join(dir, `${scenario ?? 'run'}-${stamp}.json`);
        writeFileSync(
          path,
          JSON.stringify(
            { scenario, durationSec: Number(dur), failures: fails.length, rows, extra },
            null,
            2,
          ),
        );
        console.log(`${C.dim}报告: ${path}${C.reset}`);
        const pruned = pruneReports(dir, KEEP_PER_SCENARIO);
        if (pruned) {
          console.log(
            `${C.dim}（已清理 ${pruned} 份历史报告，每场景保留最近 ${KEEP_PER_SCENARIO} 份）${C.reset}`,
          );
        }
      } catch (e) {
        console.log(`${C.dim}(报告写入失败: ${e.message})${C.reset}`);
      }

      return fails.length ? 1 : 0;
    },
  };
}
