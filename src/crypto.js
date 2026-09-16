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

import { api } from "./lib/ext.js";
import { KeyManager } from "./sync/index.js";
import { supabase } from "./lib/supabase.js";

const keyManager = new KeyManager({
  async get(key) {
    return (await api.storage.local.get(key))[key];
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
async function fetchRemoteSalt() {
  try {
    const { data, error } = await supabase.rpc("bsync_get_e2ee_salt");
    if (error) return null;
    return data ?? null;
  } catch {
    return null;
  }
}

async function pushRemoteSalt(saltB64) {
  try {
    const { error } = await supabase.rpc("bsync_set_e2ee_salt", { p_salt: saltB64 });
    return !error;
  } catch {
    return false;
  }
}

async function ensurePhraseSalt() {
  const { data } = await supabase.auth.getSession();
  if (!data?.session) return; // 未登录：不动云端
  const remote = await fetchRemoteSalt();
  const local = await keyManager.getSalt();
  if (remote && local !== remote) {
    await keyManager.setSalt(remote); // 云端权威
  } else if (!remote && local) {
    await pushRemoteSalt(local); // 首设备：上传
  }
}

// 兼容旧 API：返回 base64url 字符串
export async function exportKey() {
  return keyManager.exportKey();
}

export async function importKey(b64) {
  return keyManager.importKey(b64);
}

export async function hasKey() {
  return keyManager.hasKey();
}

export async function setKeyFromPassphrase(passphrase) {
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
      if (!remote && local) await pushRemoteSalt(local);
    }
  }
  return ok;
}

/** 当前口令盐（base64url；调试/展示用，非机密）。 */
export async function getPhraseSalt() {
  return keyManager.getSalt();
}

/** 云端是否已有口令盐——没有就是「第一台设备」（要设新口令），有就是新设备。 */
export async function isFirstDevice() {
  const { data } = await supabase.auth.getSession();
  if (!data?.session) return true;
  const remote = await fetchRemoteSalt();
  return !remote;
}

/** 清除本机已存的密钥和盐（口令验证失败时回滚，避免误入主界面）。 */
export async function clearLocalKey() {
  await keyManager.clear();
}

/** 取回本机已存的 CryptoKey（用于验证解密），无则 null。 */
export async function ensureLocalKey() {
  return keyManager.ensureKey();
}
