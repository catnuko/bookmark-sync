/**
 * tests/release-please-config.test.ts — release-please 版本口径的护栏。
 *
 * 背景：release-please 只有一个根包 `.`，默认按**全仓**提交定版本 —— 网站提交会推高
 * 扩展版本号（2.10.1 → 2.15.1 期间 26/27 条提交是 website，扩展功能零变化）。我们用根包
 * 的 `exclude-paths` 把非扩展产物路径排除掉，让版本号只随扩展产物变化。
 *
 * 这个配置没有任何类型/运行时反馈：删了不会报错，只会在下次发版时静默地把网站变更算进
 * 版本号。所以在这里钉死两点：
 *   1) 预期排除的目录都在（尤其 `website`）；
 *   2) 排除项必须是**目录** —— release-please 的判据是 `file.indexOf(path + '/') === 0`，
 *      只做目录前缀匹配；写成文件路径（如 `AGENTS.md`）永远匹配不上，是无效配置。
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const config = JSON.parse(
  readFileSync(new URL('../release-please-config.json', import.meta.url), 'utf8'),
) as { packages: Record<string, { 'exclude-paths'?: string[] }> };

/** 非扩展产物路径：这些目录里的提交不应推高扩展版本号。 */
const EXPECTED_EXCLUDES = [
  '.claude',
  'website',
  'docs',
  'memory',
  'extension-infomation',
  'supabase',
  'tests',
  '.github',
  'bookmark-sync',
];

describe('release-please-config.json 的版本口径', () => {
  it('根包配置了 exclude-paths', () => {
    expect(config.packages['.']?.['exclude-paths']).toBeInstanceOf(Array);
  });

  it('非扩展产物路径全部排除（尤其 website）', () => {
    const exclude = config.packages['.']?.['exclude-paths'] ?? [];
    for (const path of EXPECTED_EXCLUDES) {
      expect(exclude, `exclude-paths 缺少 ${path}`).toContain(path);
    }
  });

  it('排除项必须是目录（release-please 只做目录前缀匹配）', () => {
    const exclude = config.packages['.']?.['exclude-paths'] ?? [];
    for (const path of exclude) {
      // slice(1) 是为了放过 `.github` 这类以点开头的目录名；含扩展名即视为误写成文件。
      expect(path.slice(1), `${path} 像文件路径，exclude-paths 只匹配目录`).not.toContain('.');
    }
  });
});
