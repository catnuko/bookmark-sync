import { ref, onMounted } from 'vue';

// 离线安装包与版本元数据托管在 Supabase Storage public bucket `downloads`
// （release.yml 发版时上传 zip + 写 latest.json），官网运行时读取 —— 发新版官网
// 无需重新部署。
export const STORAGE_BASE =
  'https://cwtqnsbpcetvqopdkcou.supabase.co/storage/v1/object/public/downloads';

/** latest.json 拉取失败时的兜底版本号，用于仍能拼出（可能过期的）下载链接。 */
export const FALLBACK_VERSION = '2.2.0';

const VERSION_RE = /^\d+(\.\d+)*$/;

/** 版本号是否形如 1.2.3 —— 防止把异常响应写进页面。 */
export function isVersion(v) {
  return typeof v === 'string' && VERSION_RE.test(v);
}

/**
 * 读取**我们已发布的最新版本**（latest.json）。
 * 与「商店在架版本」（useStoreVersions）是两个不同口径：商店审核有延迟，
 * 二者经常不一致，官网要分开展示。
 */
export function useLatestVersion() {
  const version = ref(FALLBACK_VERSION);
  onMounted(async () => {
    try {
      const r = await fetch(`${STORAGE_BASE}/latest.json`, { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      if (isVersion(j?.version)) version.value = j.version;
    } catch {
      /* 网络异常时用内置版本号 */
    }
  });
  return { version };
}
