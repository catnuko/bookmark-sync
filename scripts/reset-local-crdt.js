/**
 * 本机 CRDT 状态重置（扩展页控制台粘贴运行）。
 *
 * ⚠️ **会清本机映射与水位**，让扩展下次同步从云端零状态重建。
 *    云端 op 必须**已**清空，否则会按旧 op 重放回来。
 *
 * 刻意**保留**：`crdt.e2eeKey` / `crdt.e2eeSalt` / `crdt.passphrase` / `crdt.deviceId`
 *   —— 保留才能跳过口令门禁、保持设备 id 不变（换 id 会被当新设备）。
 * 刻意**清除**：映射 / 水位 / 计数器 / 回退记录 / 绑定记录
 *   —— 绑定必须清，否则本机仍认为「已绑这个空间」，绑定态与清空后的云端不一致。
 *
 * 跑法：扩展页 Console 整段粘贴。**先看打印的清单，确认无误再执行 remove。**
 */
(async () => {
  const SPACE = '007049cf-064f-4820-8898-c7cf45e4b259';

  // 按前缀匹配该空间的全部分区键
  const PREFIXES = ['crdt.idmap.', 'crdt.afterId.', 'crdt.counter.', 'crdt.fallbackRoots.'];
  const EXACT = [
    'crdt.menuFolderId',
    'crdt.seeded',
    'crdt.spaceMigrated',
    'crdt.onboardSkipped',
    'crdt.spaceRoots',
    'crdt.activeSpace',
    'crdt.activeSpaceId',
    'lastSyncAt',
    'lastSyncSummary',
    'lastDecryptErrors',
    'lastGcAt',
    'lastGcSkipped',
    'boundSpaceId', // 解除绑定 → 下次走「首绑」流程重新选
  ];

  const all = await chrome.storage.local.get(null);
  const kill = [
    ...Object.keys(all).filter((k) => PREFIXES.some((p) => k.startsWith(p)) && k.endsWith(SPACE)),
    ...EXACT.filter((k) => k in all),
  ];
  const keep = [
    'crdt.e2eeKey',
    'crdt.e2eeSalt',
    'crdt.passphrase',
    'crdt.deviceId',
    'crdt.errorReport',
  ];

  console.log('=== 将删除', kill.length, '个键 ===');
  console.log(kill.join('\n'));
  console.log('\n=== 将保留（密钥/口令/设备 id）===');
  for (const k of keep)
    console.log(' ', k, '=', k in all ? JSON.stringify(all[k]).slice(0, 40) : '(未设置)');

  const hard = kill.filter((k) => k === 'crdt.e2eeKey' || k === 'crdt.passphrase');
  if (hard.length) {
    console.error('⛔ 命中受保护键，中止：', hard);
    return 'ABORTED';
  }

  await chrome.storage.local.remove(kill);
  console.log('\n✅ 已清除。现在刷新扩展页（chrome://extensions → 刷新图标），再点同步。');
  console.log('   预期：把本机现有书签重新上传为首批 op（云端 currently 为空）。');
  return 'DONE';
})();
