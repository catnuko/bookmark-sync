/**
 * tests/worktreeinclude.test.ts — 新建 worktree 必须自动带上本地凭据。
 *
 * 背景（2026-10-20）：`.dev-creds.json` 是 gitignored 的本地开发凭据
 * （vite.config.js 读它注入 `__DEV_CREDS__`）。`git worktree add` 只检出被跟踪
 * 的文件，所以**新 worktree 天然没有它** → 构建时注入空串 → 测试包里登录邮箱 /
 * 密码 / 口令全空，每次都要手输。
 *
 * 排查「Firefox 产物没有默认凭据」时就栽在这里：加载的 worktree 缺这个文件，
 * 而目录里躺着旧构建产物，看起来像构建配置问题，实际是文件没带过去。
 *
 * 修复用 Claude Code 的 `.worktreeinclude`（注意：**不是 git 的功能**）：
 * 新建 worktree 时，把「匹配该文件模式」**且**「本身已被 .gitignore」的文件从
 * 主仓库复制过去。两个条件缺一不可 —— 只写模式而文件没被忽略，复制不会发生。
 *
 * 本测试锁死这个契约：`.worktreeinclude` 必须存在、必须包含 `.dev-creds.json`，
 * 且所列条目必须真的在 .gitignore 里（否则是一条静默失效的配置）。
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';

const ROOT = new URL('..', import.meta.url).pathname;
const includePath = new URL('../.worktreeinclude', import.meta.url);

/** 读 .worktreeinclude 里的有效模式（去掉注释与空行）。 */
function readPatterns(): string[] {
  if (!existsSync(includePath)) return [];
  return readFileSync(includePath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

describe('.worktreeinclude', () => {
  it('文件存在（否则新 worktree 拿不到本地凭据）', () => {
    expect(existsSync(includePath)).toBe(true);
  });

  it('包含 .dev-creds.json（本地开发凭据）', () => {
    expect(readPatterns()).toContain('.dev-creds.json');
  });

  it('所列条目全部已被 .gitignore 覆盖（未忽略的条目复制不会生效）', () => {
    const patterns = readPatterns();
    expect(patterns.length).toBeGreaterThan(0);
    for (const p of patterns) {
      // git check-ignore 命中即说明该路径被忽略；未命中 = 这条配置是死的
      let ignored = true;
      try {
        execFileSync('git', ['check-ignore', '-q', p], { cwd: ROOT, stdio: 'ignore' });
      } catch {
        ignored = false;
      }
      expect(ignored, `${p} 没有被 .gitignore 忽略，写进 .worktreeinclude 不会生效`).toBe(true);
    }
  });
});
