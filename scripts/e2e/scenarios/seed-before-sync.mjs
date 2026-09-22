/**
 * scenarios/seed-before-sync.mjs — captureLocalTree 播种的顺序回归点。
 *
 * 这是「兄弟顺序」第三个、也是最后一个此前没覆盖的来源：用户**登录扩展之前**，
 * 书签栏 / 其他书签里就已经有书签了。第一台设备首绑时，这些「本机已有的书签」
 * 不走 `onCreated` 事件桥（事件桥在 coordinator/bridge 就绪前对 `chrome.bookmarks`
 * 事件直接 no-op，见 chromeBridge.ts 顶部注释 + onCreated 的 `if (!c) return`），
 * 而是被首同步里的 `captureLocalTree`（src/sync.js:660 的 runSync）整树扫出来、
 * 补建 op 推上云端。新设备拉取后必须**逐位**重现原顺序。
 *
 * 为什么单独成场景、不复用 two-device-sync：那个场景的书签都是「登录之后才建」的，
 * 走的是 onCreated 快路径；要把「登录前就有」这条路径单独钉住，必须抢在首绑之前
 * 往原生树塞数据，流程上和「登录后再建」互斥，合在一起只会把两条路径搅混。
 *
 * 锁死的回归点：
 *   1. 设备 A 在**登录前**预置原生书签栏 [书签, 文件夹, 文件夹] 与其他书签 [文件夹, 书签]；
 *   2. 首同步把这批「已有书签」捕获进云端（op > 0）；
 *   3. 设备 B 全流程全新 profile，拉取后书签栏 / 其他书签的顺序与 A 预置的**逐位一致**；
 *   4. 且「首次完整」那一刻顺序即正确（回归「第一遍倒序、第二遍才修」的缺陷签名）。
 */
import { launchDevice } from '../lib/chrome.mjs';
import {
  reachMain,
  waitTree,
  ensureCleanStart,
  syncWithRetry,
  siblingTitles,
  watchBarOrder,
} from '../lib/helpers.mjs';
import * as cloud from '../lib/cloud.mjs';
import { join } from 'node:path';

const PORTS = { devA: 9371, devB: 9372 };
/** 明文泄漏探针：标题与域名都带上它。 */
const MARKER = 'bsync-e2e-seed';

/**
 * 登录前预置到原生书签栏的形状 —— 直接照抄用户 2026-09-22 反馈的原形状：
 * **书签在前、两个文件夹在后**（`[bookmark, folder, folder]`）。
 */
const BAR_SEED = [
  { title: `${MARKER}-bar-b`, folder: false },
  { title: `${MARKER}-bar-f1`, folder: true },
  { title: `${MARKER}-bar-f2`, folder: true },
];

/**
 * 登录前预置到「其他书签」的形状 —— 反向 `[folder, bookmark]`，
 * 把两个落地区都各测一遍（书签栏是默认空间落地区；两个根的 captureLocalTree
 * 走的是同一份遍历，但历史上「书签栏是空父」这个触发条件只在这里成立，
 * 所以两侧都验一下更稳）。
 */
const OTHER_SEED = [
  { title: `${MARKER}-oth-f`, folder: true },
  { title: `${MARKER}-oth-b`, folder: false },
];

export const meta = {
  name: 'seed-before-sync',
  describe: 'captureLocalTree 播种：登录前已有书签 → 首同步整树捕获 → 新设备顺序逐位一致',
  needsCloud: true,
};

export async function run({ cfg, report }) {
  const extra = {};
  const devices = [];

  const boot = async (name) =>
    launchDevice({
      name,
      port: PORTS[name],
      profileDir: join(cfg.profileRoot, name),
      extDir: cfg.extDir,
      headless: cfg.headless,
      freshProfile: !cfg.keepProfiles,
      bootTimeoutMs: cfg.timeouts.boot,
    });

  /** 按期望顺序逐个建到指定父下（让原生树就是我们要的形状）。 */
  const seed = async (dev, parentId, specs) => {
    const ids = [];
    for (const s of specs) {
      ids.push(
        await dev.bookmarksCreate({
          parentId,
          title: s.title,
          ...(s.folder ? {} : { url: `https://${MARKER}.test/${s.title}` }),
        }),
      );
    }
    return ids;
  };

  try {
    // ---------------------------------------------------------------- 前置
    report.section('前置：起跑线');
    const { uid } = await ensureCleanStart(cfg, report);
    extra.userId = uid;

    // -------------------------------------------- 设备 A：登录前预置原生书签
    // 关键：必须在 reachMain（首绑 → 首同步）**之前**建好，这样它们才会走
    // captureLocalTree 整树捕获，而不是 onCreated 事件桥。
    report.section('设备 A：登录前预置原生书签栏 / 其他书签（混合顺序）');
    const devA = await boot('devA');
    devices.push(devA);

    const barA = await devA.bookmarksBarId();
    const otherA = await devA.otherBookmarksId();
    await seed(devA, barA, BAR_SEED);
    await seed(devA, otherA, OTHER_SEED);

    const orderBarOnA = siblingTitles(await devA.bookmarksGetTree(), barA, MARKER);
    const orderOtherOnA = siblingTitles(await devA.bookmarksGetTree(), otherA, MARKER);
    report.equals(
      '设备 A 原生书签栏顺序 = 预置顺序（播种本身有效）',
      orderBarOnA.join(' | '),
      BAR_SEED.map((s) => s.title).join(' | '),
    );
    report.equals(
      '设备 A 原生其他书签顺序 = 预置顺序',
      orderOtherOnA.join(' | '),
      OTHER_SEED.map((s) => s.title).join(' | '),
    );

    // ---------------------------------------- 登录 → 首绑 → 首同步（捕获已有树）
    report.section('设备 A：登录 → 首绑 → 首同步（captureLocalTree 捕获本机已有树）');
    const rA = await reachMain(devA, cfg, report);
    report.equals('设备 A 落到主界面', rA.gate.kind, 'main');

    const st = await cloud.waitCloud(
      () => {
        const s = cloud.opStats(uid, MARKER);
        return s.ops > 0 ? s : null;
      },
      { timeoutMs: 40_000, intervalMs: 800 },
    );
    report.assert(
      '云端已收到 A 捕获的操作（captureLocalTree 生效）',
      !!st && st.ops > 0,
      `op=${st?.ops ?? 0}`,
    );
    if (st) {
      report.equals('云端捕获的 op 全为密文信封（iv + ciphertext）', st.not_enveloped, 0);
      report.equals('云端 op 里搜不到明文 marker（标题/URL 未泄漏）', st.leaks, 0);
      extra.opsAfterCapture = st.ops;
    }

    // ------------------------------------------- 设备 B：拉取 + 顺序断言
    report.section('设备 B（全新 profile）：登录 → 过门禁 → 同步 → 断言顺序逐位一致');
    const devB = await boot('devB');
    devices.push(devB);
    // ⚠ 必须在 reachMain 之前起：绑定空间成功那一下就会触发「第一次同步」。
    const barWatch = watchBarOrder(devB, { expectTitles: BAR_SEED.map((s) => s.title) });
    const rB = await reachMain(devB, cfg, report);
    report.assert('设备 B 已过全部门禁', rB.gate.kind === 'main', `实际 ${rB.gate.kind}`);

    const pullB = await syncWithRetry(devB, cfg.timeouts.sync, report);
    report.assert('设备 B 同步成功', pullB?.ok === true, JSON.stringify(pullB).slice(0, 200));

    const flatB = await waitTree(
      devB,
      (f) =>
        BAR_SEED.every((s) => f.some((n) => n.title === s.title)) &&
        OTHER_SEED.every((s) => f.some((n) => n.title === s.title)),
      { timeoutMs: 75_000, intervalMs: 1_500, label: '等设备 B 拉回预置书签' },
    );
    const barB = await devB.bookmarksBarId();
    const otherB = await devB.otherBookmarksId();
    const orderBarOnB = siblingTitles(await devB.bookmarksGetTree(), barB, MARKER);
    const orderOtherOnB = siblingTitles(await devB.bookmarksGetTree(), otherB, MARKER);
    report.equals(
      '设备 B 书签栏顺序与设备 A 预置逐位一致（captureLocalTree 播种不乱序）',
      orderBarOnB.join(' | '),
      orderBarOnA.join(' | '),
    );
    report.equals(
      '设备 B 其他书签顺序与设备 A 预置逐位一致',
      orderOtherOnB.join(' | '),
      orderOtherOnA.join(' | '),
    );

    // 回归点：**第一遍**落地就必须是对的（曾第一遍整层倒序、靠第二遍 move 对齐才修）。
    const barTrajectory = (await barWatch.stop()).map((o) => o.join(' | '));
    report.equals(
      '设备 B 书签栏「首次完整」顺序即正确（回归：曾第一遍倒序、第二遍才修）',
      barTrajectory[0] ?? '(未观测到完整快照)',
      orderBarOnA.join(' | '),
    );
    extra.orderBarOnA = orderBarOnA;
    extra.orderBarOnB = orderBarOnB;
    extra.orderOtherOnA = orderOtherOnA;
    extra.orderOtherOnB = orderOtherOnB;
    extra.barTrajectory = barTrajectory;

    return extra;
  } finally {
    for (const d of devices) {
      await d
        .close({ keepProfile: cfg.keepProfiles })
        .catch((e) => report.info('关闭设备失败', e.message));
    }
  }
}
