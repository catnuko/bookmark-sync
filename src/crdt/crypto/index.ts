/**
 * Public exports for the Phase 3 E2EE layer.
 *
 * Usage:
 *   import {
 *     generateKey, encryptOp, decryptPayload,
 *     formatInviteLink, parseInviteLink, DecryptionError,
 *   } from './crypto/index.js';
 *
 *   const key = await generateKey();
 *   const blob = await encryptOp(op, key, parents);
 *   const op2  = await decryptPayload(blob, key, parents);
 */

export { DecryptionError } from './types.js';
export type { EncryptedPayload } from './types.js';

export { encryptOp, decryptPayload } from './aesGcm.js';

export {
  generateKey,
  exportKey,
  importKey,
  deriveFromPassphrase,
  generateSalt,
  bytesToBase64url,
  base64urlToBytes,
} from './key.js';

export { formatInviteLink, parseInviteLink } from './invite.js';
