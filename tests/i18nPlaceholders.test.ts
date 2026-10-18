/**
 * tests/i18nPlaceholders.test.ts — 全量占位符守卫
 *
 * 取文案机制见 src/lib/i18n.ts：chrome.i18n.getMessage(key, subs)，占位符按
 *   - 位置型：$1、$2 …（也接受 $1$ 形式）
 *   - 具名型：$NAME$（Chrome 对占位符名大小写不敏感，$NAME$ 能匹配定义的 name）
 * 两种形态注入。本测试只解析本地 JSON 文本（不依赖浏览器），做两件事：
 *
 *  断言一：本分支新增的 7 个 AI 键，三侧（en / zh_CN / zh_TW）占位符编号集合必须一致
 *          （集合比较，不是字符串比较——dpe_group 是 {$1,$2} 双占位符也要能对上）。
 *  断言二：任何键的 message 不允许出现「非法占位符」形态：
 *          - 合法：$数字$ / $NAME$（多字母具名）
 *          - 非法：单大写字母具名 $N$（历史坏写法，本意应是 $1）、未闭合 $、字母数字混合等。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ 实测现状（2026-10-18，本分支）：zh_CN / zh_TW 的 7 个分支键已修正为 $1/$2，
 *    但 **en 侧这 7 个键仍是坏的**（$N 位置型占位符、dpe_group 的 $2 未改、placeholders
 *    段缺失）。这些坏形态已提交进本分支 HEAD，是分支基线状态。因此断言一/二对 en 当前
 *    无法绿。下面的 KNOWN_UNFIXED_EN 把它们**显式标记为「本分支待修」**（可见、非静默
 *    豁免）：待 en 侧补齐修复后，把 KNOWN_UNFIXED_EN 清空，断言一即恢复三侧一致强制、
 *    断言二即恢复对 en 的非法占位符守卫。请勿为「让测试绿」而把待修键挪进
 *    KNOWN_BROKEN（那是确定不修的历史债务，性质不同）。
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const LOCALES = ['en', 'zh_CN', 'zh_TW'] as const;
type Locale = (typeof LOCALES)[number];

interface MsgEntry {
  message: string;
  placeholders?: Record<string, { content: string }>;
}

function load(loc: Locale): Record<string, MsgEntry> {
  return JSON.parse(
    readFileSync(new URL(`../public/_locales/${loc}/messages.json`, import.meta.url), 'utf8'),
  ) as Record<string, MsgEntry>;
}

const data = Object.fromEntries(LOCALES.map((l) => [l, load(l)])) as Record<
  Locale,
  Record<string, MsgEntry>
>;

// 完整占位符 token：$1 / $N$ / $NAME$ / $1$ 等（捕获整段，含首尾 $）
const TOKEN_RE = /\$([A-Za-z0-9_]*)\$?/g;

function placeholderTokens(msg: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(msg))) out.push(m[0]);
  return out;
}

// 位置型占位符编号集合（{$1,$2} 之类），用于断言一
function positionalSet(msg: string): Set<number> {
  const re = /\$(\d+)/g;
  const s = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(msg))) s.add(Number(m[1]));
  return s;
}

// 判定某 token 是否为非法占位符形态
//   合法：纯数字（位置型） / 多字母具名并以 $ 闭合（如 $NAME$，Chrome 大小写不敏感可工作）
//   非法：单大写字母具名 $N$（历史坏写法，本意应为 $1）/ 未闭合 / 字母数字混合
function isIllegalToken(tok: string): boolean {
  const inner = tok.slice(1, tok.endsWith('$') ? -1 : undefined); // 去掉首尾 $
  if (/^\d+$/.test(inner)) return false; // $1 $2 ...
  if (/^[A-Z]$/.test(inner) && tok.endsWith('$')) return true; // $N$ 单字母具名
  // 其它：未闭合、或混合字母数字、或下划线开头等
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(inner) || !tok.endsWith('$')) return true;
  return false;
}

function illegalTokens(msg: string): string[] {
  return placeholderTokens(msg).filter(isIllegalToken);
}

// ── 历史债务豁免清单（逐键列举，禁止用正则糊弄）──────────────────────────────
// 历史债务，非本分支引入，确定不修。修完历史债务后从清单移除。
// 实读三侧 locale：真正含字面 $N$ 占位符的键只有 4 个（均为早期时间/配额键）。
// 注：被任务点名的部分「时间/配额/绑定」键（如 bind_doneTitle）实际用的是合法
//     $NAME$ 形态（大小写不敏感可正常替换），并不含 $N$，故不在豁免范围内。
const KNOWN_BROKEN = [
  'time_min', // "$N$ min ago" — 本意应为 $1
  'time_hour', // "$N$ h ago"
  'time_day', // "$N$ d ago"
  'quota_countOf', // "/ $N$ items"
];

// ── 本分支已修复清单（曾为 en 侧待修，现已完成）────────────────────────────
// 本分支引入的 7 个 AI 键；en 侧原为 $N（坏形态），已于 2026-10-18 修复为
// $1/$2 并补齐 placeholders 段，与 zh_CN/zh_TW 一致。历史迭代里曾用 KNOWN_UNFIXED_EN
// 临时放行 en，修复后清空，断言一/二即对三侧强制守卫。⚠️ 不要把任何键挪进
// KNOWN_BROKEN —— 那是确定不修的历史债务（time_min 等 $N$ 键），性质不同。
const KNOWN_UNFIXED_EN: string[] = [];

// 断言一覆盖「三侧都存在的全部键」，en 修复后三侧占位符编号集合应一致
const BRANCH_KEYS = Object.keys(data.en).filter((k) => data.zh_CN[k] && data.zh_TW[k]);

describe('locale 占位符守卫', () => {
  const enKeys = Object.keys(data.en);

  describe('断言一：三侧占位符编号集合一致', () => {
    for (const k of BRANCH_KEYS) {
      it(`${k}：zh_CN 与 zh_TW 编号集合一致`, () => {
        const a = [...positionalSet(data.zh_CN[k].message)].sort((x, y) => x - y).join(',');
        const b = [...positionalSet(data.zh_TW[k].message)].sort((x, y) => x - y).join(',');
        expect(a, `${k} zh_CN/zh_TW 不一致（已修复侧内部不一致，是真 bug）`).toBe(b);
      });

      it(`${k}：en 与 zh_CN 编号集合一致`, () => {
        const en = [...positionalSet(data.en[k].message)].sort((x, y) => x - y).join(',');
        const zh = [...positionalSet(data.zh_CN[k].message)].sort((x, y) => x - y).join(',');
        expect(en, `${k} en 与 zh_CN 占位符不一致（en 应是 $1/$2）`).toBe(zh);
      });
    }
  });

  describe('断言二：不允许非法占位符（除历史债务豁免与 en 待修）', () => {
    it('暴露历史坏键清单（已知 $N$ 债），便于追踪', () => {
      // eslint-disable-next-line no-console
      console.log(
        '[i18nPlaceholders] KNOWN_BROKEN 历史债务（$N$ 占位符）:',
        KNOWN_BROKEN.join(', '),
      );
      // eslint-disable-next-line no-console
      console.log(
        '[i18nPlaceholders] KNOWN_UNFIXED_EN 本分支待修(en):',
        KNOWN_UNFIXED_EN.join(', '),
      );
    });

    // 全量扫描：除豁免与待修外，所有键（三侧）都不得含非法占位符
    const unexpected: string[] = [];
    for (const l of LOCALES) {
      for (const k of Object.keys(data[l])) {
        if (KNOWN_BROKEN.includes(k)) continue;
        if (l === 'en' && KNOWN_UNFIXED_EN.includes(k)) continue; // en 待修，跳过
        const bad = illegalTokens(data[l][k].message);
        if (bad.length) unexpected.push(`${l}/${k} -> ${bad.join(', ')}`);
      }
    }
    it('除 KNOWN_BROKEN 与 en 待修外，所有键均无非法占位符', () => {
      expect(unexpected, `发现未豁免的非法占位符:\n${unexpected.join('\n')}`).toEqual([]);
    });

    // 逐键细用例，定位更友好
    for (const k of enKeys) {
      if (KNOWN_BROKEN.includes(k)) {
        it(`[历史债务豁免] ${k} 含 $N$ 占位符（确定不修，待清理）`, () => {
          const bad = LOCALES.flatMap((l) => illegalTokens(data[l][k].message));
          expect(bad.length).toBeGreaterThan(0); // 证明豁免确有依据
        });
        continue;
      }
      it(`键 ${k} 无非法占位符`, () => {
        const bad = LOCALES.flatMap((l) => {
          if (l === 'en' && KNOWN_UNFIXED_EN.includes(k)) return []; // en 待修，跳过
          return illegalTokens(data[l][k]?.message ?? '');
        });
        expect(bad, `${k} 含非法占位符: ${bad.join(', ')}`).toEqual([]);
      });
    }
  });
});
