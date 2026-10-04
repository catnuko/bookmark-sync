/**
 * 只读诊断：按设备 / 时间统计 trash op，定位「谁在什么时候删的」。
 * ⚠️ 只读。
 */
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { createServer } from 'vite';

void (async () => {
  const KEY = process.env.E2EE_KEY;
  const SPACE = process.env.SPACE_ID;
  const DUMP = process.argv[2];
  if (!KEY || !SPACE || !DUMP) {
    console.error('need E2EE_KEY / SPACE_ID / <dumpfile>');
    process.exit(1);
  }
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'error' });
  await server.close();

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

  const rows = [];
  for (const line of readFileSync(DUMP, 'utf8').split('\n')) {
    const s = line.indexOf('{');
    if (s < 0) continue;
    const e = line.lastIndexOf('}');
    if (e <= s) continue;
    try {
      rows.push(JSON.parse(line.slice(s, e + 1)));
    } catch {
      /* 噪声 */
    }
  }
  rows.sort((a, b) => a.id - b.id);

  const perDevice = {};
  const perHour = {};
  let trashTotal = 0;
  let createTotal = 0;
  let moveTotal = 0;
  const sample = [];
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
      continue;
    }
    const dev = op.t?.replicaId ?? 'unknown';
    perDevice[dev] ??= { total: 0, trash: 0, create: 0, move: 0, firstId: r.id, lastId: r.id };
    const d = perDevice[dev];
    d.total++;
    d.lastId = r.id;
    if (op.p === TRASH) {
      d.trash++;
      trashTotal++;
    } else if (op.m?.url) {
      d.create++;
      createTotal++;
    } else {
      d.move++;
      moveTotal++;
    }
    if (op.p === TRASH && sample.length < 5) {
      sample.push({ id: r.id, dev: dev.slice(0, 8), child: op.c?.slice(0, 8), title: op.m?.title });
    }
  }

  console.log(JSON.stringify({ createTotal, moveTotal, trashTotal, perDevice, sample }, null, 2));
})();
