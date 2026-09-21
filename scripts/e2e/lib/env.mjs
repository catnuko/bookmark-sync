/**
 * e2e/lib/env.mjs — E2E 配置读取。
 *
 * 凭据不进仓库：从 `.workbuddy/e2e.env`（已在 .gitignore 里）读，其次环境变量。
 * 优先级：process.env > .workbuddy/e2e.env > 内置默认值（仅非敏感项）。
 * 敏感项（EMAIL / PASSWORD）缺失时**立刻报错并给出模板路径**，不允许静默跳过
 * ——静默跳过会退化成「测试跑过了但什么都没测」。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根目录（本文件位于 scripts/e2e/lib/）。 */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const ENV_PATH = join(ROOT, '.workbuddy', 'e2e.env');

/** 极简 KEY=VALUE 解析（支持 # 注释、引号包裹）。 */
export function loadEnvFile(path = ENV_PATH) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/** 解析命令行参数（`--fresh` / `--headed` / `--keep-profiles` / `--ext=path`）。 */
export function parseArgs(argv) {
  const flags = new Set();
  const opts = {};
  const rest = [];
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v === undefined) flags.add(k);
      else opts[k] = v;
    } else {
      rest.push(a);
    }
  }
  return { flags, opts, rest };
}

export function getConfig(argv = process.argv.slice(2)) {
  const file = loadEnvFile();
  const { flags, opts } = parseArgs(argv);
  const pick = (key, fallback) => process.env[key] ?? file[key] ?? fallback;

  const cfg = {
    email: pick('E2E_EMAIL'),
    password: pick('E2E_PASSWORD'),
    /** 口令门禁用的口令（≥8 字符，派生 PBKDF2 210k 次，别用真口令）。 */
    passphrase: pick('E2E_PASSPHRASE', 'bsync-e2e-passphrase-2026'),
    /** 扩展产物目录。 */
    extDir: opts.ext ?? pick('EXT_DIR', join(ROOT, 'extension')),
    /** profile 根目录（每次跑默认清掉，除非 --keep-profiles）。 */
    profileRoot: pick('PROFILE_DIR', join(ROOT, 'scripts', 'e2e', '.profiles')),
    /** CI / 无头环境默认无头；--headed 覆盖。 */
    headless: flags.has('headed') ? false : pick('E2E_HEADLESS', '1') !== '0',
    keepProfiles: flags.has('keep-profiles') || pick('E2E_KEEP_PROFILES', '') === '1',
    fresh: flags.has('fresh'),
    /** --fresh 要清掉**非空**云端数据时的第二把钥匙（防止顺手清掉手工测试数据）。 */
    allowDestroy: flags.has('allow-destroy'),
    /** 跑完把云端与本机 profile 复位，方便连跑。 */
    cleanup: flags.has('cleanup'),
    /** 口令派生一次 210k 次 PBKDF2，慢；给足超时。 */
    timeouts: {
      boot: Number(pick('E2E_BOOT_MS', 45_000)),
      gate: Number(pick('E2E_GATE_MS', 40_000)),
      sync: Number(pick('E2E_SYNC_MS', 90_000)),
    },
  };
  return cfg;
}

/** 校验必需配置；缺失直接抛错（不静默降级）。 */
export function requireCredentials(cfg) {
  const missing = [];
  if (!cfg.email) missing.push('E2E_EMAIL');
  if (!cfg.password) missing.push('E2E_PASSWORD');
  if (missing.length) {
    throw new Error(
      `缺少测试账号凭据：${missing.join(', ')}\n` +
        `  复制模板：cp scripts/e2e/e2e.env.example .workbuddy/e2e.env\n` +
        `  然后填入（.workbuddy/ 已被 gitignore，不会进仓库）`,
    );
  }
}
