// 扩展版本号，取自 manifest 的 `version`。
// 惰性读全局（与 lib/i18n.ts 同款），而不是 ext.ts 导出的 `api`：`api` 在模块初始化时
// 就把全局对象绑定死了，预览环境里 preview.html 的 mock 早于 preview.ts 的替换被绑定。
// 依次尝试 browser → chrome（与 ext.ts 的优先级一致）；Safari 页面自带一个 `browser`
// 全局（WebPageNamespace，无 getManifest），靠 `?.` 自动跳过并落到 chrome 上。
type ManifestApi = { runtime?: { getManifest?: () => { version?: string } | undefined } };

const g = globalThis as typeof globalThis & { browser?: ManifestApi; chrome?: ManifestApi };

/** 非扩展环境（preview / 单测）取不到 manifest，回落 `dev`。 */
export function appVersion(): string {
  try {
    for (const ns of [g.browser, g.chrome]) {
      const v = ns?.runtime?.getManifest?.()?.version;
      if (typeof v === 'string' && v) return v;
    }
  } catch {
    /* 非扩展环境取不到 manifest */
  }
  return 'dev';
}
