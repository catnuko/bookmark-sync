/**
 * tests/sync/binding.test.ts — 设备 ↔ 空间绑定决策（纯函数）。
 *
 * 锁死的不变式（破坏任意一条都会让用户失去选择权或丢书签）：
 *   1. **有真选择时必须问用户**（`ask_user`）——擅自替用户绑定会抹掉「本机从未
 *      绑定过」这个事实，用户再也没机会决定这台电脑的归属。两种真选择：
 *      云端 ≥2 个空间，或账号还能新建空间（付费档）；
 *   2. 没得选时不弹（全新账号自动建默认空间；免费档在新设备上只有一个旧空间
 *      可加入，静默并入）；
 *   3. 已绑定就照常同步，不重复引导；
 *   4. `canCreateSpace` 只按「是不是免费档」判——不复刻服务端的 plan→上限映射；
 *   5. 绑定模式非法值一律退回 `merge`（不破坏本机数据的那个），
 *      绝不能因为乱值而误走「清空本机」的 `overwrite`。
 */

import { describe, it, expect } from 'vitest';
import {
  firstBindAction,
  isPaidPlan,
  normalizeBindMode,
  parseBinding,
  bindGateNeeded,
} from '../../src/sync/index.js';

describe('firstBindAction — 首绑决策', () => {
  it('已绑定：照常同步，不重复引导', () => {
    for (const canCreate of [true, false]) {
      expect(firstBindAction(0, true, canCreate)).toBe('already');
      expect(firstBindAction(1, true, canCreate)).toBe('already');
      expect(firstBindAction(5, true, canCreate)).toBe('already');
    }
  });

  it('账号下一个空间都没有 → 自动建默认空间（无论档位，没得选）', () => {
    expect(firstBindAction(0, false, true)).toBe('create_default');
    expect(firstBindAction(0, false, false)).toBe('create_default');
  });

  it('免费档 + 唯一空间 → 静默绑定，不弹（新设备只有一个旧空间可加入）', () => {
    expect(firstBindAction(1, false, false)).toBe('auto_bind');
  });

  it('付费档 + 唯一空间 → 要问（可为这台电脑单开一个空间）', () => {
    // 这是 D 方案下唯一能「新建 + 绑定」的时机：错过之后想单开，得先新建再换绑，
    // 而换绑要清空本机书签。所以哪怕只有一个旧空间也要问。
    expect(firstBindAction(1, false, true)).toBe('ask_user');
  });

  it('多个空间 → 必须问用户（擅自绑定会让用户永久失去选择权）', () => {
    for (const canCreate of [true, false]) {
      expect(firstBindAction(2, false, canCreate)).toBe('ask_user');
      expect(firstBindAction(3, false, canCreate)).toBe('ask_user');
      expect(firstBindAction(99, false, canCreate)).toBe('ask_user');
    }
  });
});

describe('isPaidPlan — 「还能不能新建空间」只看档位', () => {
  it('付费档（含历史档名）→ 可以新建', () => {
    for (const plan of ['plus', 'premium', 'basic', 'pro', 'lifetime', 'team']) {
      expect(isPaidPlan(plan)).toBe(true);
    }
  });

  it('免费档 / 未知档 → 不能新建', () => {
    for (const plan of ['free', '', undefined, null, 0, false, {}, []]) {
      expect(isPaidPlan(plan)).toBe(false);
    }
  });
});

describe('normalizeBindMode — 绑定模式归一化', () => {
  it('保留合法值', () => {
    expect(normalizeBindMode('merge')).toBe('merge');
    expect(normalizeBindMode('overwrite')).toBe('overwrite');
  });

  it('非法值一律退回 merge（绝不误走清空本机）', () => {
    for (const bad of [undefined, null, '', 'MERGE', 'Overwrite', 'clear', 0, 1, {}, []]) {
      expect(normalizeBindMode(bad)).toBe('merge');
    }
  });
});

describe('parseBinding — 绑定记录的归属判定', () => {
  const ME = 'user-a';
  const OTHER = 'user-b';

  it('同一账号写下的绑定照常生效（重登不能被当成新设备）', () => {
    expect(parseBinding({ u: ME, s: 'space-1' }, ME)).toEqual({
      ownerId: ME,
      spaceId: 'space-1',
      mine: true,
      legacy: false,
    });
  });

  it('换账号后不得继承上一个账号的绑定', () => {
    // 关键：不继承不是因为「查不到」，而是因为归属账号不符。继承了会把本机书签
    // 树错误地并进别人（或自己的另一个）空间，最坏情况是写进不相干的空间。
    expect(parseBinding({ u: OTHER, s: 'space-1' }, ME).mine).toBe(false);
    expect(parseBinding({ u: OTHER, s: 'space-1' }, ME).spaceId).toBe('space-1');
  });

  it('未登录（账号为空）时不认任何带账号的绑定', () => {
    expect(parseBinding({ u: ME, s: 'space-1' }, '').mine).toBe(false);
  });

  it('旧格式（裸字符串）按本机记录接受，并标记待升级', () => {
    // 不能因为「没写账号」就把用户的绑定丢掉——那会让老记录持有者重登后被
    // 重新问一遍（正是要修的那个 bug）。
    expect(parseBinding('space-1', ME)).toEqual({
      ownerId: '',
      spaceId: 'space-1',
      mine: true,
      legacy: true,
    });
    expect(parseBinding('space-1', '').mine).toBe(true);
  });

  it('从未绑定 / 垃圾值 → 明确报「没有绑定」', () => {
    for (const empty of [undefined, null, '', 0, false, [], {}, { u: ME }, { s: '' }]) {
      expect(parseBinding(empty, ME)).toEqual({
        ownerId: '',
        spaceId: '',
        mine: false,
        legacy: false,
      });
    }
  });

  it('半截记录（有空间无账号）按本机记录接受，不算旧格式', () => {
    expect(parseBinding({ s: 'space-1' }, ME)).toEqual({
      ownerId: '',
      spaceId: 'space-1',
      mine: true,
      legacy: false,
    });
  });
});

describe('bindGateNeeded — 首绑门禁是否该挡住界面', () => {
  it('从未绑定 + 有真选择 → 挡住（必须选）', () => {
    expect(bindGateNeeded(2, false, false, true)).toBe(true);
    expect(bindGateNeeded(9, false, false, true)).toBe(true);
    expect(bindGateNeeded(2, false, false, false)).toBe(true); // 免费但有多个历史空间：也得问
    expect(bindGateNeeded(1, false, false, true)).toBe(true); // 付费 + 唯一空间：可以为新设备单开
  });

  it('已绑定 / 无空间 / 免费档单空间 → 不挡（内部自决）', () => {
    expect(bindGateNeeded(3, true, false, true)).toBe(false);
    expect(bindGateNeeded(0, false, false, true)).toBe(false);
    expect(bindGateNeeded(0, false, false, false)).toBe(false);
    expect(bindGateNeeded(1, false, false, false)).toBe(false);
  });

  it('绑定空间被删（stale）不算从未绑定 → 不挡，走显式换绑', () => {
    for (const canCreate of [true, false]) {
      expect(bindGateNeeded(3, false, true, canCreate)).toBe(false);
      expect(bindGateNeeded(1, false, true, canCreate)).toBe(false);
    }
  });

  it('判据与同步侧 firstBindAction 同源（两边分头写迟早死锁）', () => {
    for (const n of [0, 1, 2, 5]) {
      for (const bound of [true, false]) {
        for (const canCreate of [true, false]) {
          expect(bindGateNeeded(n, bound, false, canCreate)).toBe(
            firstBindAction(n, bound, canCreate) === 'ask_user',
          );
        }
      }
    }
  });
});
