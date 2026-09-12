// 端到端加密（E2EE）—— 字段级加密层
// ------------------------------------------------------------------
// 目标：让服务端（Supabase）读不到书签内容，实现"零信任"隐私。
// 策略：只加密每个书签节点的 title 与 url 两个"内容字段"。
//       保留 sync_id / parent_sync_id / type / order / updated_at 为明文，
//       从而不影响现有 0012 迁移里的按 sync_id 墓碑过滤、配额、历史回滚逻辑。
//       合并（mergeStates）/ 墓碑计算 / 身份对齐都在客户端明文域进行，
//       仅在最后调用 bsync_snapshot_push 之前加密，pull 之后解密。
//
// 格式：单条密文 = "v1.<ivBase64Url>.<ciphertextBase64Url>"
//   - v1 版本标记，用于识别哪些字段已是密文，避免把旧明文当密文解。
//   - iv 每个字段随机（12 字节），密文每次不同，但解密后明文一致。
//   - AES-GCM(256-bit)，密文自带认证标签，可防服务端篡改。
//
// 密钥管理：随机 32 字节，存在 chrome.storage.local（本设备）。
//   换设备需导出并在新设备导入同一密钥，否则无法解密既有数据。
// ------------------------------------------------------------------

import { api } from "./lib/ext.js";

const KEY_STORAGE_KEY = "e2eeKey"; // base64url(32 字节)
const E2EE_PREFIX = "v1.";
// 口令派生（可选方式）：固定盐 + PBKDF2-SHA256，任一设备输入同一口令即得同一密钥。
// 客户端已缓存口令时数据仍对称加密；口令误判由 decrypt_error 兜底提示。
const PBKDF2_SALT = "bookmark-sync-e2ee-v1";

// ---- base64url 编解码（WebCrypto 环境无 Buffer）----
function bytesToB64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  const b64 = globalThis.btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = globalThis.atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---- 密钥管理 ----
async function loadKeyBytes() {
  const res = await api.storage.local.get(KEY_STORAGE_KEY);
  const stored = res[KEY_STORAGE_KEY];
  if (!stored) return null;
  try {
    return b64urlToBytes(stored);
  } catch {
    return null;
  }
}

async function saveKeyBytes(bytes) {
  await api.storage.local.set({ [KEY_STORAGE_KEY]: bytesToB64url(bytes) });
}

// 确保本设备存在 E2EE 密钥；没有则生成。返回 32 字节 key。
export async function ensureKey() {
  const existing = await loadKeyBytes();
  if (existing && existing.length === 32) return existing;
  const generated = globalThis.crypto.getRandomValues(new Uint8Array(32));
  await saveKeyBytes(generated);
  return generated;
}

// 导出密钥（base64url 字符串，供用户在新设备粘贴）
export async function exportKey() {
  const bytes = await ensureKey();
  return bytesToB64url(bytes);
}

// 导入密钥（新设备粘贴）。失败返回 false。
export async function importKey(b64) {
  const trimmed = (b64 ?? "").trim();
  if (!trimmed) return false;
  try {
    const bytes = b64urlToBytes(trimmed);
    if (bytes.length !== 32) return false;
    await saveKeyBytes(bytes);
    return true;
  } catch {
    return false;
  }
}

export async function hasKey() {
  return !!(await loadKeyBytes());
}

// 可选方式：用口令派生密钥并设为当前密钥。
// 口令 → PBKDF2-SHA256（固定盐）→ 32 字节密钥。任一设备输入同一口令即得同一密钥，
// 无需复制长密钥串。失败（口令过短）返回 false。
export async function setKeyFromPassphrase(passphrase) {
  const text = String(passphrase ?? "");
  if (text.length < 8) return false;
  const material = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(text),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await globalThis.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new TextEncoder().encode(PBKDF2_SALT), iterations: 210000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const raw = await globalThis.crypto.subtle.exportKey("raw", key);
  keyCache.clear();
  await saveKeyBytes(new Uint8Array(raw));
  return true;
}

// ---- 加密模式开关（可选项）：'e2ee'（默认，加密） | 'plain'（明文，不加密）----
const MODE_KEY = "encryptMode";

export async function getEncryptMode() {
  const res = await api.storage.local.get(MODE_KEY);
  return res[MODE_KEY] === "plain" ? "plain" : "e2ee";
}

export async function setEncryptMode(mode) {
  await api.storage.local.set({ [MODE_KEY]: mode === "plain" ? "plain" : "e2ee" });
}

// ---- 加解密 ----
// CryptoKey 句柄按密钥内容缓存（导入新密钥后必须用新句柄，不能复用旧的）
const keyCache = new Map();

async function getCryptoKey(bytes) {
  const id = bytesToB64url(bytes);
  const hit = keyCache.get(id);
  if (hit) return hit;
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  keyCache.set(id, key);
  return key;
}

export function isEncrypted(s) {
  return typeof s === "string" && s.startsWith(E2EE_PREFIX);
}

export async function encryptStr(plain, keyBytes) {
  if (!plain) return plain; // 空串/null 不加密
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await getCryptoKey(keyBytes);
  const buf = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plain)
  );
  return `${E2EE_PREFIX}${bytesToB64url(iv)}.${bytesToB64url(new Uint8Array(buf))}`;
}

// 解密单条密文；不是本格式则原样返回；失败返回 null（密钥缺失/数据损坏）
export async function decryptStr(s, keyBytes) {
  if (!isEncrypted(s)) return s;
  try {
    const [_, ivB64, ctB64] = s.split(".");
    if (!ivB64 || !ctB64) return null;
    const key = await getCryptoKey(keyBytes);
    const buf = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64urlToBytes(ivB64) },
      key,
      b64urlToBytes(ctB64)
    );
    return new TextDecoder().decode(buf);
  } catch {
    return null;
  }
}

// 加密节点内容字段（title / url）。bookmark 有 url，folder 无 url（null 保持）。
export async function encryptNode(node, keyBytes) {
  const out = { ...node };
  if (out.title != null) out.title = await encryptStr(String(out.title), keyBytes);
  if (out.url != null) out.url = await encryptStr(String(out.url), keyBytes);
  return out;
}

// 解密节点内容字段。字段非本格式则原样返回（兼容历史明文数据）。
// 解密失败返回 false（调用方据此提示：密钥不匹配或数据损坏）。
export async function decryptNode(node, keyBytes) {
  const out = { ...node };
  if (isEncrypted(out.title)) {
    const dec = await decryptStr(out.title, keyBytes);
    if (dec == null) return { ok: false };
    out.title = dec;
  }
  if (isEncrypted(out.url)) {
    const dec = await decryptStr(out.url, keyBytes);
    if (dec == null) return { ok: false };
    out.url = dec;
  }
  return { ok: true, node: out };
}

export async function encryptNodes(nodes, keyBytes) {
  const out = [];
  for (const n of nodes ?? []) out.push(await encryptNode(n, keyBytes));
  return out;
}

export async function decryptNodes(nodes, keyBytes) {
  const out = [];
  for (const n of nodes ?? []) {
    const r = await decryptNode(n, keyBytes);
    if (!r.ok) return null; // 任一字段解密失败 → 整个批次判为失败
    out.push(r.node);
  }
  return out;
}