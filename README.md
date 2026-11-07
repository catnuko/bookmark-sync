# bookmark-sync

**Cross-browser bookmark cloud sync extension (Manifest V3).** Supabase (Postgres + Auth) as the backend — the extension talks to Supabase directly, no server of your own to run. One codebase, three browsers: **Chrome / Edge / Firefox**.

English | [简体中文](README.zh-CN.md)

## Features

- **End-to-end encryption by default.** Every bookmark operation is encrypted on your device (AES-256-GCM) before it is uploaded — the server only ever sees ciphertext. Keys are derived from a passphrase (PBKDF2, salt stored per-user in the cloud) or exported/imported manually; sign in on a new device, enter the same passphrase, and everything decrypts.
- **Sync engine v2 — Move-CRDT operation log.** Bookmark create/delete/move operations become MoveOps (Kleppmann tree CRDT), encrypted and appended to `bsync_op_log`. Devices converge by Lamport timestamp: no lost bookmarks, no cycles, no merge conflicts you have to resolve.
- **Auth you don't have to manage.** Email + password sign-in reuses Supabase Auth; Row Level Security isolates every user's data.
- **Store-ready release pipeline.** release-please + GitHub Actions produce signed store zips for Chromium, Firefox and an AMO source package.

## Browser support

| Browser | Status | Install |
| --- | --- | --- |
| Chrome / Edge | Supported | [Chrome Web Store](https://chromewebstore.google.com/detail/emmjhpmhfepapemiflddnbmikicklfml) (works in Edge; a dedicated [Edge Add-ons listing](https://microsoftedge.microsoft.com/addons/detail/bookmark-sync/ilhfggggmdgfnliiimnkhdbaijjombah) is also available) |
| Firefox | Supported | [Firefox Add-ons (AMO)](https://addons.mozilla.org/firefox/addon/bookmark-sync-app) |
| Safari (macOS / iOS) | **Not supported** | Safari exposes no `bookmarks` API, so extension-side bookmark sync is not feasible there today |

## How sync works

The sync authority lives in the MV3 Service Worker: `chrome.bookmarks` events → local op queue → debounced push. The popup triggers syncs via `chrome.runtime.sendMessage` (see `src/background.ts` / `src/sync/`). The sync engine, CRDT and crypto layers are all in `src/` — that directory is the source of truth.

## Self-hosting

You can run everything against your own Supabase project — database migrations, the optional billing edge functions, and building the extension with your own endpoints are documented in [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md). Self-hosted instances do **not** use the hosted service's billing (Creem) subscription; quotas are yours to configure via the `quota_bytes` column.

## Pricing (hosted service)

The hosted service (default Supabase project in this repo) has a free tier of **1,000 items / 5 MiB** per account, with paid plans (Plus / Pro / Lifetime) for higher quotas. If you self-host, you decide your own quotas. Details may change; the extension always shows your current plan and quota.

## Development

```bash
pnpm install
pnpm dev            # local preview of the options/popup UI
pnpm build          # Chromium build -> extension/ (includes Safari shell post-build step)
pnpm build:firefox  # Firefox build -> extension-firefox/
pnpm check          # typecheck + lint + format check + unit tests
pnpm test           # vitest unit tests
```

- `src/` — extension source (options page, popup, service worker, sync engine); **the source of truth**
- `supabase/` — database migrations (`bsync_*` tables + RPCs), checked in directly
- `scripts/` — build hooks, packaging and local verification scripts (incl. `scripts/e2e/` triple-browser E2E)
- `website/` — the marketing site (Vue 3 + Vite, deployed on Vercel, separate dependency tree)
- `docs/` — design docs, self-hosting and privacy documentation

Load the build in a browser:

- Chrome: `chrome://extensions` → Developer mode → Load unpacked → `extension/`
- Edge: `edge://extensions` → Load unpacked → `extension/`
- Firefox: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `extension-firefox/manifest.json` (store distribution requires AMO signing)

Releases are automated: Conventional Commits pushed to `main` go through release-please; merging the release PR bumps the version, tags it and attaches three zips (chromium / firefox / source) to a GitHub Release. A quality gate (typecheck + lint + format + tests) runs before release.

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md). In short: commits must be signed off (`git commit -s`, the [DCO](https://developercertificate.org/)) and follow Conventional Commits.

## Privacy

What the server can and cannot see, and how error reporting works, is documented in [docs/PRIVACY.md](docs/PRIVACY.md) and the website privacy policy (https://www.bookmark-sync.top/privacy).

## Security

Found a vulnerability? Please **do not open a public issue** — see [SECURITY.md](SECURITY.md) for private reporting channels.

## License

This project is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE) (AGPL-3.0-or-later), covering the extension, the Supabase backend (migrations + edge functions), the website and all scripts in this repository.
