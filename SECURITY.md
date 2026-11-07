# Security Policy

## Reporting a vulnerability

Please **do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

Instead, report them privately through one of these channels:

1. **GitHub Security Advisory**: use the "Report a vulnerability" button on the repository's Security tab — this is the preferred channel.
2. **Email**: [support@bookmark-sync.top](mailto:support@bookmark-sync.top) (please include "security" in the subject).

Please include as much of the following as you can:

- The affected component (extension / Supabase migrations / edge functions / website) and version or commit.
- Step-by-step instructions or a proof of concept to reproduce the issue.
- The impact you believe it has, and any possible mitigations you've identified.

We will acknowledge reports within a few days and keep you informed about the fix and the coordinated disclosure timeline. Please give us a reasonable window to release a fix before any public disclosure.

## What this project is, security-wise

**bookmark-sync is end-to-end encrypted by default.** Understanding this model helps both when reporting and when judging severity:

- Every bookmark operation is encrypted on the device (AES-256-GCM) before upload. The server stores ciphertext and metadata only — it cannot read bookmark titles, URLs, or folder structures.
- Encryption keys are derived from the user's passphrase (PBKDF2; the salt is stored per-user in the cloud). The passphrase itself is never sent to the server.
- Transport security is provided by HTTPS to the Supabase project.
- Row Level Security in Postgres isolates each user's rows; error reports are written through RPCs that verify `auth.uid()` server-side.

Issues that would weaken any of the above (for example: plaintext leaking to the server, key derivation flaws, RLS bypasses, auth bypasses in edge functions) are exactly what we want reported.

## Scope

In scope: the browser extension source (`src/`, `public/`), the Supabase schema and RPCs (`supabase/migrations/`), the edge functions (`supabase/functions/`), the build/publish scripts (`scripts/`), and the website (`website/`).

Out of scope: vulnerabilities in third-party services themselves (Supabase, Creem, browser vendors) — please report those to the respective vendor — and social engineering.
