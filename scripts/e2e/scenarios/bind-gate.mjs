/**
 * scenarios/bind-gate.mjs — 首绑门禁：新设备必须由用户选空间，且不可绕过。
 *
 * 锁死的回归点（这几条全都是用户实测踩过或明确要求过的）：
 *   1. **新设备（付费档 + 账号已有空间）必须挡出整页门禁**，不能静默替用户绑一个；
 *   2. 门禁**不可关闭**：DOM 里不许有「稍后 / 关闭 / 跳过 / 取消」这类出口
 *      —— 能关掉的弹窗会让人卡在「有插件、没同步」的半残状态里；
 *   3. 用户选**非默认空间**时必须真的绑那一个（不能被顺手改回默认空间）；
 *   4. **同账号重登不再问一遍**：设备已绑定的情况下退出再登录，直接进主界面
 *      —— 这是 `logout()` 清掉绑定键导致的那个 bug 的回归守卫；
 *   5. 跨空间隔离：设备 2 加入 B 空间后，A 空间的书签**不会**出现在它本机。
 */
import { launchDevice } from '../lib/chrome.mjs';
import {
  reachMain,
  readBindGate,
  pickBindSpace,
  createSpaceViaUI,
  closeDrawer,
  boundSpaceId,
  searchTitles,
  waitTree,
  logoutViaUI,
  ensureCleanStart,
} from '../lib/helpers.mjs';
import { waitGate } from '../lib/gates.mjs';
import * as cloud from '../lib/cloud.mjs';
import { join } from 'node:path';

const PORTS = { dev1: 9351, dev2: 9352 };
const MARKER = 'bsync-e2e-bind';
const SPACE_B = 'e2e-space-b';

export const meta = {
  name: 'bind-gate',
  describe:
    '首绑门禁（双设备真实后端）：新设备挡出不可关闭的整页门禁、用户的选择被尊重、重登不再问',
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
    extra.plan = prof.plan;

    if (prof.plan === 'free') {
      throw new Error(
        `测试账号是 free 档：按新判据「免费档在新设备上只有一个旧空间可加入」不会出现门禁，` +
          '本场景的前提不成立。换一个付费测试账号，或先给该账号升级。',
      );
    }

    // -------------------------------------------- 设备 1：建空间 + 播种书签
    report.section('设备 1：登录 → 设口令 → 自动建默认空间 → 建第二个空间');
    const dev1 = await boot('dev1');
    devices.push(dev1);

    const r1 = await reachMain(dev1, cfg, report);
    report.equals('全新账号没有可选项 → 不出现门禁，直接进主界面', r1.gate.kind, 'main');
    report.assert(
      '设备 1 没有走首绑门禁',
      r1.bindGate === null,
      r1.bindGate ? '出现了 bind 门禁' : '',
    );

    const spaces1 = cloud.spaces(uid);
    report.equals('云端空间数 = 1（自动建默认空间）', spaces1.length, 1);
    const defaultSpace = spaces1.find((s) => s.is_default);
    report.assert(
      '自动建出来的空间带 is_default 标记',
      !!defaultSpace,
      defaultSpace?.name ?? '(无)',
    );
    extra.defaultSpaceId = defaultSpace?.id ?? null;
    extra.defaultSpaceName = defaultSpace?.name ?? '';

    const bound1 = await boundSpaceId(dev1);
    report.equals('设备 1 已绑定到默认空间', bound1, defaultSpace?.id ?? null);

    // 建第二个空间（走真实 UI；pro 档有权限）
    await createSpaceViaUI(r1.page, dev1, SPACE_B);
    await closeDrawer(r1.page);
    const spaces2 = cloud.spaces(uid);
    report.equals('UI 新建后云端有 2 个空间', spaces2.length, 2);
    const spaceB = spaces2.find((s) => s.name === SPACE_B);
    report.assert(
      `新空间「${SPACE_B}」已创建且不是默认空间`,
      !!spaceB && !spaceB.is_default,
      spaceB?.name ?? '(无)',
    );
    extra.spaceBId = spaceB?.id ?? null;

    // 在 A 空间（默认空间）播种一个书签 —— 用于后面的跨空间隔离断言
    const other = await dev1.otherBookmarksId();
    await dev1.bookmarksCreate({
      parentId: other,
      title: `${MARKER}-in-A`,
      url: `https://${MARKER}.test/a`,
    });
    const seed = await dev1.triggerSync(cfg.timeouts.sync);
    report.assert('设备 1 同步成功', seed?.ok === true, JSON.stringify(seed).slice(0, 200));
    const st = await cloud.waitCloud(
      () => (cloud.opStats(uid).ops > 0 ? cloud.opStats(uid) : null),
      { timeoutMs: 40_000, intervalMs: 800 },
    );
    report.assert('A 空间的书签已推上云端', !!st && st.ops > 0, `op=${st?.ops ?? 0}`);
    extra.opsAfterSeed = st?.ops ?? 0;

    // ---------------------------------------- 同账号重登：不该再问空间
    report.section('设备 1：退出登录 → 重新登录（同账号）');
    await logoutViaUI(r1.page, dev1);
    const after = await waitGate(r1.page, (g) => g.kind !== 'boot', cfg.timeouts.gate);
    report.equals('退出后回到登录页', after.kind, 'auth');

    const again = await reachMain(dev1, cfg, report);
    report.equals('同账号重登直接进主界面（不再问「加入哪个空间」）', again.gate.kind, 'main');
    report.assert(
      '重登没有出现首绑门禁',
      again.bindGate === null,
      again.bindGate ? `门禁选项=${again.bindGate.spaceOpts.length}` : '',
    );
    report.equals(
      '重登后绑定记录未被清掉（绑定是「账号 × 设备」的事实，不该被 logout 抹掉）',
      await boundSpaceId(dev1),
      defaultSpace?.id ?? null,
    );

    // ------------------------------------------------------ 设备 2：首绑门禁
    report.section('设备 2（全新 profile）：登录 → 过口令门禁 → 首绑门禁');
    const dev2 = await boot('dev2');
    devices.push(dev2);

    const r2 = await reachMain(dev2, cfg, report, { bind: 'none' });
    report.equals('新设备落在首绑门禁（付费档 + 账号已有空间）', r2.gate.kind, 'bind');
    if (r2.gate.kind !== 'bind') throw new Error('首绑门禁没出现，后续断言无意义');

    const bg = await readBindGate(r2.page);
    report.equals('门禁标题来自扩展自己的 i18n', bg.title, await dev2.i18n('bind_title'));
    report.equals('门禁列出账号下全部空间（2 个）', bg.spaceOpts.length, 2);
    const defaultBadge = await dev2.i18n('spaceslist_default');
    report.assert(
      '门禁里标出了「默认」徽标（默认空间只是其中一个选项）',
      bg.spaceOpts.some((o) => o.title.includes(defaultBadge)),
      bg.spaceOpts.map((o) => o.title).join(' | '),
    );
    report.assert(
      '付费档给出「新建一个空间」入口',
      bg.hasNewOption === true,
      bg.opts.map((o) => o.value).join(','),
    );
    report.equals('默认 CTA 文案 = 加入该空间', bg.cta, await dev2.i18n('bind_cta'));
    report.assert(
      'CTA 可用（默认已预选一个空间）',
      bg.ctaDisabled === false,
      `disabled=${bg.ctaDisabled}`,
    );

    // 契约：整页门禁不可关闭
    report.equals(
      '门禁没有任何关闭 / 稍后 / 跳过出口（它是门禁不是弹窗）',
      bg.dismissButtons.length,
      0,
      bg.buttons.join(' | '),
    );
    const closeIcons = await r2.page.eval(
      `document.querySelectorAll('.bg-wrap .icon-btn, .bg-wrap [aria-label*="close" i]').length`,
    );
    report.equals('门禁里也没有关闭图标按钮', closeIcons, 0);

    // 切换到「新建」再切回，验证 CTA 文案随之变化（新建态用另一个键）
    await pickNew(r2.page);
    const bgNew = await readBindGate(r2.page);
    report.equals(
      '切到「新建一个空间」后 CTA = 新建并加入',
      bgNew.cta,
      await dev2.i18n('bind_ctaNew'),
    );
    report.assert(
      '新建态还没输名字时 CTA 禁用（不允许建一个空名空间）',
      bgNew.ctaDisabled === true,
      `disabled=${bgNew.ctaDisabled}`,
    );

    const pickedId = await pickBindSpace(r2.page, SPACE_B);
    report.equals('选中的是 B 空间（非默认）', pickedId, spaceB?.id ?? null);
    const bgPicked = await readBindGate(r2.page);
    report.equals('切回选空间后 CTA = 加入该空间', bgPicked.cta, await dev2.i18n('bind_cta'));
    report.assert(
      '选中项被标记为 selected',
      bgPicked.spaceOpts.some((o) => o.selected && o.value === pickedId),
      JSON.stringify(bgPicked.spaceOpts),
    );

    // ------------------------------------------------------ 提交绑定
    report.section('设备 2：选 B 空间并加入 → 断言用户的选择被尊重');
    await r2.page.click('.bg-actions .btn-primary');
    const afterBind = await waitGate(
      r2.page,
      (g) => g.kind !== 'bind' && g.kind !== 'boot',
      cfg.timeouts.gate,
    );
    report.equals('提交后门禁关闭、进入主界面', afterBind.kind, 'main');
    report.equals(
      '绑定的是用户选的 B 空间（不是被顺手改回默认空间）',
      await boundSpaceId(dev2),
      spaceB?.id ?? null,
    );

    // 跨空间隔离：A 空间的书签不该出现在绑了 B 空间的设备上
    await dev2.triggerSync(cfg.timeouts.sync);
    const flat2 = await waitTree(dev2, () => true, { timeoutMs: 12_000, intervalMs: 1_500 });
    const leaked = searchTitles(flat2, `${MARKER}-in-A`);
    report.equals(
      'A 空间的书签没有出现在绑了 B 空间的设备上',
      leaked.length,
      0,
      leaked.map((n) => n.title).join(','),
    );

    extra.dev2BoundSpaceId = await boundSpaceId(dev2);
    report.info('云端空间数', String(cloud.spaces(uid).length));

    return extra;
  } finally {
    for (const d of devices) {
      await d
        .close({ keepProfile: cfg.keepProfiles })
        .catch((e) => report.info('关闭设备失败', e.message));
    }
  }
}

/** 点「新建一个空间」那个单选项（value="__new__"）。 */
async function pickNew(page) {
  const ok = await page.tryEval(`(() => {
    const input = document.querySelector('.bg-group input[value="__new__"]');
    if (!input) return false;
    input.click();
    return true;
  })()`);
  if (!ok)
    throw new Error('首绑门禁里没有「新建一个空间」单选项（页面未渲染或 canCreateSpace=false）');
  await page.waitForSelector('.bg-new input.input', 8_000);
}
