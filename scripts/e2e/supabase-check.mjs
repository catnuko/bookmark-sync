/**
 * e2e/supabase-check.mjs — 只读：查 bsync_op_log / 空间 / 设备，验证落库。
 *
 * 需要 Supabase Management API token，读取顺序：
 *   1. env SUPABASE_ACCESS_TOKEN
 *   2. ~/.supabase_access_token
 *
 * 用法：node e2e/supabase-check.mjs [--detail]
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PROJECT = process.env.SUPABASE_PROJECT ?? 'cwtqnsbpcetvqopdkcou';
const TOKEN =
  process.env.SUPABASE_ACCESS_TOKEN ??
  (existsSync(join(homedir(), '.supabase_access_token'))
    ? readFileSync(join(homedir(), '.supabase_access_token'), 'utf8').trim()
    : null);

if (!TOKEN) {
  console.error(
    '缺少 Supabase access token（设 SUPABASE_ACCESS_TOKEN 或写 ~/.supabase_access_token）',
  );
  process.exit(1);
}

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`SQL 失败 ${r.status}: ${await r.text()}`);
  return r.json();
}

const detail = process.argv.includes('--detail');

const spaces = await sql(
  'SELECT id, name, is_default, created_at FROM bsync_spaces ORDER BY created_at LIMIT 10;',
);
const devices = await sql('SELECT count(*) n FROM bsync_devices;');
const ops = await sql('SELECT count(*) n FROM bsync_op_log;');
console.log(
  '空间:',
  JSON.stringify(
    spaces.map((s) => ({ name: s.name, def: s.is_default, at: s.created_at.slice(0, 19) })),
  ),
);
console.log('设备数:', devices[0].n, ' op_log 条数:', ops[0].n);

if (detail) {
  const rows = await sql(
    "SELECT id, device_id::text d, seq, op->>'iv' IS NOT NULL AS is_encrypted, (op->>'ciphertext') IS NOT NULL AS has_ct FROM bsync_op_log ORDER BY id LIMIT 30;",
  );
  console.log('op 明细:', JSON.stringify(rows, null, 1));
}
