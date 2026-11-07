# bookmark-sync

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue)](LICENSE)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/users/emmjhpmhfepapemiflddnbmikicklfml?logo=googlechrome&logoColor=white&label=Chrome)](https://chromewebstore.google.com/detail/emmjhpmhfepapemiflddnbmikicklfml)
[![Edge Add-ons](https://img.shields.io/badge/Edge%20Add--ons-Install-0078D7?logo=microsoftedge&logoColor=white)](https://microsoftedge.microsoft.com/addons/detail/bookmark-sync/ilhfggggmdgfnliiimnkhdbaijjombah)
[![Firefox Add-ons](https://img.shields.io/amo/users/bookmark-sync-app?logo=firefoxbrowser&logoColor=white&label=Firefox)](https://addons.mozilla.org/firefox/addon/bookmark-sync-app)

**Your bookmarks, the same everywhere — private by design.** A cross-browser bookmark sync extension (Manifest V3) with end-to-end encryption and conflict-free CRDT sync. Works on **Chrome, Edge and Firefox** with the hosted service, or run the whole backend yourself.

English | [简体中文](README.zh-CN.md)

## Why bookmark-sync

Browser bookmark sync usually locks you into one ecosystem: Chrome only syncs to Google accounts, Edge to Microsoft, and none of them talk to each other — or they send your full browsing history to someone else's cloud. bookmark-sync keeps every device on every browser looking the same, encrypts everything on your device before it leaves, and is fully open source so you can verify all of it (or host it yourself).

## Features

- **Cross-browser, cross-device.** One account syncs Chrome, Edge and Firefox on all your computers — browsers that don't normally sync with each other.
- **End-to-end encryption by default.** Every bookmark operation is encrypted on your device (AES-256-GCM) before it is uploaded — the server only ever sees ciphertext. Keys are derived from your passphrase, so nobody (including us) can read your bookmarks.
- **Conflict-free sync (CRDT).** Change the same bookmark on two devices at once? Both changes survive. Internally, every create/move/delete becomes a small operation in a distributed log (a Move-CRDT, the same family of technique used by collaborative editors), and all devices independently arrive at the exact same result — no lost bookmarks, no merge dialogs, no "which copy wins?".
- **Private by design.** The server stores encrypted blobs and the minimum metadata needed to run the service — never your bookmark contents, URLs or folder names. See [docs/PRIVACY.md](docs/PRIVACY.md) and the [privacy policy](https://www.bookmark-sync.top/privacy) for exactly what is and isn't visible.

## Install

The easiest way is the store listing for your browser — updates are handled automatically:

| Browser | Install                                                                                                          |
| ------- | ---------------------------------------------------------------------------------------------------------------- |
| Chrome  | [Chrome Web Store](https://chromewebstore.google.com/detail/emmjhpmhfepapemiflddnbmikicklfml)                    |
| Edge    | [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/bookmark-sync/ilhfggggmdgfnliiimnkhdbaijjombah) |
| Firefox | [Firefox Add-ons (AMO)](https://addons.mozilla.org/firefox/addon/bookmark-sync-app)                              |

Safari is not supported today — it exposes no `bookmarks` API, so extension-side bookmark sync is not feasible there.

## Self-hosting

Prefer to run everything yourself? The full backend — database migrations, auth, storage — runs on your own Supabase project, and the extension can be built to point at your instance. See [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md). Self-hosted instances do **not** use the hosted service's billing; quotas are yours to configure.

## Pricing (hosted service)

The hosted service has a free tier of **1,000 items / 5 MiB** per account, with paid plans (Plus / Pro / Lifetime) for higher quotas. If you self-host, you decide your own quotas. Details may change; the extension always shows your current plan and quota.

## Feedback & contributing

- Found a bug or have an idea? [Open an issue](https://github.com/catnuko/bookmark-sync/issues).
- Want to contribute code? Read [CONTRIBUTING.md](CONTRIBUTING.md) — commits must be signed off (`git commit -s`, the [DCO](https://developercertificate.org/)) and follow Conventional Commits.
- Found a security vulnerability? Please **do not open a public issue** — see [SECURITY.md](SECURITY.md) for private reporting channels.

## Development

```bash
pnpm install
pnpm dev            # local preview of the options/popup UI
pnpm build          # Chromium build -> extension/
pnpm build:firefox  # Firefox build -> extension-firefox/
pnpm check          # typecheck + lint + format check + unit tests
```

- `src/` — extension source (options page, popup, service worker, sync engine)
- `supabase/` — database migrations (`bsync_*` tables + RPCs)
- `website/` — the marketing site (Next.js, deployed on Vercel, separate dependency tree)
- `scripts/` — build hooks, packaging and verification scripts

Load a local build in your browser: `chrome://extensions` → Developer mode → Load unpacked → `extension/` (Firefox: `about:debugging` → Load Temporary Add-on → `extension-firefox/manifest.json`).

## License

This project is permanently free and open source under the [GNU Affero General Public License v3.0 or later](LICENSE) (AGPL-3.0-or-later), covering the extension, the Supabase backend (migrations + edge functions), the website and all scripts in this repository.

## Star History

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=catnuko/bookmark-sync&type=Date&theme=dark" />
  <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=catnuko/bookmark-sync&type=Date" />
  <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=catnuko/bookmark-sync&type=Date" />
</picture>
