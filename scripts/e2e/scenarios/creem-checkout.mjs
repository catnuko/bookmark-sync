/**
 * scenarios/creem-checkout.mjs — Creem **live** 收银台链路（真钱通道，但本场景不付款）。
 *
 * 为什么值得单独一条：支付链路的 test / live 差异**全在边缘函数的 secrets 里**
 * （`CREEM_API_BASE` / `CREEM_API_KEY` / `CREEM_PRODUCT_*`），插件侧零分支 ——
 * 也就是说「secrets 还是测试值」这种事故在单元测试、类型检查、构建里全都看不出来，
 * 只有真去点一次订阅才暴露。这条场景就是那个探针。
 *
 * 锁死的回归点：
 *   1. 插件点「订阅 Plus」能真的拿到 checkout_url（边缘函数 + Creem API 全通）；
 *   2. 收银台是 **live** 域名，不是 test 域名（secrets 被改回测试值 → 这里红）；
 *   3. 收银台对应的产品就是 **live 的 Plus 产品**（产品 id 配错 → 这里红）；
 *   4. 失败路径不出现（没有「创建支付会话失败」toast，弹窗正常关闭）。
 *
 * 安全边界：**只创建收银台会话，绝不付款**。Creem 的 checkout 会话不付款就不产生
 * 任何资金流动与订阅；页面停在收银台即可，浏览器关掉即消失。
 * 副作用只有一条：Creem 后台会多一条 abandoned 的 checkout 记录。
 *
 * 前置：升级入口只在 `quotaBtn === 'upgrade'`（plan 为空/free）时渲染，而 e2e 账号
 * 是 pro（bind-gate 场景依赖付费档才给「新建空间」）。所以本场景**临时**把该账号的
 * plan 压成 free，`finally` 里按原值还原 —— 账号状态必须可逆，否则会污染后续场景。
 *
 * 可选 `CREEM_API_KEY`：给了就反查会话详情，把「产品对不对」钉到服务端数据；
 * 不给则退化为「从 checkout_url 里找产品 id」。
 */
import { join } from 'node:path';
import { launchDevice } from '../lib/chrome.mjs';
import { reachMain } from '../lib/helpers.mjs';
import { sleep } from '../lib/cdp.mjs';
import * as cloud from '../lib/cloud.mjs';

const PORT = 9343;
const CREEM_API_KEY = process.env.CREEM_API_KEY ?? '';
const CREEM_API_BASE = process.env.CREEM_API_BASE ?? 'https://api.creem.io';

/**
 * live 产品 id（Creem 后台「产品」页可查）。
 * 测试模式有**另一套** id —— 两套混用是「付了钱但没开通」的经典成因，所以这里以环境变量
 * 注入期望值，而不是从 secrets 读（从 secrets 读就变成自证了）。
 * 本地注入方式：在 .dev-creds.json / e2e.env（均 gitignore）里配 CREEM_PRODUCT_PLUS / CREEM_PRODUCT_PRO。
 */
export const LIVE_PRODUCT_ID = {
  plus: process.env.CREEM_PRODUCT_PLUS ?? 'prod_PLUS_ID_PLACEHOLDER',
  pro: process.env.CREEM_PRODUCT_PRO ?? 'prod_PRO_ID_PLACEHOLDER',
};

export const meta = {
  name: 'creem-checkout',
  describe: 'Creem live 收银台（真边缘函数 + 真 Creem API）：插件点订阅 → 拿到 live checkout_url',
  needsCloud: true,
};

async function listTargets(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/list`);
  return r.ok ? await r.json() : [];
}

/** 轮询调试端口，等扩展用 `chrome.tabs.create` 开出来的收银台标签。 */
async function waitCheckoutTab(port, timeoutMs = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = (await listTargets(port)).find(
      (t) => t.type === 'page' && /(^|\.)creem\.io\//.test(t.url),
    );
    if (hit) return hit.url;
    await sleep(500);
  }
  return null;
}

/** 反查会话详情（只读）。失败不抛 —— 它是加强断言，不是主断言。 */
async function fetchCheckout(checkoutId) {
  if (!CREEM_API_KEY || !checkoutId) return null;
  try {
    const r = await fetch(
      `${CREEM_API_BASE}/v1/checkouts?checkout_id=${encodeURIComponent(checkoutId)}`,
      { headers: { 'x-api-key': CREEM_API_KEY }, signal: AbortSignal.timeout(15_000) },
    );
    return r.ok ? await r.json() : { httpStatus: r.status };
  } catch (e) {
    return { error: e.message };
  }
}

export async function run({ cfg, report }) {
  const extra = {};
  let dev = null;
  let uid = null;
  let originalPlan = null;

  try {
    if (!cloud.cliAvailable()) throw new Error('找不到 supabase CLI（本场景要临时改 plan）');
    uid = cloud.userIdFor(cfg.email);
    const prof = cloud.profile(uid);
    if (!prof) throw new Error('云端没有 profile —— 测试账号还没登录过扩展？');
    originalPlan = prof.plan;
    extra.userId = uid;
    extra.originalPlan = originalPlan;
    report.info('测试账号', `${prof.email}（原 plan=${originalPlan}）`);

    // 升级入口只在 free 档渲染（见文件头注）
    if (originalPlan !== 'free') {
      cloud.exec(`update public.bsync_profiles set plan = 'free' where user_id = '${uid}'`);
      report.info('临时把 plan 压成 free', '为了拿到「升级」入口，跑完还原');
    }

    report.section('起设备 → 过门禁 → 进主界面');
    dev = await launchDevice({
      name: 'creem',
      port: PORT,
      profileDir: join(cfg.profileRoot, 'creem'),
      extDir: cfg.extDir,
      headless: cfg.headless,
      freshProfile: !cfg.keepProfiles,
      bootTimeoutMs: cfg.timeouts.boot,
    });

    // reachMain 会顺手过掉口令门禁与首绑门禁
    const { page, trail } = await reachMain(dev, cfg, report);
    extra.gateTrail = trail;

    // ------------------------------------------------------------ 打开升级弹窗
    report.section('点「升级」→「订阅 Plus」→ 等收银台标签');
    const upgradeLabel = await dev.i18n('common_upgrade');
    const upgradeVisible = await page.waitUntil(
      async (pg) =>
        (await pg.tryEval(`!![...document.querySelectorAll('[data-test="quota"] button')]
             .find((b) => b.innerText.includes(${JSON.stringify(upgradeLabel)}))`)) === true
          ? true
          : null,
      { timeoutMs: 20_000, intervalMs: 400 },
    );
    report.assert(
      `配额卡渲染出「${upgradeLabel}」入口（plan=free 才有）`,
      !!upgradeVisible,
      (await page.text()).split('\n').filter(Boolean).slice(0, 10).join(' | '),
    );

    await page.clickByText('[data-test="quota"] button', upgradeLabel);
    const modalOk = await page.waitForSelector('[data-test="upgrade-modal"]', 10_000);
    report.assert(`点「${upgradeLabel}」后弹出订阅弹窗`, modalOk);
    if (!modalOk) {
      report.fail('订阅弹窗里的 Plus 按钮（未执行）', '弹窗没打开，后续断言会退化');
      return extra;
    }

    const plusLabel = await dev.i18n('plan_subPlus');
    report.info('点 Plus 按钮', plusLabel);
    await page.clickByText('[data-test="plan-plus"] button', plusLabel);

    // ------------------------------------------------------------ 收银台
    report.section('收银台');
    const checkoutUrl = await waitCheckoutTab(PORT, 30_000);
    const opened = report.assert(
      '扩展打开了 Creem 收银台标签（边缘函数返回了 checkout_url）',
      !!checkoutUrl,
      checkoutUrl ?? '30s 内没出现 creem.io 标签 —— 边缘函数大概率报错了',
    );
    if (!opened) {
      const t = await page.text();
      report.info('弹窗文案（排障用）', t.split('\n').filter(Boolean).slice(-8).join(' | '));
      return extra;
    }
    extra.checkoutUrl = checkoutUrl;

    // live vs test：Creem 的测试收银台走 test 域名，live 走主域名
    const host = new URL(checkoutUrl).host;
    report.assert(
      '收银台是 live 域名（secrets 没被退回测试值）',
      !/test/i.test(host),
      `host=${host}`,
    );

    // ------------------------------------------------------------ 产品对不对
    const idFromUrl = /prod_[A-Za-z0-9]+/.exec(checkoutUrl)?.[0] ?? null;
    const checkoutId = /ch_[A-Za-z0-9]+/.exec(checkoutUrl)?.[0] ?? null;
    if (idFromUrl) {
      report.equals('收银台 URL 指向 live Plus 产品', idFromUrl, LIVE_PRODUCT_ID.plus);
    } else {
      report.info('收银台 URL 里没有产品 id', '改从 Creem API 反查会话详情');
    }

    const detail = await fetchCheckout(checkoutId);
    if (detail && !detail.error && !detail.httpStatus) {
      // product 在 Creem 的响应里有时是展开对象、有时是纯 id 字符串（与 order 同理），
      // 三种形态都认，否则会得到「实际 null」这种看不出原因的假红。
      const productId =
        typeof detail.product === 'string'
          ? detail.product
          : (detail.product?.id ?? detail.order?.product ?? detail.product_id ?? null);
      report.equals('Creem API 反查：会话产品 = live Plus', productId, LIVE_PRODUCT_ID.plus);
      report.equals('Creem API 反查：会话 mode = prod', detail.mode, 'prod');
      extra.checkoutId = detail.id ?? checkoutId;
      extra.checkoutProductShape = typeof detail.product;
    } else {
      report.info(
        '未做 Creem API 反查',
        CREEM_API_KEY
          ? `会话 id=${checkoutId ?? '(URL 里没有)'} / 反查结果=${JSON.stringify(detail).slice(0, 120)}`
          : '没给 CREEM_API_KEY',
      );
    }

    // ------------------------------------------------------------ 失败路径
    report.section('失败路径不该出现');
    const modalGone = await page.waitUntil(
      async (pg) => ((await pg.exists('[data-test="upgrade-modal"]')) ? null : true),
      { timeoutMs: 10_000, intervalMs: 300 },
    );
    report.assert('成功路径：订阅弹窗自动关闭', !!modalGone, '弹窗仍在 = 可能走了失败分支');

    const failText = await dev.i18n('pay_checkoutFail');
    const pageText = await page.text();
    report.assert(
      `界面上没有「${failText}」提示`,
      !pageText.includes(failText),
      pageText.includes(failText) ? '出现失败 toast' : '',
    );

    return extra;
  } finally {
    if (dev) await dev.close({ keepProfile: cfg.keepProfiles }).catch(() => {});
    // plan 还原必须在最外层：中途抛错也不能把账号留在 free
    if (uid && originalPlan && originalPlan !== 'free') {
      try {
        cloud.exec(
          `update public.bsync_profiles set plan = '${originalPlan}' where user_id = '${uid}'`,
        );
        const back = cloud.profile(uid);
        if (back?.plan !== originalPlan) {
          report.fail('还原账号 plan', `期望 ${originalPlan}，实际 ${back?.plan}`);
        } else {
          report.info('账号 plan 已还原', back.plan);
        }
      } catch (e) {
        report.fail('还原账号 plan 失败', e.message);
      }
    }
  }
}
