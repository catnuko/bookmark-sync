/**
 * e2e/lib/supabase.mjs — Management API 只读查询 helper（脚本共用）。
 *
 * token 读取顺序：env SUPABASE_ACCESS_TOKEN → ~/.supabase_access_token
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
  throw new Error(
    '缺少 Supabase access token（设 SUPABASE_ACCESS_TOKEN 或写 ~/.supabase_access_token）',
  );
}

export async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`SQL ${r.status}: ${await r.text()}`);
  return r.json();
}

export const opCount = async () => (await sql('SELECT count(*) n FROM bsync_op_log;'))[0].n;

export const opRows = async () =>
  sql(
    "SELECT id, device_id::text d, seq, op->>'iv' IS NOT NULL AS is_encrypted, (op->>'ciphertext') IS NOT NULL AS has_ct FROM bsync_op_log ORDER BY id DESC LIMIT 20;",
  );

export const devices = async () => (await sql('SELECT count(*) n FROM bsync_devices;'))[0].n;

export const spaces = async () =>
  sql('SELECT id, name, is_default FROM bsync_spaces ORDER BY created_at LIMIT 20;');
