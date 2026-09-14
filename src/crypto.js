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
  return keyManager.setKeyFromPassphrase(passphrase);
}

/** 当前口令盐（base64url；调试/展示用，非机密）。 */
export async function getPhraseSalt() {
  return keyManager.getSalt();
}
