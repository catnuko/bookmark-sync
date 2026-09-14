/**
 * Invite-link formatting / parsing (Phase 3 key distribution).
 *
 * Format:
 *
 *   <baseUrl>#k=<base64url raw key bytes>
 *
 * The key lives in the URL FRAGMENT (everything after `#`). Browsers never
 * send the fragment to the server — it is purely client-side state. That is
 * the whole point: a user can paste the invite link into a chat, click it,
 * and the relay / web server that hosts `baseUrl` never sees the key.
 *
 * Example:
 *   https://myext.example.com/join#k=bp2jP... (32 raw bytes, 43 base64url chars)
 *
 * Security boundary:
 *   - The link itself is bearer secret. Anyone who has it can read the room.
 *     It MUST be shared over an authenticated, private channel (e2ee chat,
 *     QR scan in person, etc.) — exactly the same threat model as a password.
 *   - Because the fragment is not logged by servers, this avoids accidentally
 *     leaking the key through proxy logs / referer headers.
 *   - TODO(design): key rotation / revoking an invite is out of scope for
 *     Phase 3. Rotating the key requires re-encrypting the whole DAG (or
 *     introducing a re-encryption layer), which we punt on.
 */

import { exportKey, importKey } from './key.js';

/**
 * Build an invite link that embeds the raw key in the URL fragment.
 *
 * @param baseUrl the join page, e.g. https://myext.example.com/join
 * @param key     the AES-256-GCM key to share.
 */
export async function formatInviteLink(baseUrl: string, key: CryptoKey): Promise<string> {
  const k = await exportKey(key);
  const qs = new URLSearchParams({ k }).toString();
  // If baseUrl already has a fragment, append with '&'; else use '#'.
  const sep = baseUrl.includes('#') ? '&' : '#';
  return `${baseUrl}${sep}${qs}`;
}

/**
 * Parse an invite link and return the imported CryptoKey.
 *
 * Accepts either a full URL (with or without protocol) or just a fragment
 * like `#k=...`. Throws if no `k=` parameter is present.
 */
export async function parseInviteLink(url: string): Promise<CryptoKey> {
  // Take everything after the first '#'. If there is no '#', treat the whole
  // string as a query string (e.g. the caller passed "k=...&x=1").
  const hashIdx = url.indexOf('#');
  const fragment = hashIdx >= 0 ? url.slice(hashIdx + 1) : url;
  const params = new URLSearchParams(fragment);
  const k = params.get('k');
  if (!k) {
    throw new Error('Invite link has no "k=" parameter (expected <base>#k=<key>)');
  }
  return importKey(k);
}
