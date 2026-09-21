/**
 * e2e/lib/report.mjs — 步骤记账与结果报告。
 *
 * 设计要点：**断言不抛异常**。E2E 里一步失败往往会让后面几步连锁失败，抛异常只能
 * 看到第一个错，而排障时最想看的是「哪几步坏了、坏成什么样」。所以每一步都记一条
 * 结果（ok / fail / info），跑完一次性打印，退出码由 fail 条数决定。
 *
 * 只有「前置无法建立」这种根本性情况才提前中止（比如云端不是干净起点）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './env.mjs';

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
        else if (r.kind === 'info') lines.push(`  ${C.dim}· ${r.name}${r.detail ? `: ${r.detail}` : ''}${C.reset}`);
        else if (r.kind === 'ok') lines.push(`  ${C.green}✓${C.reset} ${r.name}${r.detail ? ` ${C.dim}${r.detail}${C.reset}` : ''}`);
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
          JSON.stringify({ scenario, durationSec: Number(dur), failures: fails.length, rows, extra }, null, 2),
        );
        console.log(`${C.dim}报告: ${path}${C.reset}`);
      } catch (e) {
        console.log(`${C.dim}(报告写入失败: ${e.message})${C.reset}`);
      }

      return fails.length ? 1 : 0;
    },
  };
}
