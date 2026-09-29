// 端到端加密（E2EE）—— 操作级密钥管理薄封装（Phase C-2）
// ------------------------------------------------------------------
// 本文件保留旧版同名导出（exportKey/importKey/hasKey/setKeyFromPassphrase），
// 供 App.vue 渐进迁移；真正的加解密已下沉到
// src/sync/opCrypto.ts（整 MoveOp 加密）。这里只负责「这台设备有没有密钥、
// 怎么导出/导入/用口令派生」。
//
// 密钥：随机 32 字节 AES-256-GCM，存 chrome.storage.local（本设备）。
//   换设备需导出并在新设备导入同一密钥，否则无法解密既有数据。
//   口令派生用随机 per-user 盐；盐非机密，登录态下存云端按用户同步
//   （bsync_get/set_e2ee_salt）——新设备只需登录 + 输入同一口令即可
//   用同一盐派生出同一密钥，无需手工传递 44 字符密钥。
// ------------------------------------------------------------------

import { api } from './lib/ext.js';
import { KeyManager } from './sync/index.js';
import { supabase } from './lib/supabase.js';

const keyManager = new KeyManager({
  async get(key) {
    return (await api.storage.local.get(key))[key] as string | undefined;
  },
  async set(key, value) {
    await api.storage.local.set({ [key]: value });
  },
  async remove(key) {
    await api.storage.local.remove(key);
  },
});

// ---- 口令盐的云端同步（迁移 0019）----
// 规则：云端权威。登录态下调用 setKeyFromPassphrase 前，先把本地盐与云端对齐：
//   云端有盐（此前设备上传过）→ 拉下来覆盖本地（本地无盐或不同）；
//   本地有盐且云端无 → 上传（本设备是第一个设口令的）。
// 未登录时退化为纯本地语义（无盐则生成本地盐），保证离线可用。
//
// ★ 「问不到云端」≠「云端没有盐」，所以取盐一律走三态（ok:false = 问不到），
//   绝不用 null 兼表「没有」。混为一谈会同时炸掉两件事：
//   ① 新设备被误判成第一台设备，门禁引导它设新口令，派生出一把解不开既有数据的
//      密钥 —— 而且全程没有任何一步会报错；
//   ② 本机刚生成的盐被当成「首设」推上云，覆盖掉真正的云端盐 —— 之后所有设备
//      对齐时都会拿到这个盐，一起派生错密钥。
type RemoteSalt = { ok: true; salt: string | null } | { ok: false };

async function fetchRemoteSalt(): Promise<RemoteSalt> {
  try {
    const { data, error } = await supabase.rpc('bsync_get_e2ee_salt');
    if (error) return { ok: false };
    return { ok: true, salt: typeof data === 'string' && data ? data : null };
  } catch {
    return { ok: false };
  }
}

async function pushRemoteSalt(saltB64: string): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('bsync_set_e2ee_salt', { p_salt: saltB64 });
    return !error;
  } catch {
    return false;
  }
}

async function ensurePhraseSalt(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (!data?.session) return; // 未登录：不动云端
  const remote = await fetchRemoteSalt();
  if (!remote.ok) return; // 问不到：什么都不动（尤其不能推盐，见上面的 ★）
  const local = await keyManager.getSalt();
  if (remote.salt && local !== remote.salt) {
    await keyManager.setSalt(remote.salt); // 云端权威
  } else if (!remote.salt && local) {
    await pushRemoteSalt(local); // 首设备：上传
  }
}

// 兼容旧 API：返回 base64url 字符串
export async function exportKey(): Promise<string> {
  return keyManager.exportKey();
}

export async function importKey(b64: string): Promise<boolean> {
  return keyManager.importKey(b64);
}

export async function hasKey(): Promise<boolean> {
  return keyManager.hasKey();
}

export async function setKeyFromPassphrase(passphrase: string): Promise<boolean> {
  await ensurePhraseSalt();
  const ok = await keyManager.setKeyFromPassphrase(passphrase);
  if (ok) {
    // keyManager.setKeyFromPassphrase 在本地无盐时会新生成一个盐存本地，
    // 但它不知道云端情况、不会上传。ensurePhraseSalt 在它之前跑、当时本地
    // 无盐也不会上传。这里补一刀：云端还没盐就把本设备刚生成的盐推上去——
    // 否则另一台设备首次设置口令时会再生成一个不同盐，派生出不同密钥，
    // 双方都解不开对方数据。
    const { data } = await supabase.auth.getSession();
    if (data?.session) {
      const remote = await fetchRemoteSalt();
      const local = await keyManager.getSalt();
      // 只有**确认**云端没有盐才推。问不到时推 = 把本机刚生成的盐覆盖到云端，
      // 已设过口令的设备下次对齐都会拿到它，一起派生错密钥（见上面的 ★）。
      if (remote.ok && !remote.salt && local) await pushRemoteSalt(local);
    }
  }
  return ok;
}

/** 当前口令盐（base64url；调试/展示用，非机密）。 */
export async function getPhraseSalt(): Promise<string | null> {
  return keyManager.getSalt();
}

/**
 * 云端是否已有口令盐 —— 没有就是「第一台设备」（要设新口令），有就是新设备。
 *
 * 三态：`true` / `false` / **`null` = 问不到云端**。调用方必须把 `null` 当成
 * 「不能确定」并按最保守的一侧处理（门禁取 verify，见 store.ts 的 initPhraseGate）：
 * 把 `null` 当 `true`，网络抖动时的第二台设备会被引导「设置新口令」，派生出一把
 * 永远解不开既有数据的密钥，而且全程没有任何一步会报错（2026-09-29 修）。
 */
export async function isFirstDevice(): Promise<boolean | null> {
  const { data } = await supabase.auth.getSession();
  if (!data?.session) return true;
  const remote = await fetchRemoteSalt();
  return remote.ok ? !remote.salt : null;
}

/** 清除本机已存的密钥和盐（口令验证失败时回滚，避免误入主界面）。 */
export async function clearLocalKey(): Promise<void> {
  await keyManager.clear();
}

/** 取回本机已存的 CryptoKey（用于验证解密），无则 null。 */
export async function ensureLocalKey(): Promise<CryptoKey | null> {
  return keyManager.ensureKey();
}
