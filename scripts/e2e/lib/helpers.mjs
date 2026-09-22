/**
 * e2e/lib/helpers.mjs — 场景共用的「把一台设备带到主界面」与书签树小工具。
 *
 * 门禁链是 AuthView → PhraseGate → BindSpaceGate → 主界面，四个场景都要走一遍，
 * 每个场景各抄一份迟早会分叉（改一处忘另一处），所以统一在这里。
 *
 * `reachMain()` 是**宽容**的：它只负责把设备带到主界面，路上遇到什么门禁就过什么，
 * 并把「路上经过了哪些关」如实返回。**断言留给场景**——同一个步骤在 A 场景是预期
 * 行为、在 B 场景是 bug，helper 不该替场景下结论。
 */
import { submitPhrase, login, waitGate } from './gates.mjs';
import * as cloud from './cloud.mjs';

/**
 * 把云端带到「干净起点」（无盐 / 0 op / 0 空间）或确认它已经是。
 *
 * 门禁类场景全都要求从零开始：设备 1 必须是**首台设备**（设口令），否则它走
 * 「验证口令」，场景的前提就不成立了。所以这里不复用 `--fresh` 的模糊语义，
 * 而是：不干净 + 没给 `--fresh` → **显式失败**（不猜）；不干净 + 给了 `--fresh`
 * → 有 op 时还要 `--allow-destroy` 这把第二钥匙（避免顺手清掉手工测试数据）。
 *
 * @returns {{uid:string, prof:object, spaces0:Array}}
 */
export async function ensureCleanStart(cfg, report) {
  if (!cloud.cliAvailable()) throw new Error('找不到 supabase CLI（本场景要核对云端状态）');

  // 账号从 E2E_EMAIL 定位 —— 云端可能同时存在多个账号（e2e 专用 / 手工调试用），
  // 所有查询都必须带上这个 uid，否则会把别的账号的数据算进断言（见 cloud.mjs 的 requireUid）。
  const uid = cloud.userIdFor(cfg.email);
  const prof = cloud.profile(uid);
  if (!prof) throw new Error('云端没有 profile —— 测试账号还没登录过扩展？先手动登录一次');
  const stats0 = cloud.opStats(uid);
  const spaces0 = cloud.spaces(uid);
  const junkOps = stats0.ops;

  report.info('测试账号', `${prof.email}（plan=${prof.plan}）`);
  report.info(
    '云端起跑线',
    `盐=${prof.e2ee_salt ? '有' : '无'} / op=${junkOps} / 空间=${spaces0.length}`,
  );

  const dirty = !!prof.e2ee_salt || junkOps > 0 || spaces0.length > 0;
  if (!dirty) {
    report.ok('云端已是干净起点', '盐=无 / op=0 / 空间=0');
    return { uid, prof, spaces0 };
  }

  if (!cfg.fresh) {
    throw new Error(
      `云端不是干净起点（盐=${prof.e2ee_salt ? '有' : '无'} / op=${junkOps} / 空间=${spaces0.length}）。\n` +
        '  设备 1 必须在「账号从没设过口令」的前提下跑，否则走的是「验证口令」分支，本场景不成立。\n' +
        '  → 加 --fresh 让脚本先复位该账号的云端同步数据（op/快照/设备/空间 + 盐），再从头跑。',
    );
  }
  if (junkOps > 0 && !cfg.allowDestroy) {
    throw new Error(
      `云端还有 ${junkOps} 条 op —— --fresh 会把它们全删掉。\n` +
        '  确认这些就是能删的测试数据，再加第二把钥匙：\n' +
        `    node scripts/e2e/run.mjs ${'<场景>'} --fresh --allow-destroy`,
    );
  }

  report.info('⚠ --fresh 将删除', `op=${junkOps} / 空间=${spaces0.length} / 设备 / 快照 / 盐`);
  if (spaces0.length) {
    report.info(
      '⚠ 换盐的副作用',
      '该账号其它设备仍持旧密钥：换盐后解不开新数据，需重设口令或重装扩展',
    );
  }
  cloud.resetUser(uid);
  const after = cloud.profile(uid);
  const st = cloud.opStats(uid);
  const spacesAfter = cloud.spaces(uid);
  const okStart = !after?.e2ee_salt && st.ops === 0 && spacesAfter.length === 0;
  report.assert(
    '复位后云端为干净起点',
    okStart,
    `盐=${after?.e2ee_salt ? '有' : '无'} / op=${st.ops} / 空间=${spacesAfter.length}`,
  );
  if (!okStart) throw new Error('云端复位失败，中止（否则后面的断言全是假的）');
  return { uid, prof, spaces0: [] };
}

/**
 * 从登录页一路带到主界面。
 *
 * @param {object} opts
 * @param {'auto'|'none'} opts.bind 遇到首绑门禁时的处理：'auto' 选默认空间后提交，
 *        'none' 只报告不点（让场景自己断言门禁长什么样）。
 * @returns {{ trail: string[], bindGate: object|null, gate: object }}
 */
export async function reachMain(device, cfg, report, { bind = 'auto' } = {}) {
  const page = await device.openPopup();
  const trail = [];

  let gate = await waitGate(page, (g) => g.kind !== 'boot', cfg.timeouts.gate);
  trail.push(gate.kind);

  if (gate.kind === 'auth') {
    gate = await login(page, cfg);
    trail.push(gate.kind);
  }

  if (gate.kind === 'phrase') {
    await submitPhrase(page, cfg.passphrase);
    gate = await waitGate(page, (g) => g.kind !== 'phrase' && g.kind !== 'boot', cfg.timeouts.gate);
    trail.push(gate.kind);
  }

  let bindGate = null;
  if (gate.kind === 'bind') {
    bindGate = await readBindGate(page);
    if (bind === 'auto') {
      await page.click('.bg-actions .btn-primary');
      gate = await waitGate(page, (g) => g.kind !== 'bind' && g.kind !== 'boot', cfg.timeouts.gate);
      trail.push(gate.kind);
    }
  }

  report.info(`[${device.name}] 门禁路径`, trail.join(' → '));
  return { page, trail, bindGate, gate };
}

/**
 * 读首绑门禁的完整形态（选项 / CTA / 有没有关闭入口）。
 *
 * 「有没有关闭入口」是这一页的**契约**（它就是为「弹窗会被关掉」而改成整页的），
 * 所以要把 DOM 里所有按钮文案扫一遍，按语义找「稍后 / 关闭 / 跳过」这类字眼。
 */
export async function readBindGate(page) {
  return page.eval(`(() => {
    const txt = (el) => (el?.innerText ?? '').trim();
    const labels = [...document.querySelectorAll('.bg-group label.bg-opt')];
    const opts = labels.map((l) => ({
      value: l.querySelector('input')?.value ?? '',
      title: txt(l.querySelector('.r-title')),
      selected: !!l.querySelector('input')?.checked,
    }));
    const cta = document.querySelector('.bg-actions .btn-primary, .bg-actions .btn-destructive');
    const allButtons = [...document.querySelectorAll('.bg-wrap button')].map(txt).filter(Boolean);
    return {
      title: txt(document.querySelector('.bg-title')),
      sub: txt(document.querySelector('.bg-sub')),
      opts,
      spaceOpts: opts.filter((o) => o.value && o.value !== '__new__'),
      hasNewOption: opts.some((o) => o.value === '__new__'),
      cta: txt(cta),
      ctaDisabled: cta ? !!cta.disabled : null,
      // 整页门禁必须**不可关闭**：出现任何一个这类按钮就是契约被破坏
      dismissButtons: allButtons.filter((b) => /稍后|later|关闭|close|skip|取消|cancel/i.test(b)),
      hint: txt(document.querySelector('.bg-hint')),
      buttons: allButtons,
    };
  })()`);
}

/** 在首绑门禁里选一个空间（按名字包含匹配）。返回被选空间的 id。 */
export async function pickBindSpace(page, name) {
  const id = await page.eval(`(() => {
    const label = [...document.querySelectorAll('.bg-group label.bg-opt')]
      .find((l) => ((l.querySelector('.r-title')?.innerText ?? '').includes(${JSON.stringify(name)})));
    if (!label) return null;
    const input = label.querySelector('input');
    input.click();
    return input.value;
  })()`);
  if (!id) throw new Error(`首绑门禁里找不到名字含「${name}」的空间`);
  return id;
}

/**
 * 通过真实 UI 新建一个空间：主界面 → 空间抽屉 → 「新建空间」→ 输入名 → 创建。
 *
 * 走 UI 而不是直接发 RPC，是因为「免费档能不能建、建满上限会怎样」这类断言
 * 只有走 UI 才测得到（走 RPC 就绕过了 plan_locked 的界面反馈）。
 */
export async function createSpaceViaUI(page, device, name, { timeoutMs = 25_000 } = {}) {
  await page.clickByText('.inset-row.clickable', await device.i18n('spaces_title'));
  if (!(await page.waitForSelector('.inset-row.clickable', 8_000))) {
    throw new Error(`[${device.name}] 空间抽屉没打开`);
  }
  await page.clickByText(
    '.inset-group button.inset-row.clickable',
    await device.i18n('spaceslist_new'),
  );
  if (!(await page.waitForSelector('.inset-group input.input', 8_000))) {
    throw new Error(`[${device.name}] 「新建空间」输入框没出现`);
  }
  await page.fill('.inset-group input.input', name);
  await page.clickByText('.inset-group .btn-primary', await device.i18n('spaceslist_create'));
  const ok = await page.waitUntil(async (pg) => (await pg.text()).includes(name), {
    timeoutMs,
    intervalMs: 400,
  });
  if (!ok) throw new Error(`[${device.name}] 新建空间「${name}」后列表里没出现它`);
  return true;
}

/** 关掉抽屉，回到主界面（抽屉打开时 `#syncNow` 不在 DOM 里，会撞到后续断言）。 */
export async function closeDrawer(page) {
  const ok = await page.tryEval(
    `(() => { const b = document.querySelector('.drawer-chrome .icon-btn'); if (!b) return false; b.click(); return true; })()`,
  );
  if (!ok) throw new Error('抽屉关闭按钮（.drawer-chrome .icon-btn）不存在');
  await page.waitForSelector('#syncNow', 10_000);
}

/** 书签树摊平（含根节点，folder=true 表示没有 url）。 */
export function flattenTree(tree) {
  const out = [];
  const walk = (nodes, parent) => {
    for (const n of nodes ?? []) {
      out.push({
        id: n.id,
        parentId: n.parentId ?? parent?.id ?? null,
        parentTitle: parent?.title ?? '',
        title: n.title ?? '',
        url: n.url ?? '',
        folder: !n.url,
      });
      if (n.children) walk(n.children, n);
    }
  };
  walk(tree, null);
  return out;
}

/** 按标题精确找节点（先找到第一个）。 */
export function findByTitle(tree, title) {
  return flattenTree(tree).find((n) => n.title === title) ?? null;
}

/** 标题里含 needle 的全部节点。 */
export function searchTitles(tree, needle) {
  return flattenTree(tree).filter((n) => n.title.includes(needle));
}

/** 取某个父节点下、标题含 needle 的子节点顺序（兄弟位次；flattenTree 保持数组序）。 */
export function siblingTitles(tree, parentId, needle = '') {
  return flattenTree(tree)
    .filter((n) => n.parentId === parentId && (needle ? n.title.includes(needle) : true))
    .map((n) => n.title);
}

/**
 * 后台紧轮询「书签栏里某组探针标题的顺序轨迹」。
 *
 * 必须后台、且必须在门禁前起：绑定空间成功本身触发第一次同步（captureLocalTree /
 * 首同步），用户说的「第一次同步」发生在 reachMain 返回之前；等主线流程走到断言点
 * 再采样，看到的已是后续轮次自我修正后的状态，transient 被抹掉。
 *
 * 只记录「探针齐全」且顺序变化的快照；`samples[0]` 即第一遍落地后的真实顺序。
 *
 * @param {object} dev 设备句柄
 * @param {object} opts
 * @param {string[]} opts.expectTitles 期望出现的探针标题全集（用于判定「探针已齐全」）
 */
export function watchBarOrder(
  dev,
  { expectTitles = [], intervalMs = 80, timeoutMs = 120_000 } = {},
) {
  const samples = [];
  let stopped = false;
  const done = (async () => {
    const deadline = Date.now() + timeoutMs;
    let barId = null;
    const expectSet = new Set(expectTitles);
    while (!stopped && Date.now() < deadline) {
      try {
        barId ??= await dev.bookmarksBarId();
        const order = flattenTree(await dev.bookmarksGetTree())
          .filter((n) => n.parentId === barId && expectSet.has(n.title))
          .map((n) => n.title);
        const complete = expectTitles.every((t) => order.includes(t));
        if (complete && samples.at(-1)?.join('|') !== order.join('|')) samples.push(order);
      } catch {
        /* 浏览器 / SW 还没就绪，下一轮再试 */
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  })().catch(() => {});
  return {
    samples,
    async stop() {
      stopped = true;
      await done;
      return samples;
    },
  };
}

/** 轮询本机书签树直到 pred(flat) 为真；返回最后一次的摊平结果。 */
export async function waitTree(
  device,
  pred,
  { timeoutMs = 60_000, intervalMs = 1_500, label = '' } = {},
) {
  const t0 = Date.now();
  let last = flattenTree(await device.bookmarksGetTree());
  while (Date.now() - t0 < timeoutMs) {
    if (pred(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
    last = flattenTree(await device.bookmarksGetTree());
  }
  if (label) console.error(`[${device.name}] waitTree 超时: ${label}`);
  return last;
}

/** 读本机绑定记录（`boundSpaceId` = {u,s}），未绑定返回 null。 */
export async function boundSpaceId(device) {
  const v = await device.storageKey('boundSpaceId');
  return v?.s ?? (typeof v === 'string' ? v : null);
}

/**
 * 触发同步；撞到**服务端限流**（`reason === 'rate_limited'`）时退避重试。
 *
 * 这是**环境约束而非产品缺陷**：连续跑多个场景、每次 `--fresh` 复位都算写入，
 * 共用同一个 Supabase 项目时很容易踩到 `bsync_op_*` 的速率限制（migration 0032
 * 的 `P0001 raise`）。不重试就会把「跑太密」误报成产品 bug —— 2026-09-22 连跑
 * 三轮时第 1、3 轮整片红，就是被它骗的（当时错误还被 `[object Object]` 掩盖着，
 * 连 `reason` 都看不出来）。
 */
export async function syncWithRetry(
  device,
  timeoutMs,
  report,
  { delays = [3_000, 12_000, 30_000] } = {},
) {
  let res = await device.triggerSync(timeoutMs);
  for (let i = 0; res?.reason === 'rate_limited' && i < delays.length; i++) {
    report?.info?.(
      '撞到服务端限流，退避重试',
      `${device.name} 等 ${delays[i]}ms（第 ${i + 2} 次）`,
    );
    await new Promise((r) => setTimeout(r, delays[i]));
    res = await device.triggerSync(timeoutMs);
  }
  return res;
}

/**
 * 通过真实 UI 退出登录（主界面 → 高级 → 退出登录；该按钮不是两步确认）。
 *
 * 这条路径是「同账号重登不该再问空间」的回归入口 —— 用户实测踩到过的那个 bug，
 * 就是 `logout()` 顺手清了绑定记录导致的。所以必须走真实 UI 的 logout，
 * 不能在 SW 里直接 `chrome.storage` 抹掉 key（那就绕开了被测对象）。
 */
export async function logoutViaUI(page, device, { timeoutMs = 25_000 } = {}) {
  await page.clickByText('.inset-row.clickable', await device.i18n('adv_title'));
  if (!(await page.waitForSelector('.drawer-chrome', 8_000))) {
    throw new Error(`[${device.name}] 高级抽屉没打开`);
  }
  await page.clickByText('.drawer-body button.btn-secondary', await device.i18n('account_logout'));
  const back = await page.waitUntil(
    async (pg) => ((await pg.exists('#authSubmit')) ? true : null),
    {
      timeoutMs,
      intervalMs: 400,
    },
  );
  if (!back) throw new Error(`[${device.name}] 退出登录后没回到登录页`);
  return true;
}
