/**
 * scenarios/two-device-sync.mjs — 双设备双向同步（含文件夹与删除）。
 *
 * 这是最常手测的那条链路：A 建东西 → B 看得到 → B 删东西 → A 也删掉。
 * 顺带把「云端必须全是密文」焊进自动化 —— 手工检查时最容易忘、后果最严重的一项。
 *
 * 锁死的回归点：
 *   1. A 建的**文件夹结构 + 书签**在 B 上逐条重现（含父子关系，不只是标题）；
 *   2. B 删掉的节点在 A 上**也消失**（墓碑生效；不做这一步就测不出「删了又回来」）；
 *   3. 删除是**真删**，不会把兄弟节点一起带走；
 *   4. 云端 op 全为 `{iv, ciphertext}` 信封，且 op 文本里搜不到书签标题/URL 的明文。
 *   5. **兄弟顺序逐位不变**：同一父下交错建的「文件夹/书签」在 B 上必须重现 A 的次序
 *      （用户 2026-09-22 反馈「新设备选中默认空间后文件夹跑到书签前面」的回归点）。
 */
import { launchDevice } from '../lib/chrome.mjs';
import {
  reachMain,
  flattenTree,
  waitTree,
  ensureCleanStart,
  syncWithRetry,
  siblingTitles,
  watchBarOrder,
} from '../lib/helpers.mjs';
import * as cloud from '../lib/cloud.mjs';
import { join } from 'node:path';

const PORTS = { devA: 9361, devB: 9362 };
/** 明文泄漏探针：标题与域名都带上它。 */
const MARKER = 'bsync-e2e-sync';

/**
 * 顺序探针：在**同一个父**下交错建「文件夹 / 书签 / 文件夹 / 书签」。
 *
 * 为什么必须是交错的：顺序 bug 只在「同一父下有多个不同类型的孩子」时暴露。
 * 原来只建「1 个文件夹 + 放在它里面的 2 个书签」——那种形状下**每个父都只有一个
 * 孩子**，无论实现怎么排序都测不出问题（用户 2026-09-22 报的「新设备选中默认空间后
 * 文件夹跑到书签前面」就是漏在这条缝里）。
 */
const SIBLINGS = [
  { title: `${MARKER}-f1`, folder: true },
  { title: `${MARKER}-b1`, folder: false },
  { title: `${MARKER}-f2`, folder: true },
  { title: `${MARKER}-b2`, folder: false },
];

/**
 * 书签栏顺序探针 —— 直接照抄用户 2026-09-22 反馈的形状：
 * **书签在前、两个文件夹在后**（`[bookmark, folder, folder]`），
 * 同步到新设备后却变成了 `[folder, folder, bookmark]`（文件夹整体跑到前面）。
 *
 * 为什么在**书签栏**再放一份（SIBLINGS 已经在「其他书签」测过了）：
 * 书签栏是默认空间的落地区，而新设备上它**一开始是空的** —— 空父节点正是
 * `chromeBridge.ts:siblingsOf` 那条出错路径的触发条件（空列表没落进 map →
 * index 全算成 0 → 整层倒序）。「其他书签」在 e2e 里早已被前序步骤写过内容，
 * 不是空父，所以**测不出**这个 bug（这正是它长期漏网的原因）。
 */
const BAR_PROBE = [
  { title: `${MARKER}-bar-b`, folder: false },
  { title: `${MARKER}-bar-f1`, folder: true },
  { title: `${MARKER}-bar-f2`, folder: true },
];

/**
 * 取某个父节点下、标题含 needle 的子节点顺序（`siblingTitles` 已抽到 helpers.mjs）。
 *
 * `flattenTree` 是 DFS 且**保持数组顺序**，所以按 parentId 过滤后的相对顺序就是
 * 浏览器里的真实兄弟位次 —— 这正是「顺序到底乱没乱」要断言的东西。
 */

/**
 * 同步失败时的诊断尾巴：把扩展持久化的 `lastSyncError`（`src/sync.js` 在
 * `reason:'error'` 分支里主动落盘的**完整错误 + 堆栈**）带上。
 *
 * 没有它，失败只剩 `{"ok":false,"reason":"error","error":"..."}` —— 2026-09-22
 * 就因为错误文本自己退化成 `[object Object]` 而只能对着空报错查案。
 */
async function syncFailureTail(dev, res) {
  if (res?.ok !== false) return '';
  try {
    const err = await dev.storageKey('lastSyncError');
    return err ? ` | lastSyncError=${String(err).slice(0, 1200)}` : '';
  } catch {
    return '';
  }
}

export const meta = {
  name: 'two-device-sync',
  describe: '双设备双向同步（真实后端）：A 建文件夹+书签 → B 重现 → B 删 → A 消失 + 云端全密文',
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

  try {
    // ---------------------------------------------------------------- 前置
    report.section('前置：起跑线');
    const { uid, prof } = await ensureCleanStart(cfg, report);
    extra.email = prof.email;
    extra.userId = uid;

    const FOLDER = `${MARKER}-folder`;
    const BOOK_A = `${MARKER}-a`;
    const BOOK_B = `${MARKER}-b`;

    // ------------------------------------------------ 设备 A：播种 + 推送
    report.section('设备 A：登录 → 设口令 → 建「文件夹 + 2 书签」→ 同步');
    const devA = await boot('devA');
    devices.push(devA);
    const rA = await reachMain(devA, cfg, report);
    report.equals('设备 A 落到主界面', rA.gate.kind, 'main');

    const otherA = await devA.otherBookmarksId();
    const folder = await devA.bookmarksCreate({ parentId: otherA, title: FOLDER });
    await devA.bookmarksCreate({
      parentId: folder.id,
      title: BOOK_A,
      url: `https://${MARKER}.test/a`,
    });
    await devA.bookmarksCreate({
      parentId: folder.id,
      title: BOOK_B,
      url: `https://${MARKER}.test/b`,
    });
    report.info('本机已建', `1 文件夹 + 2 书签（folder id=${folder.id}）`);

    // 顺序基准：在「其他书签」这一层**追加**交错的文件夹/书签（见 SIBLINGS 注释）。
    // 先记下 A 自己的顺序，后面拿它当基准去比对 B —— 顺序不变性的断言必须是
    // 「B 与 A 逐位一致」而不是写死一个列表：写死只能证明「B 等于我以为的序」，
    // 证明不了「B 等于 A」。
    for (const s of SIBLINGS) {
      await devA.bookmarksCreate({
        parentId: otherA,
        title: s.title,
        ...(s.folder ? {} : { url: `https://${MARKER}.test/${s.title}` }),
      });
    }
    const orderOnA = siblingTitles(await devA.bookmarksGetTree(), otherA, MARKER);
    report.equals(
      '设备 A 本机顺序 = 交错建的交错序（顺序探针本身有效）',
      orderOnA.join(' | '),
      [FOLDER, ...SIBLINGS.map((s) => s.title)].join(' | '),
    );

    // 书签栏探针：复刻用户反馈的形状 [书签, 文件夹, 文件夹]（见 BAR_PROBE 注释）
    const barA = await devA.bookmarksBarId();
    const barNodes = [];
    for (const s of BAR_PROBE) {
      barNodes.push(
        await devA.bookmarksCreate({
          parentId: barA,
          title: s.title,
          ...(s.folder ? {} : { url: `https://${MARKER}.test/${s.title}` }),
        }),
      );
    }
    let barOrderOnA = siblingTitles(await devA.bookmarksGetTree(), barA, MARKER);
    report.equals(
      '设备 A 书签栏顺序 = 书签在前、两文件夹在后（复刻用户反馈的形状）',
      barOrderOnA.join(' | '),
      BAR_PROBE.map((s) => s.title).join(' | '),
    );

    // ---- 顺序来源之三：**拖拽/移动**。
    // 用户对「建完之后有没有拖过」记不清，而这条 `onMoved → computePosition` 路径
    // 是最后一个没被覆盖的顺序来源：它走的是**排除自身**的邻居分支（`selfUuid`），
    // 与新建走的「追加到末尾」快路径完全不同的代码。把最后一个文件夹拖到最前，
    // 得到 [f2, b, f1] 这个「文件夹夹住书签」的形状 —— 只要哪一层丢了 position，
    // 它就会退化回 [b, f1, f2] 或 uuid 序，两边立刻对不上。
    const movedId = barNodes[BAR_PROBE.length - 1].id;
    await devA.swEval(
      `(async () => await chrome.bookmarks.move(${JSON.stringify(movedId)}, ` +
        `{ parentId: ${JSON.stringify(barA)}, index: 0 }))()`,
    );
    barOrderOnA = siblingTitles(await devA.bookmarksGetTree(), barA, MARKER);
    report.equals(
      '设备 A 书签栏「把文件夹拖到最前」后顺序 = 移动后的形状（onMoved 路径被捕获）',
      barOrderOnA.join(' | '),
      [BAR_PROBE.at(-1).title, ...BAR_PROBE.slice(0, -1).map((s) => s.title)].join(' | '),
    );

    const pushA = await syncWithRetry(devA, cfg.timeouts.sync, report);
    report.assert(
      '设备 A 同步成功',
      pushA?.ok === true,
      JSON.stringify(pushA).slice(0, 200) + (await syncFailureTail(devA, pushA)),
    );

    const st = await cloud.waitCloud(
      () => {
        const s = cloud.opStats(uid, MARKER);
        return s.ops > 0 ? s : null;
      },
      { timeoutMs: 40_000, intervalMs: 800 },
    );
    report.assert('云端已收到 A 的操作', !!st && st.ops > 0, `op=${st?.ops ?? 0}`);
    if (st) {
      report.equals('云端 op 全为密文信封（iv + ciphertext）', st.not_enveloped, 0);
      report.equals('云端 op 里搜不到明文 marker（标题/URL 未泄漏）', st.leaks, 0);
      extra.opsAfterA = st.ops;
    }

    // --------------------------------------------------- 设备 B：拉取 + 断言
    report.section('设备 B（全新 profile）：登录 → 过门禁 → 同步 → 断言结构重现');
    const devB = await boot('devB');
    devices.push(devB);
    // ⚠ 必须在 reachMain 之前起：绑定空间成功那一下就会触发「第一次同步」。
    const barWatch = watchBarOrder(devB, { expectTitles: BAR_PROBE.map((s) => s.title) });
    const rB = await reachMain(devB, cfg, report);
    report.assert('设备 B 已过全部门禁', rB.gate.kind === 'main', `实际 ${rB.gate.kind}`);

    const pullB = await syncWithRetry(devB, cfg.timeouts.sync, report);
    report.assert(
      '设备 B 同步成功',
      pullB?.ok === true,
      JSON.stringify(pullB).slice(0, 200) + (await syncFailureTail(devB, pullB)),
    );

    const flatB = await waitTree(
      devB,
      (f) =>
        f.some((n) => n.title === FOLDER) &&
        f.some((n) => n.title === BOOK_A) &&
        // 必须等到最后一个顺序探针也出现，否则下面的顺序断言是在跟「还没拉完」赛跑
        f.some((n) => n.title === SIBLINGS.at(-1).title) &&
        f.some((n) => n.title === BAR_PROBE.at(-1).title),
      { timeoutMs: 75_000, intervalMs: 1_500, label: '等设备 B 拉回文件夹与书签' },
    );
    const folderB = flatB.find((n) => n.title === FOLDER);
    const bookAB = flatB.find((n) => n.title === BOOK_A);
    const bookBB = flatB.find((n) => n.title === BOOK_B);
    report.assert(
      '设备 B 出现了文件夹',
      !!folderB && folderB.folder,
      folderB ? `id=${folderB.id}` : '(无)',
    );
    report.assert(
      '设备 B 出现了书签 a',
      !!bookAB && !bookAB.folder,
      bookAB ? `url=${bookAB.url}` : '(无)',
    );
    report.assert('设备 B 出现了书签 b', !!bookBB, bookBB ? `url=${bookBB.url}` : '(无)');
    report.assert(
      '书签 a 的父节点就是那个文件夹（父子关系也被同步）',
      !!bookAB && !!folderB && bookAB.parentId === folderB.id,
      `a.parent=${bookAB?.parentId ?? '(无)'} / folder=${folderB?.id ?? '(无)'}`,
    );
    report.equals('书签 a 的 URL 逐字一致', bookAB?.url ?? '', `https://${MARKER}.test/a`);

    // ---------------------------------------------- 顺序不变性（用户报过的 bug）
    // 「文件夹/书签交错建」在 B 上必须逐位重现。这正是「新设备选了默认空间之后
    // 文件夹跑到书签前面、顺序乱掉」那条反馈的回归点：只要实现里任何一处
    // 把 index 丢掉（或按 uuid / 按类型重排），这里立刻红。
    const otherB = await devB.otherBookmarksId();
    const orderOnB = siblingTitles(await devB.bookmarksGetTree(), otherB, MARKER);
    report.equals(
      '设备 B 的兄弟顺序与设备 A 逐位一致（交错序不乱）',
      orderOnB.join(' | '),
      orderOnA.join(' | '),
    );
    extra.orderOnA = orderOnA;
    extra.orderOnB = orderOnB;

    // 书签栏那一份（用户反馈的原形状：书签在前、两文件夹在后）
    const barB = await devB.bookmarksBarId();
    const barOrderOnB = siblingTitles(await devB.bookmarksGetTree(), barB, MARKER);
    report.equals(
      '设备 B 书签栏顺序与设备 A 逐位一致（书签在前不乱）',
      barOrderOnB.join(' | '),
      barOrderOnA.join(' | '),
    );
    // 回归点：**第一遍**落地就必须是对的。曾经的 bug 是第一遍整层倒序
    // （`[folder, folder, bookmark]`），靠第二遍的 move 对齐才修好 —— 断言
    // 「首次完整」而不是「最终收敛」，才抓得住它。
    const barTrajectory = (await barWatch.stop()).map((o) => o.join(' | '));
    report.equals(
      '设备 B 书签栏「首次完整」顺序即正确（回归：曾第一遍倒序、第二遍才修）',
      barTrajectory[0] ?? '(未观测到完整快照)',
      barOrderOnA.join(' | '),
    );
    extra.barOrderOnA = barOrderOnA;
    extra.barOrderOnB = barOrderOnB;
    extra.barOrderTrajectory = barTrajectory;

    // --------------------------------------------------- 设备 B：删除 → A 消失
    report.section('设备 B：删掉书签 a → 同步 → 断言设备 A 上也消失');
    report.assert(
      '删除前设备 A 本机确实有书签 a',
      flattenTree(await devA.bookmarksGetTree()).some((n) => n.title === BOOK_A),
      '',
    );
    // 注意：书签 id 是**每台设备各自的**（设备 B 上的是另一串 id），必须用 B 自己那份。
    if (!bookAB?.id) {
      throw new Error(
        '设备 B 上没有书签 a 的 id，无法执行删除（前面的「结构重现」断言已失败，先修那里）',
      );
    }
    await devB.swEval(
      `(async () => await chrome.bookmarks.remove(${JSON.stringify(bookAB.id)}))()`,
    );
    const goneB = await waitTree(
      devB,
      (f) => !f.some((n) => n.title === BOOK_A) && f.some((n) => n.title === BOOK_B),
      {
        timeoutMs: 20_000,
        intervalMs: 800,
        label: '等设备 B 本机删除生效',
      },
    );
    report.assert('设备 B 本机已删除书签 a', !goneB.some((n) => n.title === BOOK_A), '');
    report.assert(
      '删除是精准的：兄弟书签 b 还在设备 B 上',
      goneB.some((n) => n.title === BOOK_B),
      '',
    );

    const delB = await syncWithRetry(devB, cfg.timeouts.sync, report);
    report.assert(
      '设备 B 删除后同步成功',
      delB?.ok === true,
      JSON.stringify(delB).slice(0, 200) + (await syncFailureTail(devB, delB)),
    );

    const pushA2 = await syncWithRetry(devA, cfg.timeouts.sync, report);
    report.assert(
      '设备 A 同步成功（拉取删除）',
      pushA2?.ok === true,
      JSON.stringify(pushA2).slice(0, 200) + (await syncFailureTail(devA, pushA2)),
    );

    const flatA = await waitTree(devA, (f) => !f.some((n) => n.title === BOOK_A), {
      timeoutMs: 75_000,
      intervalMs: 1_500,
      label: '等设备 A 上的书签 a 被删除',
    });
    report.assert(
      '设备 A 上的书签 a 已消失（墓碑生效；不做这步就测不出「删了又回来」）',
      !flatA.some((n) => n.title === BOOK_A),
      flatA
        .filter((n) => n.title.includes(MARKER))
        .map((n) => n.title)
        .join(','),
    );
    report.assert(
      '设备 A 上的文件夹还在（没被连带删掉）',
      flatA.some((n) => n.title === FOLDER),
      '',
    );
    report.assert(
      '设备 A 上的书签 b 还在（没被连带删掉）',
      flatA.some((n) => n.title === BOOK_B),
      '',
    );

    // 删除往返也不该搅动兄弟顺序（墓碑只应影响被删的那个节点）
    const orderOnA2 = siblingTitles(await devA.bookmarksGetTree(), otherA, MARKER);
    report.equals(
      '删除往返后设备 A 的兄弟顺序未被搅动',
      orderOnA2.join(' | '),
      orderOnA.join(' | '),
    );

    // ------------------------------------------------------------ 收尾断言
    const st2 = cloud.opStats(uid, MARKER);
    report.equals('追加操作后云端仍然全是密文', st2.not_enveloped, 0);
    report.equals('追加操作后云端仍然没有明文泄漏', st2.leaks, 0);
    report.info('云端 op 数', `${st?.ops ?? 0} → ${st2.ops}`);
    extra.opsFinal = st2.ops;
    extra.markerTitlesOnA = flatA.filter((n) => n.title.includes(MARKER)).map((n) => n.title);

    return extra;
  } finally {
    for (const d of devices) {
      await d
        .close({ keepProfile: cfg.keepProfiles })
        .catch((e) => report.info('关闭设备失败', e.message));
    }
  }
}
