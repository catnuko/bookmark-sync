/**
 * tests/crypto-salt.test.ts — 云端口令盐的「问不到」语义（迁移 0019 的对齐层）。
 *
 * 回归背景（2026-09-29）：`fetchRemoteSalt()` 把「网络/RPC 失败」和「云端确实没有盐」
 * 都表示成 `null`，`isFirstDevice()` 于是把两者都当成「第一台设备」。后果：
 *   ① 网络抖动中的第二台设备被引导「设置新口令」→ 派生出一把解不开既有数据的密钥，
 *      而且全程没有任何一步会报错；
 *   ② 本机刚生成的盐被当成「首设」推上云 → 覆盖真正的云端盐，之后所有设备一起派生错。
 *
 * 这里把三态契约钉死：`ok:false`（问不到）既不能被当成「没有盐」，也不能触发推盐。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../src/lib/supabase.js', () => ({
  supabase: { auth: { getSession: h.getSession }, rpc: h.rpc },
}));

let store: Map<string, string>;
let pushed: string[];

function installChrome(): void {
  const local = {
    async get(key: string) {
      return store.has(key) ? { [key]: store.get(key) } : {};
    },
    async set(items: Record<string, string>) {
      for (const [k, v] of Object.entries(items)) store.set(k, v);
    },
    async remove(key: string) {
      store.delete(key);
    },
  };
  (globalThis as unknown as { chrome?: unknown }).chrome = { storage: { local } };
}

const SESSION = { data: { session: { user: { id: 'u1' } } } };

/**
 * 给取盐/推盐 RPC 装配行为。
 * @param salt  云端已有的盐；null = 云端**确认**没有盐
 * @param mode  'ok' 正常返回 / 'error' 返回 PostgrestError / 'throw' 直接抛（断网）
 */
function armSaltRpc(salt: string | null, mode: 'ok' | 'error' | 'throw' = 'ok'): void {
  h.rpc.mockImplementation(async (fn: string, args?: { p_salt?: string }) => {
    if (fn === 'bsync_get_e2ee_salt') {
      if (mode === 'throw') throw new Error('Failed to fetch');
      if (mode === 'error') return { data: null, error: { message: 'boom', code: 'PGRST000' } };
      return { data: salt, error: null };
    }
    if (fn === 'bsync_set_e2ee_salt') {
      pushed.push(args?.p_salt ?? '');
      return { error: null };
    }
    return { data: null, error: null };
  });
}

async function load() {
  vi.resetModules();
  return import('../src/crypto.js');
}

beforeEach(() => {
  store = new Map();
  pushed = [];
  h.getSession.mockReset();
  h.rpc.mockReset();
  h.getSession.mockResolvedValue(SESSION);
  installChrome();
});

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe('isFirstDevice 的三态', () => {
  it('云端没有盐 → true（真的是第一台设备）', async () => {
    armSaltRpc(null);
    const { isFirstDevice } = await load();
    expect(await isFirstDevice()).toBe(true);
  });

  it('云端有盐 → false（新设备，要输旧口令）', async () => {
    armSaltRpc('CLOUD_SALT');
    const { isFirstDevice } = await load();
    expect(await isFirstDevice()).toBe(false);
  });

  it('RPC 报错 → null（不能确定，而不是「没有盐」）', async () => {
    armSaltRpc(null, 'error');
    const { isFirstDevice } = await load();
    expect(await isFirstDevice()).toBeNull();
  });

  it('断网抛错 → null', async () => {
    armSaltRpc(null, 'throw');
    const { isFirstDevice } = await load();
    expect(await isFirstDevice()).toBeNull();
  });

  it('未登录 → true（退化为纯本地语义，保持离线可用）', async () => {
    armSaltRpc(null);
    h.getSession.mockResolvedValue({ data: { session: null } });
    const { isFirstDevice } = await load();
    expect(await isFirstDevice()).toBe(true);
  });
});

describe('setKeyFromPassphrase 的盐对齐', () => {
  it('问不到云端时绝不推盐（否则会把本机的盐覆盖到云端）', async () => {
    armSaltRpc(null, 'error');
    const { setKeyFromPassphrase, getPhraseSalt } = await load();
    expect(await setKeyFromPassphrase('a long enough passphrase')).toBe(true);
    // 本机会生成一个盐用于派生，但**不能**上传
    expect(await getPhraseSalt()).toBeTruthy();
    expect(pushed).toEqual([]);
  });

  it('断网抛错时同样不推盐', async () => {
    armSaltRpc(null, 'throw');
    const { setKeyFromPassphrase } = await load();
    expect(await setKeyFromPassphrase('a long enough passphrase')).toBe(true);
    expect(pushed).toEqual([]);
  });

  it('确认云端没有盐 → 把本机生成的盐推上去（首设备）', async () => {
    armSaltRpc(null);
    const { setKeyFromPassphrase, getPhraseSalt } = await load();
    expect(await setKeyFromPassphrase('a long enough passphrase')).toBe(true);
    expect(pushed).toEqual([await getPhraseSalt()]);
  });

  it('云端有盐 → 用云端的盐派生，且不推盐（云端权威）', async () => {
    armSaltRpc('CLOUD_SALT');
    const { setKeyFromPassphrase, getPhraseSalt } = await load();
    expect(await setKeyFromPassphrase('a long enough passphrase')).toBe(true);
    expect(await getPhraseSalt()).toBe('CLOUD_SALT');
    expect(pushed).toEqual([]);
  });
});

describe('口令门禁的模式判定（store.initPhraseGate）', () => {
  async function gateMode() {
    vi.resetModules();
    const { initPhraseGate, state } = await import('../src/store.js');
    await initPhraseGate();
    return { mode: state.phraseGateMode, visible: state.phraseGateVisible };
  }

  it('问不到云端 → verify（fail closed：宁可让用户重试，也不误导他设新口令）', async () => {
    armSaltRpc(null, 'error');
    const r = await gateMode();
    expect(r.mode).toBe('verify');
    expect(r.visible).toBe(true);
  });

  it('断网抛错 → verify', async () => {
    armSaltRpc(null, 'throw');
    expect((await gateMode()).mode).toBe('verify');
  });

  it('确认云端没有盐 → setup（真的是第一台设备）', async () => {
    armSaltRpc(null);
    expect((await gateMode()).mode).toBe('setup');
  });

  it('云端有盐 → verify（新设备，输旧口令）', async () => {
    armSaltRpc('CLOUD_SALT');
    expect((await gateMode()).mode).toBe('verify');
  });
});
