/**
 * 只读诊断：解密某个空间的云端 op，统计删除类 op / 可见树规模。
 * ⚠️ 只读：解密在本地完成，脚本不写任何远端数据。
 *
 * 用法：
 *   E2EE_KEY=... E2EE_SALT=... SPACE_ID=... node scripts/inspect-ops.mjs /tmp/ops-dump.json
 *
 * /tmp/ops-dump.json 由 supabase db query 导出：
 *   select jsonb_agg(jsonb_build_object('id',id,'op',op)) as rows
 *     from public.bsync_op_log where space_id='<SPACE>';
 *
 * 密钥来源：扩展 storage 的 crdt.e2eeKey / crdt.e2eeSalt（base64url 裸串）。
 */
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const KEY = process.env.E2EE_KEY;
const SALT = process.env.E2EE_SALT;
const SPACE = process.env.SPACE_ID;
const DUMP = process.argv[2] ?? '/tmp/ops-dump.json';

if (!KEY || !SALT || !SPACE) {
  console.error('need E2EE_KEY / E2EE_SALT / SPACE_ID');
  process.exit(1);
}

const enc = new TextEncoder();
const SPACE_ID = SPACE;
const ROOT_UUID = '00000000-0000-4000-8000-000000000000';
const TRASH = '__trash__';

function b64uToBytes(s) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b + '='.repeat((4 - (b.length % 4)) % 4);
  return new Uint8Array(Buffer.from(pad, 'base64'));
}

/**
 * `crdt.e2eeKey` 存的是**已派生好的裸密钥**（base64url 32B，key.ts:62 exportKey
 * → :70 importKey 直接 import），**不再走 PBKDF2**。口令+salt 只在生成时用一次。
 * 误用 PBKDF2 会让每条 op 都解密失败（OperationError）。
 */
async function loadKey() {
  return webcrypto.subtle.importKey(
    'raw',
    b64uToBytes(KEY),
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

async function decrypt(key, env) {
  const dec = await webcrypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: b64uToBytes(env.iv),
      additionalData: enc.encode(SPACE_ID),
    },
    key,
    b64uToBytes(env.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(dec));
}

// 从本地 dump 读密文（不碰网络）。dump 由 supabase db query 导出：
//   select string_agg(jsonb_build_object('id',id,'iv',op->>'iv','ct',op->>'ciphertext')::text, E'\n')
//     from public.bsync_op_log where space_id='<SPACE>';
// 输出是 CLI 画的表格，每行一个 {"id":…,"iv":…,"ct":…} JSON 对象。
const raw = readFileSync(DUMP, 'utf8');
const data = [];
for (const line of raw.split('\n')) {
  const s = line.indexOf('{');
  if (s < 0) continue;
  const e = line.lastIndexOf('}');
  if (e <= s) continue;
  try {
    data.push(JSON.parse(line.slice(s, e + 1)));
  } catch {
    /* 表格边框等噪声行，跳过 */
  }
}
if (!data.length) {
  console.error('no op rows parsed from', DUMP);
  process.exit(1);
}

const key = await loadKey();

let ok = 0;
let failed = 0;
let trashOps = 0;
let rootChildOps = 0;
const parentOf = new Map();
const lastWrite = new Map();
const badSamples = [];

for (const row of data ?? []) {
  let op;
  try {
    op = await decrypt(key, { iv: row.iv, ciphertext: row.ct });
  } catch (e) {
    failed++;
    if (badSamples.length < 3) badSamples.push({ id: row.id, err: String(e).slice(0, 90) });
    continue;
  }
  ok++;
  const child = op.c;
  const parent = op.p;
  if (parent === TRASH) trashOps++;
  if (parent === ROOT_UUID) rootChildOps++;
  if (child) {
    // CRDT：同一 child 被多次写 → 后者生效（LWW 按 timestamp）
    const prev = lastWrite.get(child);
    if (!prev || cmp(op.t, prev) >= 0) lastWrite.set(child, op.t);
    parentOf.set(child, parent);
  }
}

function cmp(a, b) {
  if (!a || !b) return 0;
  return a.counter - b.counter || String(a.replicaId).localeCompare(String(b.replicaId));
}

// 可见树：从 ROOT_UUID 做 BFS
const childrenOf = new Map();
for (const [child, op] of lastWrite) {
  const p = op.p;
  if (!childrenOf.has(p)) childrenOf.set(p, []);
  childrenOf.get(p).push(child);
}
const reachable = new Set([ROOT_UUID]);
const q = [ROOT_UUID];
while (q.length) {
  const cur = q.shift();
  for (const c of childrenOf.get(cur) ?? []) {
    if (reachable.has(c)) continue;
    reachable.add(c);
    q.push(c);
  }
}

let bookmarks = 0;
let folders = 0;
let orphanParents = 0;
for (const child of reachable) {
  if (child === ROOT_UUID) continue;
  const op = lastWrite.get(child);
  if (!op) continue;
  if (op.m?.url) bookmarks++;
  else folders++;
  if (op.p === TRASH) orphanParents++;
}
const unreachable = lastWrite.size - (reachable.size - 1);

console.log(
  JSON.stringify(
    {
      rows: data?.length ?? 0,
      decryptedOk: ok,
      decryptFailed: failed,
      badSamples,
      trashOps,
      rootChildOps,
      distinctNodes: lastWrite.size,
      reachableNodes: reachable.size - 1,
      unreachableNodes: unreachable,
      bookmarksInVisibleTree: bookmarks,
      foldersInVisibleTree: folders,
    },
    null,
    2,
  ),
);
