/**
 * tests/optionsNav.test.ts — 设置页首屏落哪个 pane（popup 入口跳转契约）。
 *
 * ## 回归背景（P0，2026-10-18 实测 100% 触发）
 *
 * popup 与 options 是**两个独立的 JS 上下文**，`state.navPane` 不共享。popup 的
 * 「整理书签」入口（PopupView.vue → openSettingsPage）于是走
 * `chrome.storage.session['options.pane'] = 'organize'` 传意图，读侧在
 * OptionsView.vue 的 onMounted 里消费。
 *
 * 而 OptionsView 的 onMounted 第一句是：
 *
 *     if (isPaneId(state.navPane)) return;   // 命中就直接 return
 *
 * 它判的是「用户是否已在**同一页内**切过 pane」。所以 store.ts 里 navPane 的
 * 初始值必须是**非法 pane id**（''）—— 填成任何真实 id（当时是 'ai'）都会让
 * 首次打开恒命中这个 return，后面读 storage.session 的整段逻辑变成死代码。
 * 后果：popup 点「整理书签」→ 设置页永远落在 AI 配置页，session 的写入与
 * 「用完即删」全部白做，且没有任何报错。
 *
 * 这里把三分支钉死（改 store.ts 默认值 / 改 isPaneId / 删 remove 都会被它抓到）：
 *   1. session 有合法值   → 落在该 pane，且 session 键被删（否则下次手动打开还停在这页）
 *   2. session 没有该键   → 落在 panes[0]（手动打开的默认页）
 *   3. session 读取抛错   → 落在 panes[0]，不把设置页打挂
 * 另有一条反过来的护栏：初始值若被填成合法 id，分支 1 必然失效。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// store.ts 顶层会 createClient(supabase)，它用 api.storage.local 当持久化后端；
// 测试里不装 chrome.storage.local → 构造时抛「Cannot read properties of
// undefined (reading 'local')」，且该异常在 GoTrueClient 的初始化链里是**异步
// 重抛**，会变成 unhandled rejection 把整个测试文件判红。与 tests/telemetry.test.ts
// 等同样的处理：把 supabase 模块整个 mock 掉。
vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    rpc: async () => ({ data: null, error: null }),
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) }),
  },
}));

// 六个 Pane* 组件各自挂载时会读配置 / 探活 / 拉统计 —— 与「落哪个 pane」无关，
// 且它们不是被测单元。这里只验证 onMounted 的分支，因此全部换成空壳。
vi.mock('../src/components/PaneAI.vue', () => ({ default: { name: 'PaneAI' } }));
vi.mock('../src/components/PaneAIChat.vue', () => ({ default: { name: 'PaneAIChat' } }));
vi.mock('../src/components/PaneOrganize.vue', () => ({ default: { name: 'PaneOrganize' } }));
vi.mock('../src/components/PaneLinkCheck.vue', () => ({ default: { name: 'PaneLinkCheck' } }));
vi.mock('../src/components/PaneOmnibox.vue', () => ({ default: { name: 'PaneOmnibox' } }));
vi.mock('../src/components/PaneHealth.vue', () => ({ default: '健康洞察' }));
vi.mock('../src/components/ui/Icon.vue', () => ({ default: { name: 'Icon' } }));
vi.mock('../src/components/ui/SegTabs.vue', () => ({ default: { name: 'SegTabs' } }));

/** popup 与 options 约定好的 session 键（两边各自定义同一字符串）。 */
const PANE_KEY = 'options.pane';

/** 仓库根（本文件在 tests/ 下）。 */
const ROOT = new URL('..', import.meta.url).pathname;

/** 收集 onMounted 注册的回调。真实 Vue 渲染会调它，这里手动调以便精确控制时序。 */
const mounted: Array<() => unknown> = [];

/**
 * 编译真实的 OptionsView.vue 并执行它的 `<script setup>`，把 onMounted 回调取回来。
 *
 * 为什么绕这么一圈而不是直接 import .vue：vitest.config.ts 没有配
 * @vitejs/plugin-vue（仓库里 vue 插件只用于 vite build），测试进程里 .vue 无法
 * 被 import。而本用例的判据全在 onMounted 里，靠读源码文本断言等于没测。
 * 所以用 vue/compiler-sfc（vue 自带，无需新增依赖）把 SFC 编成 ESM 再执行。
 *
 * 唯一改动是把 `onMounted` 换成收集器 —— 其余代码（含 isPaneId、panes、三分支）
 * 是编译器从 .vue 里原样产出的，与线上跑的是同一份。
 */
async function loadOptionsMounted(): Promise<Array<() => unknown>> {
  const { parse, compileScript } = await import('vue/compiler-sfc');
  const src = readFileSync(new URL('../src/components/OptionsView.vue', import.meta.url), 'utf8');
  const { descriptor } = parse(src, { filename: 'OptionsView.vue' });
  const compiled = compileScript(descriptor, { id: 'optionsNavTest', inlineTemplate: true });

  mounted.length = 0;
  (globalThis as Record<string, unknown>).__optionsNavMounted = mounted;

  // SFC 内部的相对 import 是相对 src/components/ 的；编译产物写到系统临时目录后
  // 必须改写成仓库绝对路径，否则 Node 解析不到模块。
  const patched = compiled.content
    .replace(
      /import \{ onMounted, ref \} from 'vue';/,
      `import { onMounted as __onMounted, ref } from 'vue';
const onMounted = (fn: () => unknown) => {
  ((globalThis as Record<string, unknown>).__optionsNavMounted as Array<() => unknown>).push(fn);
};`,
    )
    .replace(/from '\.\.\//g, `from '${ROOT}src/`)
    .replace(/from '\.\//g, `from '${ROOT}src/components/`);

  const dir = mkdtempSync(join(tmpdir(), 'bs-options-nav-'));
  const file = join(dir, 'OptionsView.compiled.ts');
  writeFileSync(file, patched, 'utf8');
  try {
    const mod = (await import(/* @vite-ignore */ file)) as unknown as {
      default: { setup?: () => unknown };
    };
    // 编译产物是 export default { setup() {…} }；手动调 setup 才会走到 onMounted 注册
    mod.default.setup?.();
    return mounted;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 装一个可控的 chrome.storage.session 替身；返回调用记录供断言。 */
function installSession(
  session: {
    get: (k: string) => Promise<Record<string, unknown>>;
    remove: (k: string) => Promise<void>;
  } | null,
) {
  const removed: string[] = [];
  const gets: string[] = [];
  const wrapped = session
    ? {
        get: async (k: string) => {
          gets.push(k);
          return session.get(k);
        },
        remove: async (k: string) => {
          removed.push(k);
          await session.remove(k);
        },
      }
    : null;
  (globalThis as Record<string, unknown>).chrome = {
    // 只装 onMounted 实际碰到的面：它不读 storage.local
    storage: wrapped ? { session: wrapped } : {},
  };
  return { removed, gets };
}

/**
 * 装最小 chrome.storage.local。
 *
 * onMounted 第一句是 `await readTheme()`（读 storage.local 的 'ui.theme'），
 * 没装到它只是降级成 'auto'、不影响被测分支；装它是为了让 store 模块加载时
 * supabase 的持久化后端不抛。session 由各用例随后用 installSession 覆盖。
 */
function installLocal() {
  (globalThis as Record<string, unknown>).chrome = {
    storage: { local: { get: async () => ({}) } },
  };
}

let state: { navPane: string };

/**
 * 取一份「刚打开的 options 页面」的 store 状态。
 *
 * ★ 刻意**不**手动把 navPane 拨成 '' —— 那会让用例与 store.ts 的初始值脱钩，
 * 等于把要守的东西亲手拆了。真实环境里 options 页面挂载时 navPane 就是 store.ts
 * 里的初始值，这里也必须如此，初始值一改就该有用例红。
 */
async function freshState(): Promise<{ navPane: string }> {
  installLocal();
  // vi.resetModules 让每个用例拿到**全新的 store 模块实例**（navPane 回到初始值），
  // 否则上一个用例写进去的 navPane 会带到下一个用例。
  vi.resetModules();
  const mod = (await import('../src/store.js')) as { state: { navPane: string } };
  return mod.state;
}

beforeEach(async () => {
  state = await freshState();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).chrome;
  delete (globalThis as Record<string, unknown>).__optionsNavMounted;
  mounted.length = 0;
  vi.resetModules();
});

describe('OptionsView 首屏 pane 校正（onMounted 三分支）', () => {
  it('store.ts 的 navPane 初始值是**非法** pane id（否则 popup 跳转必坏）', () => {
    // 这条是上面那场 P0 的直接护栏：初始值一旦变成合法 id，分支 1 就失效。
    // 合法 id 清单在 OptionsView.vue 的 panes 数组里，这里硬编码一份镜像
    // —— 刻意与那处保持独立：若有人往 panes 加新 pane，这个测试不会自动跟着变。
    const LEGAL = ['ai', 'aiChat', 'organize', 'links', 'omnibox', 'health'];
    expect(LEGAL).not.toContain(state.navPane);
    expect(state.navPane).toBe('');
  });

  it('session 有值 → 落在该 pane，且 session 键被删', async () => {
    const log = installSession({
      get: async () => ({ [PANE_KEY]: 'organize' }),
      remove: async () => {},
    });
    const cb = await loadOptionsMounted();
    await cb[0]();

    expect(state.navPane).toBe('organize');
    // 用完即删：不删的话，下次手动打开设置页也会落在这一页
    expect(log.removed).toEqual([PANE_KEY]);
    expect(log.gets).toEqual([PANE_KEY]);
  });

  it('session 无值 → 落在 panes[0]', async () => {
    const log = installSession({ get: async () => ({}), remove: async () => {} });
    const cb = await loadOptionsMounted();
    await cb[0]();

    // panes[0] 即「AI 配置」，与 OptionsView.vue 的 panes 数组顺序一致
    expect(state.navPane).toBe('ai');
    // 键不存在 → 不该调 remove（没有东西可删）
    expect(log.removed).toEqual([]);
  });

  it('session 读取抛错 → 落在 panes[0]，不把设置页打挂', async () => {
    installSession({
      get: async () => {
        throw new Error('session unavailable');
      },
      remove: async () => {},
    });
    const cb = await loadOptionsMounted();
    // 不能抛：设置页打不开比落错页更严重
    await expect(cb[0]()).resolves.toBeUndefined();
    expect(state.navPane).toBe('ai');
  });

  it('★ 反证：初始值若是合法 id，popup 传来的 pane 会被完全忽略', async () => {
    // 这是 2026-10-18 事故的复现 —— 把 state.navPane 预先设成合法值，
    // 断言 session 里的 'organize' 不再生效（即证明 return 短路确实存在）。
    const log = installSession({
      get: async () => ({ [PANE_KEY]: 'organize' }),
      remove: async () => {},
    });
    state.navPane = 'ai'; // 事故当日的错误默认值
    const cb = await loadOptionsMounted();
    await cb[0]();

    expect(state.navPane).toBe('ai'); // 不是 'organize'
    expect(log.gets).toEqual([]); // session 根本没被读过
    expect(log.removed).toEqual([]); // 也谈不上删
  });

  it('session 是坏值（非 pane id）→ 兜底到 panes[0]，但键仍被删', async () => {
    const log = installSession({
      get: async () => ({ [PANE_KEY]: 'no-such-pane' }),
      remove: async () => {},
    });
    const cb = await loadOptionsMounted();
    await cb[0]();

    expect(state.navPane).toBe('ai');
    // 坏值也要删：留着它没有意义，且下次打开还得再判一次
    expect(log.removed).toEqual([PANE_KEY]);
  });
});
