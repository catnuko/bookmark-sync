/**
 * 只读诊断（权威版）：用项目自己的 Replica 重放云端 op，看真实可见树。
 *
 * ⚠️ 只读：不写远端、不写本地状态，只在内存里重放。
 * 为什么不自己算 LWW：`apply_op` 的语义（undo/redo 递归、时间戳比较）比
 * 「同一 child 取最大 timestamp」复杂得多，简化会得出错误结论。
 *
 * 用法：
 *   E2EE_KEY=... SPACE_ID=... node scripts/replay-ops.mjs /tmp/ops-dump.txt
 */
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { build } from 'vite';
import { createServer } from 'vite';

void (async () => {
  const KEY = process.env.E2EE_KEY;
  const SPACE = process.env.SPACE_ID;
  const DUMP = process.argv[2];
  if (!KEY || !SPACE || !DUMP) {
    console.error('need E2EE_KEY / SPACE_ID / <dumpfile>');
    process.exit(1);
  }

  // 让 TS 源（../src/crdt/replica.ts 等）能被 node 直接 import
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'error' });
  const mod = await server.ssrLoadModule('/src/crdt/index.ts');
  const { Replica } = mod;
  await server.close();

  const ROOT_UUID = '00000000-0000-4000-8000-000000000000';
  const TRASH = '__trash__';

  const b64uToBytes = (s) => {
    const b = s.replace(/-/g, '+').replace(/_/g, '/');
    return new Uint8Array(Buffer.from(b + '='.repeat((4 - (b.length % 4)) % 4), 'base64'));
  };
  const key = await webcrypto.subtle.importKey(
    'raw',
    b64uToBytes(KEY),
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );

  const raw = readFileSync(DUMP, 'utf8');
  const rows = [];
  for (const line of raw.split('\n')) {
    const s = line.indexOf('{');
    if (s < 0) continue;
    const e = line.lastIndexOf('}');
    if (e <= s) continue;
    try {
      rows.push(JSON.parse(line.slice(s, e + 1)));
    } catch {
      /* 表格边框噪声 */
    }
  }
  rows.sort((a, b) => a.id - b.id);
  console.log(`rows=${rows.length}`);

  const replica = new Replica('diag-replay');
  let applied = 0;
  let failed = 0;
  for (const r of rows) {
    let op;
    try {
      const pt = await webcrypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: b64uToBytes(r.iv),
          additionalData: new TextEncoder().encode(SPACE),
        },
        key,
        b64uToBytes(r.ct),
      );
      op = JSON.parse(new TextDecoder().decode(pt));
    } catch {
      failed++;
      continue;
    }
    try {
      replica.receiveOp(op);
      applied++;
    } catch {
      failed++;
    }
  }

  const visible = replica.getVisibleTree();
  const PROTECTED = new Set([
    ROOT_UUID,
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000006',
    '00000000-0000-4000-8000-000000000007',
  ]);
  let bookmarks = 0;
  let folders = 0;
  const byParent = {};
  for (const e of visible) {
    if (PROTECTED.has(e.child)) continue;
    if (e.meta?.url) bookmarks++;
    else folders++;
    const k = e.parent.slice(0, 8);
    byParent[k] = (byParent[k] ?? 0) + 1;
  }
  // 直接落在 8 个固定根下的用户节点（历史脏 op 的特征）
  const rootChild = visible.filter((e) => PROTECTED.has(e.parent) && !PROTECTED.has(e.child));

  console.log(
    JSON.stringify(
      {
        applied,
        failed,
        visibleEdges: visible.length,
        userBookmarks: bookmarks,
        userFolders: folders,
        trashedTotal: replica.exportSnapshot
          ? Object.values(replica.exportSnapshot().nodes).filter((v) => v.parent === TRASH).length
          : null,
        rootChildUserNodes: rootChild.length,
        nodesByParentPrefix: byParent,
      },
      null,
      2,
    ),
  );
})();
