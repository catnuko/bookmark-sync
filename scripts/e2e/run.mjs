#!/usr/bin/env node
/**
 * scripts/e2e/run.mjs — 本地端到端测试入口（macOS / Linux 通用，无头真实 Chrome）。
 *
 * 用法：
 *   node scripts/e2e/run.mjs                       # 跑默认场景（phrase-gate）
 *   node scripts/e2e/run.mjs phrase-gate --fresh   # 先复位云端测试数据再从头跑
 *   node scripts/e2e/run.mjs phrase-gate --headed  # 有头（看着它点，排障用）
 *   node scripts/e2e/run.mjs reset                 # 只复位（云端 + 本机 profile），不跑场景
 *   node scripts/e2e/run.mjs clean                 # 只杀残留的 E2E Chrome + 删 profile 目录
 *   node scripts/e2e/run.mjs list                  # 列出可用场景
 *
 * 设计约束（为什么不是「一个大脚本」）：
 *   - 场景自带前置检查，前置不成立时**显式失败**，绝不给空洞的绿；
 *   - 跑场景时默认不动云端数据；只有显式 `--fresh` / `reset` 才会写云端；
 *   - **跑完默认清理**：无论成功还是失败都复位云端 + 删本机 profile，跑完不留残留；
 *     要留着现场排障时加 `--no-cleanup`；
 *   - 一台设备一个 profile，跑完即删（--keep-profiles 保留目录，便于复现现场）。
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { getConfig, requireCredentials, ROOT, ENV_PATH } from './lib/env.mjs';
import { createReport } from './lib/report.mjs';
import * as cloud from './lib/cloud.mjs';

const SCENARIO_DIR = join(ROOT, 'scripts', 'e2e', 'scenarios');

async function loadScenarios() {
  const out = [];
  for (const f of readdirSync(SCENARIO_DIR)) {
    if (!f.endsWith('.mjs') || f.startsWith('_')) continue;
    const mod = await import(join(SCENARIO_DIR, f));
    if (mod?.meta?.name && typeof mod.run === 'function') out.push(mod);
  }
  return out;
}

/**
 * 删 profile 根目录。删除可能被环境拦下（企业策略 / 沙箱对批量递归删除的拦截），
 * 那种情况下只警告——它不该让一次已经跑完的测试变成失败。
 * @returns {{ok:boolean, reason?:string}}
 */
function dropProfiles(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e.message).split('\n')[0].slice(0, 120) };
  }
}

/** 构建产物比源码旧 → 提醒（不自动 build，避免脚本偷偷改工作区）。 */
function checkBuildFreshness(cfg) {
  const bg = join(cfg.extDir, 'background.js');
  if (!existsSync(bg)) return `扩展产物不存在：${cfg.extDir}/background.js —— 先跑 npx vite build`;
  const built = statSync(bg).mtimeMs;
  const srcDir = join(ROOT, 'src');
  let newest = 0;
  let newestFile = '';
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const m = statSync(p).mtimeMs;
        if (m > newest) {
          newest = m;
          newestFile = p;
        }
      }
    }
  };
  walk(srcDir);
  if (newest > built) {
    return `扩展产物可能过期：${newestFile.replace(ROOT + '/', '')} 比 extension/background.js 新 —— 建议先 npx vite build`;
  }
  return null;
}

async function main() {
  const scenarioArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const scenarios = await loadScenarios();
  const cfg = getConfig();

  if (scenarioArg === 'list') {
    console.log('可用场景：');
    for (const s of scenarios) console.log(`  ${s.meta.name.padEnd(14)} ${s.meta.describe}`);
    return 0;
  }

  const stale = checkBuildFreshness(cfg);
  if (stale) {
    console.log(`\x1b[33m⚠ ${stale}\x1b[0m`);
    if (!existsSync(join(cfg.extDir, 'background.js'))) return 1;
  }

  if (scenarioArg === 'reset') {
    if (!cloud.cliAvailable()) {
      console.error('找不到 supabase CLI，无法复位云端');
      return 1;
    }
    const uid = cloud.userIdFor(cfg.email);
    const prof = cloud.profile(uid);
    if (!prof) {
      console.error('云端没有 profile（该账号从没登录过扩展？）');
      return 1;
    }
    console.log(`复位测试账号 ${prof.email}：云端（op/快照/设备/空间/盐）+ 本机 profile …`);
    cloud.resetUser(uid);
    const dropped = dropProfiles(cfg.profileRoot);
    const after = cloud.profile(uid);
    const st = cloud.opStats(uid);
    const spacesLeft = cloud.spaces(uid);
    const ok = !after?.e2ee_salt && st.ops === 0 && spacesLeft.length === 0;
    console.log(
      ok ? '\x1b[32m✓ 已回到干净起点\x1b[0m' : '\x1b[31m✗ 复位后云端仍有残留，请检查\x1b[0m',
    );
    if (!dropped.ok) {
      console.log(
        `\x1b[33m⚠ 本机 profile 没能删除（${dropped.reason}）—— 不影响云端复位，下次跑会另开新目录\x1b[0m`,
      );
    }
    return ok ? 0 : 1;
  }

  if (scenarioArg === 'clean') {
    // 只杀「用本 harness 的 profile 目录」起的 Chrome：命令行里带 --user-data-dir=<profileRoot>。
    // 你日常 Chrome 没有这个参数，绝不会被误伤（这也是之前探针进程残留的教训）。
    // 注意用 `ps` 全量扫而不是 `pgrep -f <前缀>`：清空失败时会轮换出 `.profiles.<ts>/`
    // 兄弟目录，只匹配原路径会漏掉那些进程。
    let pids = [];
    try {
      pids = execFileSync('ps', ['-eo', 'pid=,command='], { encoding: 'utf8' })
        .split('\n')
        .filter((l) => l.includes(`--user-data-dir=${cfg.profileRoot}`))
        .map((l) => Number(l.trim().split(/\s+/)[0]))
        .filter(Boolean);
    } catch {
      /* ps 不可用就当没匹配 */
    }
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* 可能已退出 */
      }
    }
    // SIGTERM 不等人：给 400ms 让 Chrome 自己收尾，再对剩下的补 SIGKILL。
    if (pids.length) {
      await new Promise((r) => setTimeout(r, 400));
      for (const pid of pids) {
        try {
          process.kill(pid, 0); // 还活着？
          process.kill(pid, 'SIGKILL');
        } catch {
          /* 已退出 */
        }
      }
    }

    // profileRoot 一删到底（清空失败时轮换出来的 `.profiles/<name>.<ts>` 就在它下面，
    // 跟着一起没了）。
    const dropped = dropProfiles(cfg.profileRoot);
    console.log(
      dropped.ok
        ? `已清理 E2E Chrome 进程 ${pids.length} 个，profile 目录已删`
        : `已清理 E2E Chrome 进程 ${pids.length} 个；profile 目录删除失败：${dropped.reason}`,
    );
    return 0;
  }

  const scenario = scenarios.find((s) => s.meta.name === (scenarioArg ?? scenarios[0].meta.name));
  if (!scenario) {
    console.error(
      `未知场景：${scenarioArg}\n可用：${scenarios.map((s) => s.meta.name).join(', ')}`,
    );
    return 1;
  }

  requireCredentials(cfg);

  const report = createReport(scenario.meta.describe);
  console.log(
    `\n\x1b[1mE2E: ${scenario.meta.name}\x1b[0m  \x1b[2m${scenario.meta.describe}\x1b[0m`,
  );
  console.log(
    `\x1b[2m配置: 账号=${cfg.email} · 扩展=${cfg.extDir.replace(ROOT + '/', '')} · ${cfg.headless ? '无头' : '有头'}` +
      ` · profile=${cfg.profileRoot.replace(ROOT + '/', '')}${cfg.fresh ? ' · --fresh' : ''}\x1b[0m`,
  );
  if (!existsSync(ENV_PATH)) {
    console.log(
      `\x1b[2m（提示：凭据来自环境变量；把 EMAIL/PASSWORD 写进 .workbuddy/e2e.env 可免每次导出）\x1b[0m`,
    );
  }

  let extra = {};
  let exitCode = 1;
  try {
    extra = (await scenario.run({ cfg, report })) ?? {};
  } catch (e) {
    report.fail('场景中止', e.message);
  }

  // 跑完**一律**复位云端 + 删本机 profile（成功或失败都清；`--no-cleanup` 保留现场排障）。
  // 场景中途抛错时拿不到它 return 的 extra，所以退回用 email 定位账号 —— 否则
  // 「跑挂了 → 云端留一堆残留 → 下次跑必须 --fresh --allow-destroy」这套摩擦会劝退人。
  let cleanupUserId = extra?.userId ?? null;
  if (cfg.cleanup && !cleanupUserId) {
    try {
      cleanupUserId = cloud.userIdFor(cfg.email);
    } catch {
      cleanupUserId = null; // 账号都定位不到（比如 email 配错了），那也没什么可清的
    }
  }
  if (cfg.cleanup && cleanupUserId) {
    try {
      cloud.resetUser(cleanupUserId);
      const dropped = dropProfiles(cfg.profileRoot);
      report.info(
        '--cleanup',
        dropped.ok ? '已复位云端与本机 profile' : `已复位云端；profile 未删掉（${dropped.reason}）`,
      );
    } catch (e) {
      report.fail('--cleanup 复位失败', e.message);
    }
  }

  exitCode = report.finish({ scenario: scenario.meta.name, extra });
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('\x1b[31m未捕获错误:\x1b[0m', e);
    process.exit(1);
  });
