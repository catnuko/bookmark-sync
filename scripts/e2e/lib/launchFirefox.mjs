/**
 * e2e/lib/launchFirefox.mjs — 启动真实 Firefox（Xvfb 有头模式）并加载扩展。
 *
 * 与 Chromium 的 launch.mjs 对应：Firefox 无 CDP，走 geckodriver + WebDriver
 * BiDi（geckodriver 0.36 默认支持；Firefox 129+ 默认开启 BiDi）。
 *
 * 关键适配：
 * - 扩展加载：geckodriver capability `moz:install-temporary-extension`（临时安装，
 *   等价 about:debugging 的「临时加载附加组件」）。
 * - 扩展 id：临时扩展的 moz-extension:// id 默认随机；通过 pref
 *   `extensions.webextensions.uuids` 固定为 FF_EXT_UUID（自动化测试标准做法），
 *   这样 popup URL 稳定为 moz-extension://<uuid>/popup.html。
 * - popup URL 是 moz-extension://（不是 chrome-extension://）。
 *
 * 环境变量（均可覆盖）：
 *   FF_BIN            默认 /opt/ff/firefox/firefox
 *   GECKODRIVER_BIN   默认 /home/user/tools/geckodriver
 *   FF_EXT_DIR        默认 <repo>/extension-firefox（pnpm build:firefox 产物）
 *   GECKO_PORT        默认 9444（geckodriver 端口）
 *   FF_PROFILE_DIR    默认 <repo>/e2e/.ff-profiles/<port>
 *   DISPLAY           默认 :99（Xvfb）
 */
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bidi, sleep } from './bidi.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const GECKODRIVER_BIN = process.env.GECKODRIVER_BIN ?? '/home/user/tools/geckodriver';
// /opt 只读（容器无 root）→ 放用户目录；可用 FF_BIN 覆盖
const DEFAULT_FF_BIN = process.env.FF_BIN ?? '/home/user/tools/ff/firefox/firefox';
/** 固定扩展 UUID（moz-extension://<uuid>/ 的 host），避免临时扩展 id 随机。 */
export const FF_EXT_UUID = process.env.FF_EXT_UUID ?? '11111111-1111-1111-1111-111111111111';

export async function launchFirefox({
  port = 9346,
  geckoPort = 9444,
  bidiPort = 9446,
  profileDir,
  extDir,
  binary,
  display = ':99',
  extraExtensions = [],
} = {}) {
  const FF_BIN = binary ?? DEFAULT_FF_BIN;
  const EXT_DIR = extDir ?? process.env.FF_EXT_DIR ?? join(ROOT, 'extension-firefox');
  const PROFILE_DIR =
    profileDir ?? process.env.FF_PROFILE_DIR ?? join(ROOT, 'e2e', '.ff-profiles', String(port));
  if (!existsSync(FF_BIN))
    throw new Error(`Firefox 二进制不存在: ${FF_BIN}（先下载并解压，见 e2e/README.md）`);
  if (!existsSync(EXT_DIR))
    throw new Error(`扩展目录不存在: ${EXT_DIR}（先运行 pnpm build:firefox）`);

  mkdirSync(PROFILE_DIR, { recursive: true });
  // 清空旧 profile 锁（Firefox 退出残留会导致 "profile in use"）
  for (const f of ['lock', 'parent.lock', '.parentlock'])
    rmSync(join(PROFILE_DIR, f), { force: true });
  // 清理占用同一 geckoPort 的残留 geckodriver（异常退出会留下孤儿进程）
  try {
    execSync(
      `ps -eo pid,args | grep "geckodriver.*--port=${geckoPort}" | grep -v grep | awk '{print $1}' | xargs -r kill 2>/dev/null || true`,
    );
  } catch {}
  await sleep(500);

  // 1) 启动 geckodriver。注意 --websocket-port：BiDi WebSocket 默认绑定 9222，
  //    本环境 9222 被环境浏览器占用，必须显式换端口（否则 BiDi 服务起不来，
  //    webSocketUrl 连不上）。
  const gd = spawn(
    GECKODRIVER_BIN,
    [`--port=${geckoPort}`, `--websocket-port=${bidiPort}`, '--log', 'warn'],
    {
      env: { ...process.env, DISPLAY: display },
      stdio: 'ignore',
      detached: true,
    },
  );
  gd.unref();
  await waitForHttp(`http://127.0.0.1:${geckoPort}/status`, 20000);

  // 2) 创建 WebDriver 会话（无扩展；扩展通过 classic 端点安装）
  const body = {
    capabilities: {
      alwaysMatch: {
        browserName: 'firefox',
        webSocketUrl: true,
        'moz:firefoxOptions': {
          binary: FF_BIN,
          args: ['-no-remote', '-profile', PROFILE_DIR],
          prefs: {
            'extensions.autoDisableScopes': 0,
            'xpinstall.signatures.required': false,
            'extensions.webextensions.uuids': JSON.stringify({
              'bookmark-sync@bookmarksync.app': FF_EXT_UUID,
            }),
            'browser.startup.page': 0,
            'browser.shell.checkDefaultBrowser': false,
            'browser.aboutwelcome.enabled': false,
            'datareporting.policy.dataSubmissionEnabled': false,
          },
        },
      },
    },
  };
  const res = await fetch(`http://127.0.0.1:${geckoPort}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const sess = await res.json();
  if (!res.ok || !sess.value?.sessionId) {
    throw new Error(`Firefox 会话创建失败: ${JSON.stringify(sess).slice(0, 600)}`);
  }
  const { sessionId, capabilities } = sess.value;
  const wsUrl = capabilities?.webSocketUrl;
  if (!wsUrl)
    throw new Error(
      `无 webSocketUrl（geckodriver 需支持 BiDi）: ${JSON.stringify(sess.value).slice(0, 400)}`,
    );

  // 3) 安装临时扩展（WebDriver classic 端点；返回扩展 id）
  const installAddon = async (dir) => {
    const inst = await fetch(
      `http://127.0.0.1:${geckoPort}/session/${sessionId}/moz/addon/install`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dir, temporary: true }),
      },
    );
    const instJson = await inst.json();
    if (!inst.ok) {
      throw new Error(`扩展安装失败 ${dir}: ${JSON.stringify(instJson).slice(0, 500)}`);
    }
    return instJson.value;
  };
  const addonId = await installAddon(EXT_DIR);
  console.log(`[ff-launch] addon installed id=${addonId}`);
  const extraIds = [];
  for (const dir of extraExtensions) {
    if (!existsSync(dir)) throw new Error(`额外扩展目录不存在: ${dir}`);
    const id = await installAddon(dir);
    extraIds.push(id);
    console.log(`[ff-launch] extra addon installed id=${id}`);
  }

  const bidi = new Bidi(wsUrl);
  console.log(`[ff-launch] session=${sessionId} bidi=${wsUrl}`);
  await bidi.open();
  console.log(`[ff-launch] geckodriver pid=${gd.pid} port=${geckoPort} profile=${PROFILE_DIR}`);
  return {
    sessionId,
    bidi,
    wsUrl,
    gdPid: gd.pid,
    profileDir: PROFILE_DIR,
    extDir: EXT_DIR,
    extUuid: FF_EXT_UUID,
    addonId,
    extraIds,
  };
}

async function waitForHttp(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
      lastErr = new Error(`status ${r.status}`);
    } catch (e) {
      lastErr = e;
    }
    await sleep(400);
  }
  throw new Error(`HTTP 端口未就绪 ${url}: ${lastErr}`);
}
