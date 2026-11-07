# Privacy

This document explains what the bookmark-sync backend can and cannot see, and how diagnostic reporting works. For the end-user privacy policy of the hosted service, see https://www.bookmark-sync.top/privacy.

bookmark-sync is **end-to-end encrypted (E2EE) by default**. The server is a relay and a scheduler, not a reader.

## What the server CAN see

- **Your account email** — from Supabase Auth (email + password sign-in).
- **Ciphertext of your bookmark operations** — each operation (add / move / delete) is encrypted on your device with AES-256-GCM before upload. Stored in the `bsync_op_log` table as opaque encrypted blobs.
- **Sync metadata** — number and size of operations, device count and labels, timestamps, app version, and how far each device has progressed through the log. This is what makes quota accounting and device management possible.
- **Your plan and quota** — the `plan` and `quota_bytes` on your profile row.
- **Diagnostic error reports** (see [Error reporting](#error-reporting) below).
- **Billing data, only if you pay** — the hosted service uses Creem for payments; Creem receives your email and payment details for the transaction. Your bookmark data is never involved.

## What the server CANNOT see

- **Bookmark titles, URLs, folder names and structure** — always encrypted on the device before upload.
- **Your passphrase** — keys are derived on-device from your passphrase (PBKDF2, per-user salt). The passphrase itself is never transmitted or stored; the salt alone is not enough to derive the key.
- **Decrypted content of anything** — snapshots and log compaction happen over ciphertext as well.

Because of this, "can the server read my bookmarks?" is no by construction — and it is equally true on a [self-hosted](SELF-HOSTING.md) instance, since the encryption happens in the extension, not on the server.

## Error reporting

The extension includes a minimal, always-on diagnostic channel (`src/lib/telemetry.ts`) so that sync failures can actually be debugged after release:

- **What is sent**: error phase (which sync step failed), error reason/name, a short error message and stack, coarse context tags (enum scalars only), app version and platform.
- **What is never sent**: bookmark titles, URLs, folder names, your passphrase, or any E2EE plaintext. The reporting code enforces a whitelist and drops non-scalar or oversized values.
- **When it is sent**: only when you are signed in (the server-side RPC rejects unauthenticated writes), and at most once per 30 seconds per error type; the server additionally rate-limits and deduplicates.
- **Default state**: on. There is currently no user-facing switch; error reports go to the backend database of the instance you use (the hosted service's, or your own if self-hosted) and are used only to fix bugs.
- Feedback you actively submit through the in-extension form is stored alongside, with the last error phase attached as context if you choose to include it.

## Data retention and deletion

- Delete a bookmark → a delete op is recorded and the content stays encrypted as usual; server-side snapshot garbage collection removes old ciphertext.
- Delete your account (via the hosted service or your own Supabase project) → Supabase Auth deletion plus the per-user rows (protected by RLS / foreign keys) removes your ciphertext, metadata and profile.

## Third parties

- **Supabase** — hosts the backend (database, auth) of the instance you connect to.
- **Creem** — payment processor for the hosted service's paid tiers (only involved when you purchase).
- **Browser stores** (Chrome Web Store / Edge Add-ons / AMO) — distribute the extension; their own privacy terms apply to the install.
