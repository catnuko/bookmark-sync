/**
 * src/lib/theme.ts — 设置页主题（auto / light / dark）。
 *
 * ## 只作用于设置页
 *
 * 只有 `src/main.ts`（options 入口）调用 `initTheme()`；`src/popup-main.ts`
 * **不调** —— 弹窗是窄屏高频操作面，视口与信息密度都不同，暂不跟随主题。
 * 因此这里写的是 `document.documentElement[data-theme]`，而 popup 页面永远不会
 * 有这个属性，`tokens.css` 的 `[data-theme='dark']` 映射对它天然不生效。
 *
 * ## 两处存储：storage.local 是权威，localStorage 是防闪的同步镜像
 *
 * `chrome.storage.local.get` 是异步的，等它回来再设 `data-theme` 会先按浅色画
 * 一帧再翻深色（FOUC）。所以启动时先用 `localStorage` 的同步镜像立刻设一次，
 * 再用 storage 的权威值校正。两处都在 `writeTheme` 里写，保持同值。
 *
 * 镜像键与 storage 键**刻意不同名**（`bs.theme` vs `ui.theme`）：两者是不同
 * 存储域，同名只会让读代码的人误以为是一份数据。
 *
 * ## auto 跟随系统
 *
 * `prefers-color-scheme` 变化时只在**当前是 auto** 时重设，否则会把用户显式选的
 * 浅色/深色覆盖掉。
 */

import { api } from './ext.js';

export type ThemePref = 'auto' | 'light' | 'dark';

/** 权威存储键（chrome.storage.local）。 */
const STORAGE_KEY = 'ui.theme';
/** 同步镜像键（localStorage，仅用于首帧防闪）。 */
const MIRROR_KEY = 'bs.theme';

export const THEME_PREFS: readonly ThemePref[] = ['auto', 'light', 'dark'];

/** 当前偏好（模块级，供系统主题变化的回调判断该不该重设）。 */
let current: ThemePref = 'auto';
let mq: MediaQueryList | null = null;

function isPref(v: unknown): v is ThemePref {
  return v === 'auto' || v === 'light' || v === 'dark';
}

/** 把偏好解析成实际生效的主题；auto 走系统设置，取不到时退回浅色。 */
export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'light' || pref === 'dark') return pref;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** 把偏好落到 DOM。同时记下 current，供系统主题回调判断。 */
export function applyTheme(pref: ThemePref): void {
  current = pref;
  document.documentElement.dataset.theme = resolveTheme(pref);
}

/** 读权威偏好。缺值 / 坏值一律按 auto。 */
export async function readTheme(): Promise<ThemePref> {
  try {
    const got = await api.storage.local.get(STORAGE_KEY);
    const v = got[STORAGE_KEY];
    return isPref(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** 写偏好：立刻生效 + 落镜像 + 落权威存储。写失败不回滚（下次打开读旧值）。 */
export async function writeTheme(pref: ThemePref): Promise<void> {
  applyTheme(pref);
  try {
    localStorage.setItem(MIRROR_KEY, pref);
  } catch {
    /* 隐私模式 / 配额满：镜像只是防闪优化，失败不影响功能 */
  }
  try {
    await api.storage.local.set({ [STORAGE_KEY]: pref });
  } catch {
    /* storage 写失败：本次会话仍生效，下次打开退回旧值 */
  }
}

function onSystemChange(): void {
  if (current === 'auto') applyTheme('auto');
}

/**
 * 初始化主题。**必须尽早调用**（options 入口在 `createApp` 之前），
 * 先同步设一次镜像值避免 FOUC，再异步用权威值校正，最后挂系统主题监听。
 */
export function initTheme(): void {
  let pref: ThemePref = 'auto';
  try {
    const m = localStorage.getItem(MIRROR_KEY);
    if (isPref(m)) pref = m;
  } catch {
    /* 读不到镜像 → auto */
  }
  applyTheme(pref);

  void readTheme().then((p) => {
    applyTheme(p);
    try {
      localStorage.setItem(MIRROR_KEY, p);
    } catch {
      /* 同上 */
    }
  });

  try {
    mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', onSystemChange);
  } catch {
    mq = null;
  }
}
