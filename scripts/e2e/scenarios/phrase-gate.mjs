/**
 * scenarios/phrase-gate.mjs — 口令门禁：同口令通过 / 错口令被拒（真实双设备 + 真实后端）。
 *
 * 为什么必须双设备 + 必须有云端数据：口令门禁的「验证」分支靠**解一条真实的云端 op**
 * 来判定口令对错（`verifyPassphrase()`）。云端一条 op 都没有时它会返回 'ok' 放行
 * ——那是已知限制，不是通过。所以本场景先让设备 1 落一条密文到云端，错口令测试才有
 * 意义；op 数为 0 时脚本会**显式失败**而不是给一个空洞的绿。
 *
 * 锁死的回归点：
 *   1. 新设备（云端有盐）必须进「验证口令」，不是「设置口令」；
 *   2. 错口令：报 `gate_errWrong`（不是 `gate_errCheck`）、停在门禁页、密钥与盐回滚；
 *   3. 对口令：门禁关闭、无错误文案；
 *   4. **两台设备派生出的密钥逐字节相同**——盐/派生分叉是「两边解不开对方数据」的根因，
 *      这条断言直接把它按住；
 *   5. 云端 op 全为密文信封，且搜不到明文 marker。
 */
import { launchDevice } from '../lib/chrome.mjs';
import { readGate, waitGate, submitPhrase, login } from '../lib/gates.mjs';
import { ensureCleanStart } from '../lib/helpers.mjs';
import * as cloud from '../lib/cloud.mjs';
import { join } from 'node:path';

const PORTS = { dev1: 9341, dev2: 9342 };
const MARKER = 'bsync-e2e-marker';

export const meta = {
  name: 'phrase-gate',
  describe: '口令门禁（双设备真实后端）：首设备设口令、新设备错口令被拒 / 对口令通过',
  needsCloud: true,
};

/** 只显示指纹，不把密钥本体打进终端与报告文件。 */
const fp = (v) => (typeof v === 'string' && v ? `${v.slice(0, 10)}…(${v.length})` : String(v));

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

    // ------------------------------------------------------- 设备 1：设口令
    report.section('设备 1：登录 → 设置口令 → 播种一条密文到云端');
    const dev1 = await boot('dev1');
    devices.push(dev1);
    const p1 = await dev1.openPopup();

    let gate = await waitGate(p1, (g) => g.kind === 'auth', cfg.timeouts.gate);
    report.equals('初始落在登录页', gate.kind, 'auth');

    gate = await login(p1, cfg);
    report.equals('登录后进入口令门禁', gate.kind, 'phrase', `mode=${gate.title}`);
    report.equals(
      '门禁模式 = 设置口令（首台设备）',
      gate.title,
      await dev1.i18n('gate_titleSetup'),
    );

    await submitPhrase(p1, cfg.passphrase);
    gate = await waitGate(p1, (g) => g.kind !== 'phrase', cfg.timeouts.gate);
    report.assert(
      '提交新口令后离开口令门禁',
      gate.kind !== 'phrase',
      gate.kind === 'phrase'
        ? `仍停在门禁页 / 错误文案: ${gate.err || '(无)'}`
        : `落到 ${gate.kind}`,
    );

    const s1 = await dev1.storage();
    const key1 = s1['crdt.e2eeKey'];
    const salt1 = s1['crdt.e2eeSalt'];
    report.assert('设备 1 已派生密钥（crdt.e2eeKey）', !!key1, fp(key1));
    report.assert('设备 1 已生成本机盐（crdt.e2eeSalt）', !!salt1, fp(salt1));
    report.equals(
      '口令明文备份写入本机（crdt.passphrase，便于加密面板查看）',
      s1['crdt.passphrase'],
      cfg.passphrase,
    );
    extra.saltFingerprint = fp(salt1);
    extra.keyFingerprint = fp(key1);

    const pushedSalt = await cloud.waitCloud(
      () => (cloud.profile(uid)?.e2ee_salt === salt1 ? salt1 : null),
      { timeoutMs: 25_000, intervalMs: 400 },
    );
    report.assert(
      '设备 1 的盐已上传云端（新设备才有盐可拉、才会走「验证口令」）',
      pushedSalt === salt1,
      pushedSalt
        ? '云端盐与设备 1 一致'
        : `云端盐=${fp(cloud.profile(uid)?.e2ee_salt)}，设备 1 盐=${fp(salt1)}`,
    );

    // 播种：1 个文件夹 + 2 个书签（标题/域名带 marker，用于明文泄漏探测）
    const other = await dev1.otherBookmarksId();
    const folder = await dev1.bookmarksCreate({ parentId: other, title: `${MARKER}-folder` });
    await dev1.bookmarksCreate({
      parentId: folder.id,
      title: `${MARKER}-a`,
      url: `https://${MARKER}.test/1`,
    });
    await dev1.bookmarksCreate({
      parentId: folder.id,
      title: `${MARKER}-b`,
      url: `https://${MARKER}.test/2`,
    });
    report.info('已在本机建 1 文件夹 + 2 书签', `folder id=${folder.id}`);

    const r1 = await dev1.triggerSync(cfg.timeouts.sync);
    report.assert('设备 1 同步成功', r1?.ok === true, JSON.stringify(r1).slice(0, 200));

    const stats = await cloud.waitCloud(
      () => {
        const s = cloud.opStats(uid, MARKER);
        return s.ops > 0 ? s : null;
      },
      { timeoutMs: 40_000, intervalMs: 800 },
    );
    const canTestWrongPhrase = !!stats && stats.ops > 0;
    report.assert(
      '云端已收到 op（错口令测试的前提）',
      canTestWrongPhrase,
      canTestWrongPhrase
        ? `op=${stats.ops}`
        : 'op=0 —— 云端无密文时 verifyPassphrase 会「无数据可验 → 放行」，错口令测试会变成空的',
    );
    if (canTestWrongPhrase) {
      report.equals('云端 op 全为密文信封（iv + ciphertext）', stats.not_enveloped, 0);
      report.equals('云端 op 里搜不到明文 marker（标题/URL 未泄漏）', stats.leaks, 0);
      extra.opsAfterSeed = stats.ops;
    }

    // ------------------------------------------------------- 设备 2：错口令
    report.section('设备 2（全新 profile）：登录 → 错口令被拒 → 对口令通过');
    const dev2 = await boot('dev2');
    devices.push(dev2);
    const p2 = await dev2.openPopup();

    gate = await waitGate(p2, (g) => g.kind === 'auth', cfg.timeouts.gate);
    report.equals('新设备初始落在登录页', gate.kind, 'auth');
    gate = await login(p2, cfg);
    report.equals('新设备登录后进入口令门禁', gate.kind, 'phrase');
    report.equals(
      '门禁模式 = 验证口令（云端已有盐）',
      gate.title,
      await dev2.i18n('gate_titleVerify'),
    );

    if (!canTestWrongPhrase) {
      report.fail('错口令被拒（未执行）', '前置未满足：云端没有可验证的密文，此断言会退化成假绿');
    } else {
      const wrongPhrase = `${cfg.passphrase}-wrong`;
      await submitPhrase(p2, wrongPhrase);
      const errWrong = await dev2.i18n('gate_errWrong');
      const errCheck = await dev2.i18n('gate_errCheck');
      const shown = await p2.waitUntil(
        async (pg) => {
          const e = await pg.textOf('.gate-err');
          return e ? e : null;
        },
        { timeoutMs: 40_000, intervalMs: 400 },
      );
      report.equals(
        '错口令：显示「口令不正确」',
        shown,
        errWrong,
        shown === errCheck ? '（拿到的是「无法校验」文案 = 被当成网络错误）' : '',
      );

      const afterWrong = await readGate(p2);
      report.assert(
        '错口令：仍停在门禁页（没有被放行到主界面）',
        afterWrong.kind === 'phrase',
        `实际 ${afterWrong.kind}`,
      );
      const s2bad = await dev2.storage();
      report.assert(
        '错口令：本机密钥已回滚（crdt.e2eeKey 不存在）',
        !s2bad['crdt.e2eeKey'],
        fp(s2bad['crdt.e2eeKey']),
      );
      report.assert(
        '错口令：本机盐已回滚（crdt.e2eeSalt 不存在）',
        !s2bad['crdt.e2eeSalt'],
        fp(s2bad['crdt.e2eeSalt']),
      );
      report.assert(
        '错口令：没有把口令明文写进本机（crdt.passphrase 不存在）',
        !s2bad['crdt.passphrase'],
        String(s2bad['crdt.passphrase'] ?? ''),
      );
    }

    // ------------------------------------------------------- 设备 2：对口令
    await submitPhrase(p2, cfg.passphrase);
    gate = await waitGate(p2, (g) => g.kind !== 'phrase' && g.kind !== 'boot', cfg.timeouts.gate);
    report.assert(
      '同口令：门禁关闭',
      gate.kind !== 'phrase',
      gate.kind === 'phrase'
        ? `仍停在门禁页 / 错误文案: ${gate.err || '(无)'}`
        : `落到 ${gate.kind}`,
    );
    report.assert('同口令：没有残留错误文案', !gate.err, gate.err);

    const s2 = await dev2.storage();
    const key2 = s2['crdt.e2eeKey'];
    const salt2 = s2['crdt.e2eeSalt'];
    report.assert(
      '两台设备派生出的密钥逐字节相同（盐 + 口令一致）',
      !!key2 && key2 === key1,
      key2 === key1 ? fp(key2) : `不符：设备1=${fp(key1)} 设备2=${fp(key2)}`,
    );
    report.equals('两台设备本机盐一致', salt2, salt1);
    report.equals('两台设备口令明文备份一致', s2['crdt.passphrase'], cfg.passphrase);
    extra.keyMatched = key2 === key1;

    // 通过后的去向（不是本场景的契约，只记录，方便人眼看下一步）
    report.info(
      '通过后落到',
      `${gate.kind}（本账号 plan=${prof.plan}、云端 ${cloud.spaces(uid).length} 个空间）`,
    );

    return extra;
  } finally {
    for (const d of devices) {
      await d
        .close({ keepProfile: cfg.keepProfiles })
        .catch((e) => report.info('关闭设备失败', e.message));
    }
  }
}
