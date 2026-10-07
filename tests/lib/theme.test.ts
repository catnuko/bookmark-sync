/**
 * tests/lib/theme.test.ts — 设置页主题偏好。
 *
 * 这里最容易出错的不是解析，而是**降级**：非扩展环境（`api` 为 undefined）、
 * `matchMedia` 不可用、localStorage 被禁用时都必须安静地退回一个可用值，
 * 而不是把设置页整个打挂。所以重点覆盖这几条降级路径。
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  THEME_PREFS,
  applyTheme,
  readTheme,
  resolveTheme,
  writeTheme,
} from '../../src/lib/theme.js';

/** 装上最小的 DOM 替身；返回 documentElement 供断言 dataset。 */
function stubDom({ dark = false } = {}) {
  const el = { dataset: {} as Record<string, string> };
  vi.stubGlobal('document', { documentElement: el });
  vi.stubGlobal('window', {
    matchMedia: (media: string) => ({ media, matches: dark, addEventListener() {} }),
  });
  return el;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('resolveTheme', () => {
  it('显式偏好原样返回（不查系统）', () => {
    stubDom({ dark: true });
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('auto 跟随系统深色', () => {
    stubDom({ dark: true });
    expect(resolveTheme('auto')).toBe('dark');
    stubDom({ dark: false });
    expect(resolveTheme('auto')).toBe('light');
  });

  it('★ matchMedia 不可用时退回浅色，不抛穿', () => {
    vi.stubGlobal('window', {
      matchMedia: () => {
        throw new Error('not supported');
      },
    });
    expect(resolveTheme('auto')).toBe('light');
  });
});

describe('applyTheme', () => {
  it('把解析后的主题写进 documentElement[data-theme]', () => {
    const el = stubDom({ dark: false });
    applyTheme('dark');
    expect(el.dataset.theme).toBe('dark');
    applyTheme('light');
    expect(el.dataset.theme).toBe('light');
  });

  it('auto 落的是解析结果而不是 "auto"', () => {
    const el = stubDom({ dark: true });
    applyTheme('auto');
    expect(el.dataset.theme).toBe('dark');
  });
});

describe('降级：非扩展环境', () => {
  it('★ storage 不可用时 readTheme 返回 auto（不打挂设置页）', async () => {
    stubDom();
    // 测试环境没有 chrome/browser → lib/ext 的 api 是 undefined
    expect(await readTheme()).toBe('auto');
  });

  it('★ writeTheme 仍写同步镜像，即使权威存储写失败', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    const el = stubDom({ dark: true });
    await writeTheme('dark');
    expect(store.get('bs.theme')).toBe('dark');
    expect(el.dataset.theme).toBe('dark');
  });

  it('localStorage 抛错也不影响本次会话生效', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
    });
    const el = stubDom();
    await expect(writeTheme('dark')).resolves.toBeUndefined();
    expect(el.dataset.theme).toBe('dark');
  });
});

describe('与 chrome.storage 的交互', () => {
  it('★ readTheme 读 ui.theme，writeTheme 写 ui.theme（权威键与镜像键不同名）', async () => {
    const backing: Record<string, unknown> = { 'ui.theme': 'dark' };
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: backing[key] }),
          set: async (items: Record<string, unknown>) => {
            Object.assign(backing, items);
          },
        },
      },
    });
    const mirror = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mirror.get(k) ?? null,
      setItem: (k: string, v: string) => void mirror.set(k, v),
    });
    stubDom();

    // api 是模块级绑定 → 必须在 stub 之后重新加载模块
    vi.resetModules();
    const mod = await import('../../src/lib/theme.js');

    expect(await mod.readTheme()).toBe('dark');
    await mod.writeTheme('light');
    expect(backing['ui.theme']).toBe('light');
    // 镜像键刻意与权威键不同名，两处都写、值一致
    expect(mirror.get('bs.theme')).toBe('light');
  });

  it('坏值一律按 auto', async () => {
    const backing: Record<string, unknown> = { 'ui.theme': 'hotdog' };
    vi.stubGlobal('chrome', {
      storage: {
        local: { get: async (key: string) => ({ [key]: backing[key] }), set: async () => {} },
      },
    });
    stubDom();
    vi.resetModules();
    const mod = await import('../../src/lib/theme.js');
    expect(await mod.readTheme()).toBe('auto');
  });
});

describe('THEME_PREFS', () => {
  it('三态且顺序与分段控件一致', () => {
    expect(THEME_PREFS).toEqual(['auto', 'light', 'dark']);
  });
});
