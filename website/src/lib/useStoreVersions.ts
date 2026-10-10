'use client';

import { useEffect, useState } from 'react';
import { STORAGE_BASE, isVersion } from './useLatestVersion';

const KEYS = ['chrome', 'edge', 'firefox'] as const;
export type StoreKey = (typeof KEYS)[number];
export type StoreVersion = { version: string; pending: string | null };
export type StoreVersions = Partial<Record<StoreKey, StoreVersion>>;

/**
 * 读取三家商店的**在架版本**（stores.json，由 .github/workflows/store-versions.yml
 * 定时采集写入；见 scripts/fetch-store-versions.mjs）。
 *
 * 与 latest.json（我们已发布的版本）语义不同，刻意分开两个文件。
 * 拉取失败时返回空对象 —— 官网只是不显示商店版本，下载链接与其它内容不受影响。
 */
export function useStoreVersions(): StoreVersions {
  const [storeVersions, setStoreVersions] = useState<StoreVersions>({});
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${STORAGE_BASE}/stores.json`, { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        const out: StoreVersions = {};
        for (const key of KEYS) {
          const entry = j?.[key];
          if (!isVersion(entry?.version)) continue;
          out[key] = {
            version: entry.version,
            // Chrome 有「已提交待审」版本时才有 pending；其余两家不产出该字段。
            pending: isVersion(entry?.pending) ? entry.pending : null,
          };
        }
        if (alive) setStoreVersions(out);
      } catch {
        /* 网络异常时不显示商店版本 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return storeVersions;
}
