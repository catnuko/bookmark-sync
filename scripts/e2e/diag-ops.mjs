/**
 * e2e/diag-ops.mjs — 线上 op_log 诊断工具（只读）。
 *
 * 查测试账号空间的 op 数量 / 设备列表 / 最近 op；可选解密（E2EE）并按
 * uuid 过滤，用于排查跨端同步问题（如「某节点为何在另一端不可达」）。
 *
 * 用法：
 *   node e2e/diag-ops.mjs                    # 只查数量 + 最近 op + 设备
 *   node e2e/diag-ops.mjs --key <b64>        # 解密全部 op（密钥为 crdt.e2eeKey）
 *   node e2e/diag-ops.mjs --from-sw 9345     # 从运行中 Chromium 的扩展 SW 读密钥
 *   node e2e/diag-ops.mjs --filter 0004      # 只显示 child/parent 含该前缀的 op
 *   node e2e/diag-ops.mjs --limit 50         # 最多取 N 条（默认 100）
 *
 * 密钥读取顺序：--key > --from-sw <port> > env E2EE_KEY。密钥绝不写入仓库。
 */
import crypto from 'node:crypto';
import { sql } from './lib/supabase.mjs';
import { connect, waitForExtensionSw } from './lib/cdp.mjs';

const args = process.argv.slice(2);
const keyArg = args.find((a, i) => a === '--key' && args[i + 1]) ? args[args.indexOf('--key') + 1] : null;
const swPort = args.find((a, i) => a === '--from-sw' && args[i + 1]) ? args[args.indexOf('--from-sw') + 1] : null;
const filter = args.find((a, i) => a === '--filter' && args[i + 1]) ? args[args.indexOf('--filter') + 1] : null;
const limit = Number(args.find((a, i) => a === '--limit' && args[i + 1]) ? args[args.indexOf('--limit') + 1] : 100);

const b64uToBuf = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

async function readKeyFromSw(port) {
  const { sw } = await waitForExtensionSw(port);
  const c = await connect(sw.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const r = await c.send('Runtime.evaluate', {
    expression: `(async () => JSON.stringify(await chrome.storage.local.get(['crdt.e2eeKey'])))()`,
    awaitPromise: true, returnByValue: true,
  });
  const st = JSON.parse(r.result?.result?.value ?? '{}');
  return st['crdt.e2eeKey'] ?? null;
}

// ── 只读统计 ────────────────────────────────────────────────
const counts = await sql('SELECT count(*) n FROM bsync_op_log;');
console.log('[ops] 线上 op 总数:', counts[0].n);

const devs = await sql('SELECT device_id, count(*) n FROM bsync_op_log GROUP BY device_id ORDER BY max(id) DESC LIMIT 8;');
console.log('[ops] 设备分布:', devs.map((d) => `${d.device_id.slice(0, 8)}×${d.n}`).join(' '));

const rows = await sql(`SELECT space_id, device_id, seq, op FROM bsync_op_log ORDER BY id DESC LIMIT ${Math.min(limit, 500)};`);

// ── 解密（可选）─────────────────────────────────────────────
let key = keyArg ?? process.env.E2EE_KEY ?? null;
if (!key && swPort) {
  key = await readKeyFromSw(swPort);
  console.log('[ops] 从 SW(port ' + swPort + ') 读密钥:', !!key);
}
if (!key) {
  console.log('[ops] 未提供密钥（--key / --from-sw / E2EE_KEY），仅显示密文信封信息。');
  console.log('[ops] 最近 op:', rows.slice(0, 5).map((r) => `${r.device_id.slice(0, 8)}:${r.seq}`).join(' '));
  process.exit(0);
}

let ok = 0, fail = 0;
const out = [];
for (const row of rows) {
  try {
    const iv = b64uToBuf(row.op.iv);
    const ct = b64uToBuf(row.op.ciphertext);
    const d = crypto.createDecipheriv('aes-256-gcm', b64uToBuf(key), iv);
    d.setAAD(Buffer.from(row.space_id, 'utf8'));
    d.setAuthTag(ct.subarray(ct.length - 16));
    const op = JSON.parse(Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString('utf8'));
    ok++;
    if (filter && !(op.c?.includes(filter) || op.p?.includes(filter))) continue;
    out.push({ device: row.device_id.slice(0, 8), seq: row.seq, parent: op.p, child: op.c, meta: op.m });
  } catch { fail++; }
}
console.log(`[ops] 解密成功 ${ok} / 失败 ${fail}（失败多为旧密钥加密的跨轮 op，解密被跳过属正常）`);
if (filter) console.log(`[ops] 过滤 "${filter}" 命中 ${out.length} 条：`);
console.log(JSON.stringify(out.slice(0, 30), null, 1));
