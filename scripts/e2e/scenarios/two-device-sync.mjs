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
 */
import { launchDevice } from '../lib/chrome.mjs';
import { reachMain, flattenTree, waitTree, ensureCleanStart } from '../lib/helpers.mjs';
import * as cloud from '../lib/cloud.mjs';
import { join } from 'node:path';

const PORTS = { devA: 9361, devB: 9362 };
/** 明文泄漏探针：标题与域名都带上它。 */
const MARKER = 'bsync-e2e-sync';

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
    await devA.bookmarksCreate({ parentId: folder.id, title: BOOK_A, url: `https://${MARKER}.test/a` });
    await devA.bookmarksCreate({ parentId: folder.id, title: BOOK_B, url: `https://${MARKER}.test/b` });
    report.info('本机已建', `1 文件夹 + 2 书签（folder id=${folder.id}）`);

    const pushA = await devA.triggerSync(cfg.timeouts.sync);
    report.assert('设备 A 同步成功', pushA?.ok === true, JSON.stringify(pushA).slice(0, 200));

    const st = await cloud.waitCloud(() => {
      const s = cloud.opStats(MARKER);
      return s.ops > 0 ? s : null;
    }, { timeoutMs: 40_000, intervalMs: 800 });
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
    const rB = await reachMain(devB, cfg, report);
    report.assert('设备 B 已过全部门禁', rB.gate.kind === 'main', `实际 ${rB.gate.kind}`);

    const pullB = await devB.triggerSync(cfg.timeouts.sync);
    report.assert('设备 B 同步成功', pullB?.ok === true, JSON.stringify(pullB).slice(0, 200));

    const flatB = await waitTree(
      devB,
      (f) => f.some((n) => n.title === FOLDER) && f.some((n) => n.title === BOOK_A),
      { timeoutMs: 75_000, intervalMs: 1_500, label: '等设备 B 拉回文件夹与书签' },
    );
    const folderB = flatB.find((n) => n.title === FOLDER);
    const bookAB = flatB.find((n) => n.title === BOOK_A);
    const bookBB = flatB.find((n) => n.title === BOOK_B);
    report.assert('设备 B 出现了文件夹', !!folderB && folderB.folder, folderB ? `id=${folderB.id}` : '(无)');
    report.assert('设备 B 出现了书签 a', !!bookAB && !bookAB.folder, bookAB ? `url=${bookAB.url}` : '(无)');
    report.assert('设备 B 出现了书签 b', !!bookBB, bookBB ? `url=${bookBB.url}` : '(无)');
    report.assert(
      '书签 a 的父节点就是那个文件夹（父子关系也被同步）',
      !!bookAB && !!folderB && bookAB.parentId === folderB.id,
      `a.parent=${bookAB?.parentId ?? '(无)'} / folder=${folderB?.id ?? '(无)'}`,
    );
    report.equals('书签 a 的 URL 逐字一致', bookAB?.url ?? '', `https://${MARKER}.test/a`);

    // --------------------------------------------------- 设备 B：删除 → A 消失
    report.section('设备 B：删掉书签 a → 同步 → 断言设备 A 上也消失');
    report.assert(
      '删除前设备 A 本机确实有书签 a',
      flattenTree(await devA.bookmarksGetTree()).some((n) => n.title === BOOK_A),
      '',
    );
    // 注意：书签 id 是**每台设备各自的**（设备 B 上的是另一串 id），必须用 B 自己那份。
    if (!bookAB?.id) {
      throw new Error('设备 B 上没有书签 a 的 id，无法执行删除（前面的「结构重现」断言已失败，先修那里）');
    }
    await devB.swEval(`(async () => await chrome.bookmarks.remove(${JSON.stringify(bookAB.id)}))()`);
    const goneB = await waitTree(devB, (f) => !f.some((n) => n.title === BOOK_A) && f.some((n) => n.title === BOOK_B), {
      timeoutMs: 20_000,
      intervalMs: 800,
      label: '等设备 B 本机删除生效',
    });
    report.assert('设备 B 本机已删除书签 a', !goneB.some((n) => n.title === BOOK_A), '');
    report.assert('删除是精准的：兄弟书签 b 还在设备 B 上', goneB.some((n) => n.title === BOOK_B), '');

    const delB = await devB.triggerSync(cfg.timeouts.sync);
    report.assert('设备 B 删除后同步成功', delB?.ok === true, JSON.stringify(delB).slice(0, 200));

    const pushA2 = await devA.triggerSync(cfg.timeouts.sync);
    report.assert('设备 A 同步成功（拉取删除）', pushA2?.ok === true, JSON.stringify(pushA2).slice(0, 200));

    const flatA = await waitTree(devA, (f) => !f.some((n) => n.title === BOOK_A), {
      timeoutMs: 75_000,
      intervalMs: 1_500,
      label: '等设备 A 上的书签 a 被删除',
    });
    report.assert(
      '设备 A 上的书签 a 已消失（墓碑生效；不做这步就测不出「删了又回来」）',
      !flatA.some((n) => n.title === BOOK_A),
      flatA.filter((n) => n.title.includes(MARKER)).map((n) => n.title).join(','),
    );
    report.assert('设备 A 上的文件夹还在（没被连带删掉）', flatA.some((n) => n.title === FOLDER), '');
    report.assert('设备 A 上的书签 b 还在（没被连带删掉）', flatA.some((n) => n.title === BOOK_B), '');

    // ------------------------------------------------------------ 收尾断言
    const st2 = cloud.opStats(MARKER);
    report.equals('追加操作后云端仍然全是密文', st2.not_enveloped, 0);
    report.equals('追加操作后云端仍然没有明文泄漏', st2.leaks, 0);
    report.info('云端 op 数', `${st?.ops ?? 0} → ${st2.ops}`);
    extra.opsFinal = st2.ops;
    extra.markerTitlesOnA = flatA.filter((n) => n.title.includes(MARKER)).map((n) => n.title);

    return extra;
  } finally {
    for (const d of devices) {
      await d.close({ keepProfile: cfg.keepProfiles }).catch((e) => report.info('关闭设备失败', e.message));
    }
  }
}
