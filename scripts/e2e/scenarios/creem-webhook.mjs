/**
 * scenarios/creem-webhook.mjs — Creem webhook 的**验签 + 落库**链路（用 live 密钥）。
 *
 * 为什么需要它：收银台那条（`creem-checkout`）只证明「钱能收」，证明不了「收到钱之后
 * 服务端会开通」。webhook 是唯一的开通写路径，它坏了的表现是——用户付了钱、插件里
 * 还是 FREE。而这条链路里最脆的两处（HMAC 验签口径、`onConflict` 需要的唯一约束）
 * 单测都覆盖不到：前者要真发一次带签名的请求，后者要真连一次线上 schema。
 *
 * 签名口径按 Creem 官方文档（https://docs.creem.io/code/webhooks）：
 *   hex(HMAC-SHA256(rawBody, webhookSecret))，放在 `creem-signature` 头。
 *   **secret 原样使用，不做 base64 解码** —— 这条是「所有线上 webhook 全 401」的
 *   经典成因，所以这里按文档口径独立实现一份，不 import 被测代码（否则是自证）。
 *
 * 请求从**扩展的 Service Worker** 发出：它的 host_permissions 覆盖
 * `https://*.supabase.co/*`，所以能真连上边缘函数并读回状态码；本机 shell 走
 * 不通那个域名（沙箱 / 出网策略），浏览器页面走 CORS 也会被拦（webhook 函数
 * 不返回 CORS 头，预检就挂）。
 *
 * 需要 `CREEM_WEBHOOK_SECRET`（live 后台「设置 → 网络钩子」里的签名密钥）。
 * 缺失直接失败，不给空洞的绿。
 *
 * 副作用与还原：会**临时**把 e2e 账号的 plan/quota 改成 plus/20MiB、并插入一条
 * 订阅与若干订单（id 都带 `_e2e` 前缀）。中途还会把这条订阅的账期改到过去、调用
 * 迁移 0044 的兜底函数（`bsync_expire_subscriptions`）验证到期降级。`finally` 里
 * 按原值还原并删掉这些行，中途抛错也生效。
 */
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { launchDevice } from '../lib/chrome.mjs';
import { reachMain } from '../lib/helpers.mjs';
import * as cloud from '../lib/cloud.mjs';

const PORT = 9344;
const PROJECT_REF = process.env.SUPABASE_PROJECT ?? 'cwtqnsbpcetvqopdkcou';
const WEBHOOK_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/bsync-creem-webhook`;
const WEBHOOK_SECRET = process.env.CREEM_WEBHOOK_SECRET ?? '';
const PLUS_PRODUCT = process.env.CREEM_PRODUCT_PLUS ?? 'prod_PLUS_ID_PLACEHOLDER';
/** 与 bsync-creem-webhook 的 PLAN_QUOTA_BYTES 对齐（0035 校准：plus 20MiB） */
const PLUS_QUOTA_BYTES = 20 * 1024 * 1024;

export const meta = {
  name: 'creem-webhook',
  describe:
    'Creem webhook（live 密钥）：验签 + 落订阅/订单 + 翻档；错签被拒；乱序重投不回退订阅状态与账期；取消但未到期不得提前降级；退款翻成 refunded',
  needsCloud: true,
};

/** Creem 文档口径：hex(HMAC-SHA256(rawBody, secret))，secret 原样使用。 */
function sign(rawBody) {
  return createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
}

/**
 * 造一条 checkout.completed：字段形状照抄 Creem 文档样例
 * （https://docs.creem.io/code/webhooks 的 Sample Request Body）。
 * 关键：object 是「收银台会话」不是「订阅」——它有收银台自己的 `status: "completed"`，
 * 也有顶层 metadata；`subscription` 在样例里是**展开对象**（带自己的 status）。
 */
function makeCheckoutEvent(uid, stamp) {
  const ids = {
    sub: `sub_e2e_${stamp}`,
    cus: `cus_e2e_${stamp}`,
    ord: `ord_e2e_${stamp}`,
    chk: `ch_e2e_${stamp}`,
  };
  const body = JSON.stringify({
    id: `evt_chk_e2e_${stamp}`,
    eventType: 'checkout.completed',
    created_at: Date.now(),
    object: {
      id: ids.chk,
      object: 'checkout',
      subscription: {
        id: ids.sub,
        object: 'subscription',
        status: 'active',
        metadata: { user_id: uid, plan: 'plus' },
      },
      // 收银台生命周期状态 —— 不是订阅状态，别让它落到 bsync_subscriptions.status
      status: 'completed',
      order: { id: ids.ord, object: 'order', amount: 2000, currency: 'USD', status: 'paid' },
      product: { id: PLUS_PRODUCT, object: 'product' },
      customer: { id: ids.cus, object: 'customer' },
      metadata: { user_id: uid, plan: 'plus' },
      mode: 'local',
    },
  });
  return { ids, body };
}

/** 造一条 subscription.active：object 是「订阅」，带账期（checkout 上没有这个字段）。 */
function makeSubActiveEvent(uid, stamp, ids, periodEnd) {
  return JSON.stringify({
    id: `evt_sub_e2e_${stamp}`,
    eventType: 'subscription.active',
    created_at: Date.now(),
    object: {
      id: ids.sub,
      object: 'subscription',
      status: 'active',
      customer: { id: ids.cus, object: 'customer' },
      product: { id: PLUS_PRODUCT, object: 'product' },
      current_period_end_date: periodEnd,
      canceled_at: null,
      metadata: { user_id: uid, plan: 'plus' },
      mode: 'local',
    },
  });
}

/**
 * 造一条 subscription.canceled：**关键在账期**。
 * Creem 的 canceled 语义是「不再续费」，object 里 current_period_end_date 仍指向
 * 本期末（实测：客户门户取消于 2026-09-28，到期日 2027-09-28）。所以这个事件
 * **不能**被当成「立即失效」处理。
 */
function makeSubCanceledEvent(uid, stamp, ids, periodEnd, canceledAt) {
  return JSON.stringify({
    id: `evt_cancel_e2e_${stamp}`,
    eventType: 'subscription.canceled',
    created_at: Date.now(),
    object: {
      id: ids.sub,
      object: 'subscription',
      status: 'canceled',
      customer: { id: ids.cus, object: 'customer' },
      product: { id: PLUS_PRODUCT, object: 'product' },
      current_period_end_date: periodEnd,
      current_period_start_date: new Date(Date.now() - 864e5).toISOString(),
      canceled_at: canceledAt,
      metadata: { user_id: uid, plan: 'plus' },
      mode: 'local',
    },
  });
}

/**
 * 造一条 refund.created：**object 是「退款」不是「订阅」**。
 * 形状照抄 Creem 文档样例：订单号在 `object.transaction.order`（不是顶层 object.order），
 * 订阅以 `transaction.subscription`（字符串）与 `object.subscription`（展开对象，带
 * metadata）两处出现。原实现读 `obj.order` 且只认顶层 metadata → 事件被当「无关客户」
 * 丢弃，退款永远不入账（bsync_orders 停在 paid，退款被计成营收）。
 */
function makeRefundEvent(uid, stamp, ids) {
  return JSON.stringify({
    id: `evt_refund_e2e_${stamp}`,
    eventType: 'refund.created',
    created_at: Date.now(),
    object: {
      id: `ref_e2e_${stamp}`,
      object: 'refund',
      status: 'succeeded',
      refund_amount: 2000,
      refund_currency: 'USD',
      transaction: {
        id: `tran_e2e_${stamp}`,
        object: 'transaction',
        order: ids.ord,
        subscription: ids.sub,
      },
      subscription: {
        id: ids.sub,
        object: 'subscription',
        status: 'canceled',
        metadata: { user_id: uid, plan: 'plus' },
      },
    },
  });
}

/** 从扩展 SW 发一次带签名的 POST，读回状态码与响应体。 */
async function postFromSw(dev, body, signature) {
  return dev.swEval(`(async () => {
     const r = await fetch(${JSON.stringify(WEBHOOK_URL)}, {
       method: 'POST',
       headers: { 'content-type': 'application/json', 'creem-signature': ${JSON.stringify(signature)} },
       body: ${JSON.stringify(body)},
     });
     return { status: r.status, text: (await r.text()).slice(0, 300) };
   })()`);
}

/** PG 回读的时间戳格式与 ISO 不同，比「同一时刻」而不是比字符串。 */
const sameInstant = (a, b) =>
  !!a && !!b && Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 1000;

/**
 * 本场景要断言的字段（quota_bytes / purchased_at）不在 `cloud.profile()` 的
 * SELECT 里 —— 那是同步场景的摘要，加字段会影响四个既有场景，所以这里自己查。
 */
const profRow = (uid) =>
  cloud.sql(
    `select plan, quota_bytes, purchased_at from public.bsync_profiles where user_id = '${uid}' limit 1`,
  )[0] ?? null;

const subRow = (uid, subId) =>
  cloud.sql(
    `select status, plan, creem_subscription_id, creem_customer_id, current_period_end, canceled_at
       from public.bsync_subscriptions
      where user_id = '${uid}' and creem_subscription_id = '${subId}' limit 1`,
  )[0] ?? null;

const orderRow = (subId) =>
  cloud.sql(
    `select status, event_type, plan, creem_subscription_id
       from public.bsync_orders where creem_subscription_id = '${subId}' limit 1`,
  )[0] ?? null;

/** 按 Creem 订单号查（退款只改这一行的 status，subscription.* 事件没有 order 号）。 */
const orderByOrderId = (orderId) =>
  cloud.sql(
    `select status, event_type, creem_order_id
       from public.bsync_orders where creem_order_id = '${orderId}' limit 1`,
  )[0] ?? null;

export async function run({ cfg, report }) {
  const extra = {};
  let dev = null;
  let uid = null;
  let before = null;
  const created = [];

  try {
    if (!WEBHOOK_SECRET) {
      throw new Error(
        '缺少 CREEM_WEBHOOK_SECRET —— Creem 后台「设置 → 网络钩子 → 该端点 → 签名密钥」里取，\n' +
          '  然后：CREEM_WEBHOOK_SECRET=whsec_xxx node scripts/e2e/run.mjs creem-webhook',
      );
    }
    if (!cloud.cliAvailable()) throw new Error('找不到 supabase CLI（本场景要核对线上落库）');

    uid = cloud.userIdFor(cfg.email);
    before = profRow(uid);
    if (!before) throw new Error('云端没有 profile —— 测试账号还没登录过扩展？');
    extra.userId = uid;
    extra.beforePlan = before.plan;
    extra.beforeQuota = before.quota_bytes;
    report.info('测试账号', `${cfg.email}（plan=${before.plan} / quota=${before.quota_bytes}）`);
    report.info('webhook 端点', WEBHOOK_URL);

    const stamp = Date.now().toString(36);
    const { ids, body } = makeCheckoutEvent(uid, stamp);
    const periodEnd = new Date(Date.now() + 30 * 864e5).toISOString();
    const subBody = makeSubActiveEvent(uid, stamp, ids, periodEnd);
    extra.ids = ids;
    extra.periodEnd = periodEnd;
    created.push(ids);

    report.section('起设备（只为拿一个能连 supabase.co 的 Service Worker）');
    dev = await launchDevice({
      name: 'creem-wh',
      port: PORT,
      profileDir: join(cfg.profileRoot, 'creem-wh'),
      extDir: cfg.extDir,
      headless: cfg.headless,
      freshProfile: !cfg.keepProfiles,
      bootTimeoutMs: cfg.timeouts.boot,
    });
    await reachMain(dev, cfg, report);

    // ------------------------------------------------------------ 负控：错签必须被拒
    report.section('负控：错签名必须被拒且不落库');
    const bad = await postFromSw(dev, body, 'deadbeef');
    extra.badSignature = bad;
    report.equals('错签名返回 401', bad.status, 401);
    report.assert(
      '错签名响应体是 invalid_signature',
      String(bad.text).includes('invalid_signature'),
      String(bad.text).slice(0, 120),
    );
    report.assert(
      '错签名后没有写入订阅行',
      !subRow(uid, ids.sub),
      JSON.stringify(subRow(uid, ids.sub)),
    );
    report.equals('错签名后 plan 未变', profRow(uid)?.plan, before.plan);

    // ------------------------------------------------------------ 正控：真签必须通过
    report.section('正控：正确签名 → 落库 + 翻档');
    const good = await postFromSw(dev, body, sign(body));
    extra.goodSignature = good;
    report.equals('正确签名返回 200', good.status, 200);
    report.assert(
      '响应体是 {ok:true}',
      String(good.text).includes('"ok":true'),
      String(good.text).slice(0, 120),
    );

    const sub = subRow(uid, ids.sub);
    report.assert(
      '订阅行已落库（bsync_subscriptions）',
      !!sub,
      sub
        ? JSON.stringify(sub)
        : '没有该行 —— 付费用户将无法在 Creem 客户门户自助取消（portal 查不到 customer_id）',
    );
    if (sub) {
      // 收银台 object 上也有个 status，但那是收银台生命周期（"completed"），
      // 不能当订阅状态落库 —— 门户/官网/后台都按订阅状态展示。
      report.equals('订阅行 status = active（不是收银台的 completed）', sub.status, 'active');
      report.equals('订阅行 plan = plus', sub.plan, 'plus');
      report.equals('订阅行 customer_id 已记录', sub.creem_customer_id, ids.cus);
      report.info('checkout.completed 后 current_period_end', String(sub.current_period_end));
    }

    const order = orderRow(ids.sub);
    report.assert(
      '订单流水已落库（bsync_orders）',
      !!order,
      order ? JSON.stringify(order) : '没有该行',
    );
    if (order) report.equals('订单流水 status = paid', order.status, 'paid');

    const after = profRow(uid);
    report.equals('profile.plan 翻成 plus', after?.plan, 'plus');
    report.equals('profile.quota_bytes = 20MiB', after?.quota_bytes, PLUS_QUOTA_BYTES);
    report.assert('profile.purchased_at 已写入', !!after?.purchased_at, after?.purchased_at);

    // ------------------------------------------------- subscription.active：账期落库
    report.section('紧随的 subscription.active → 补上账期');
    const active = await postFromSw(dev, subBody, sign(subBody));
    extra.subActive = active;
    report.equals('subscription.active 返回 200', active.status, 200);
    const sub2 = subRow(uid, ids.sub);
    report.equals('订阅行 status 仍是 active', sub2?.status, 'active');
    report.assert(
      '订阅行 current_period_end 已记录（= 事件里的账期）',
      sameInstant(sub2?.current_period_end, periodEnd),
      `${sub2?.current_period_end} vs ${periodEnd}`,
    );

    // -------------------------------------------- 重投 checkout.completed（Creem 会重投）
    // 回归点：checkout.completed 的 object 上没有账期字段，若共享同一份 upsert payload，
    // 迟到的重投会把 subscription.active 刚写好的 current_period_end 抹成 null。
    report.section('重投 checkout.completed（乱序/重试）→ 不得回退订阅状态与账期');
    const replay = await postFromSw(dev, body, sign(body));
    extra.checkoutReplay = replay;
    report.equals('重投返回 200', replay.status, 200);
    const sub3 = subRow(uid, ids.sub);
    report.equals('重投后 status 未回退', sub3?.status, 'active');
    report.assert(
      '重投后 current_period_end 未被清空',
      sameInstant(sub3?.current_period_end, periodEnd),
      `${sub3?.current_period_end} vs ${periodEnd}`,
    );

    // -------------------------------------------- 退款：订单必须翻成 refunded
    // 回归点（线上真实事故）：refund.created 的 object 是「退款」，订单号在
    // object.transaction.order，metadata 挂在 object.subscription。原实现读 obj.order
    // 且只认顶层 metadata → 拿不到 user_id 直接 skipped:no_user，退款静默丢单，
    // bsync_orders 永远停在 paid（退款被当成营收）。
    report.section('退款（refund.created）→ 订单翻成 refunded，且事件能被定位到用户');
    const refundBody = makeRefundEvent(uid, stamp, ids);
    const refundRes = await postFromSw(dev, refundBody, sign(refundBody));
    extra.refund = refundRes;
    report.equals('refund.created 返回 200', refundRes.status, 200);
    report.assert(
      'refund.created 未被当成无关客户丢弃',
      !String(refundRes.text).includes('no_user'),
      String(refundRes.text).slice(0, 120),
    );
    const refunded = orderByOrderId(ids.ord);
    report.assert(
      '订单行已按订单号定位到（creem_order_id = transaction.order）',
      !!refunded,
      refunded ? JSON.stringify(refunded) : `没有 creem_order_id = ${ids.ord} 的订单行`,
    );
    report.equals('订单行 status = refunded', refunded?.status, 'refunded');

    // ------------------------------- 取消但未到期：必须保留已付费的剩余周期
    // 回归点（线上真实事故）：Creem 客户门户的「取消」发的是 subscription.canceled，
    // **不是** subscription.scheduled_cancel。原实现对 canceled 无条件 plan='free'，
    // 于是用户关掉自动续费就立刻失去已付费的整年服务（实测：$20 年订阅，取消后
    // 4 分钟被降级成 free）。判据必须是账期，不是事件名。
    report.section('取消但未到期（canceled + 未来账期）→ 保留 plan，只标记不再续费');
    const canceledAt = new Date().toISOString();
    const cancelBody = makeSubCanceledEvent(uid, stamp, ids, periodEnd, canceledAt);
    const cancelRes = await postFromSw(dev, cancelBody, sign(cancelBody));
    extra.subCanceled = cancelRes;
    report.equals('subscription.canceled 返回 200', cancelRes.status, 200);

    const sub4 = subRow(uid, ids.sub);
    report.equals('订阅行 status = scheduled_cancel', sub4?.status, 'scheduled_cancel');
    report.assert(
      '订阅行 current_period_end 仍保留',
      sameInstant(sub4?.current_period_end, periodEnd),
      `${sub4?.current_period_end} vs ${periodEnd}`,
    );
    report.assert('订阅行 canceled_at 已记录', !!sub4?.canceled_at, sub4?.canceled_at);

    const afterCancel = profRow(uid);
    report.equals('到期前 plan 仍是 plus（不得提前降级）', afterCancel?.plan, 'plus');
    report.equals('到期前 quota 仍是 20MiB', afterCancel?.quota_bytes, PLUS_QUOTA_BYTES);

    // ------------------------------- 到期兜底任务（迁移 0044）
    // Creem 是否会在真实到期日补发 subscription.expired 无法验证（要等一年），
    // 所以靠这个每日任务兜底。这里直接把账期改到过去，验证兜底确实会降级。
    report.section('到期兜底：账期已过的取消订阅由 bsync_expire_subscriptions 降级');
    cloud.exec(
      `update public.bsync_subscriptions set current_period_end = now() - interval '1 hour'
        where user_id = '${uid}' and creem_subscription_id = '${ids.sub}'`,
    );
    const swept = cloud.sql('select public.bsync_expire_subscriptions() as n')[0]?.n;
    extra.sweptCount = swept;
    report.assert('兜底任务至少降级 1 个 profile', Number(swept) >= 1, `返回 ${swept}`);
    report.equals('到期后订阅行 status = expired', subRow(uid, ids.sub)?.status, 'expired');
    report.equals('到期后 plan 降为 free', profRow(uid)?.plan, 'free');

    return extra;
  } finally {
    if (dev) await dev.close({ keepProfile: cfg.keepProfiles }).catch(() => {});
    if (uid && created.length) {
      const ids = created[0];
      try {
        cloud.exec(
          `delete from public.bsync_orders where creem_subscription_id = '${ids.sub}';
           delete from public.bsync_subscriptions where user_id = '${uid}' and creem_subscription_id = '${ids.sub}';`,
        );
      } catch (e) {
        report.fail('清理合成的订阅/订单行失败', e.message);
      }
    }
    if (uid && before) {
      try {
        cloud.exec(
          `update public.bsync_profiles set plan = '${before.plan}', quota_bytes = ${before.quota_bytes}
            where user_id = '${uid}'`,
        );
        const back = profRow(uid);
        const same = back?.plan === before.plan && back?.quota_bytes === before.quota_bytes;
        if (same) report.info('账号 plan/quota 已还原', `${back.plan} / ${back.quota_bytes}`);
        else
          report.fail(
            '还原账号 plan/quota',
            `期望 ${before.plan}/${before.quota_bytes}，实际 ${back?.plan}/${back?.quota_bytes}`,
          );
      } catch (e) {
        report.fail('还原账号 plan/quota 失败', e.message);
      }
    }
  }
}
