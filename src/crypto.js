// 端到端加密（E2EE）—— 操作级密钥管理薄封装（Phase C-2）
// ------------------------------------------------------------------
// 本文件保留旧版同名导出（exportKey/importKey/hasKey/setKeyFromPassphrase/
// getEncryptMode/setEncryptMode），供 App.vue 渐进迁移；真正的加解密已下沉到
// src/sync/opCrypto.ts（整 MoveOp 加密）。这里只负责「这台设备有没有密钥、
// 怎么导出/导入/用口令派生」。
//
// 密钥：随机 32 字节 AES-256-GCM，存 chrome.storage.local（本设备）。
//   换设备需导出并在新设备导入同一密钥，否则无法解密既有数据。
//   口令派生用随机 per-user 盐（不再用旧固定盐）。
// ------------------------------------------------------------------

import { api } from "./lib/ext.js";
import { KeyManager } from "./sync/index.js";

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
  return keyManager.setKeyFromPassphrase(passphrase);
}

// ---- 加密模式开关（UI 兼容层）----
// v2 起 E2EE 为操作级、随密钥自动启用；此开关仅用于 UI 展示，不再控制字段级加解密。
const MODE_KEY = "encryptMode";
export async function getEncryptMode() {
  const res = await api.storage.local.get(MODE_KEY);
  // 有密钥即视为 e2ee 已开启。
  return (res[MODE_KEY] === "e2ee" || (await keyManager.hasKey())) ? "e2ee" : "plain";
}
export async function setEncryptMode(mode) {
  await api.storage.local.set({ [MODE_KEY]: mode === "e2ee" ? "e2ee" : "plain" });
}
