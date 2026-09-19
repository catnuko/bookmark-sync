/**
 * e2e/lib/launch.mjs — 启动真实 Chromium（Xvfb 有头模式）并加载本扩展。
 *
 * 环境变量（均可覆盖）：
 *   CHROME_BIN   默认 /usr/local/bin/chromium
 *   EXT_DIR      默认 <repo>/extension（pnpm package 产物）
 *   CDP_PORT     默认 9345
 *   PROFILE_DIR  默认 <repo>/e2e/.profiles/<port>（脚本自动创建）
 *   DISPLAY      默认 :99（Xvfb）
 *
 * 注意事项（真实环境踩过的坑）：
 * - 必须 DISPLAY=:99（Xvfb），--headless=new 下扩展 SW 加载不稳
 * - 启动前删除 profile 下的 Singleton*，否则 "Failed to create ProcessSingleton"
 * - 浏览器进程独立于脚本存活；结束测试用 kill-chromium.sh 或自行 kill
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function launchChromium({ port, profileDir, extDir, chromeBin } = {}) {
  const CDP_PORT = port ?? Number(process.env.CDP_PORT ?? 9345);
  const CHROME_BIN = chromeBin ?? process.env.CHROME_BIN ?? '/usr/local/bin/chromium';
  const EXT_DIR = extDir ?? process.env.EXT_DIR ?? join(ROOT, 'extension');
  const PROFILE_DIR = profileDir ?? process.env.PROFILE_DIR ?? join(ROOT, 'e2e', '.profiles', String(CDP_PORT));
  const DISPLAY = process.env.DISPLAY ?? ':99';

  if (!existsSync(EXT_DIR)) {
    throw new Error(`扩展目录不存在: ${EXT_DIR}（先运行 pnpm package）`);
  }
  mkdirSync(PROFILE_DIR, { recursive: true });
  // SingletonLock 残留会导致启动失败
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    rmSync(join(PROFILE_DIR, f), { force: true });
  }

  const args = [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions-except=' + EXT_DIR,
    '--load-extension=' + EXT_DIR,
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--window-size=1440,900',
  ];
  const child = spawn(CHROME_BIN, args, {
    env: { ...process.env, DISPLAY },
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  console.log(`[launch] chromium pid=${child.pid} port=${CDP_PORT} profile=${PROFILE_DIR}`);
  return { pid: child.pid, port: CDP_PORT, profileDir: PROFILE_DIR, extDir: EXT_DIR };
}
