---
title: Quick Start: From Install to Your First Sync
description: Install from your browser store, log in, set a sync passphrase, run the first sync, and restore on a new device — plus the eight core capabilities of the sync engine.
category: guide
date: 2026-10-09
seoTitle: BookmarkSync Quick Start · Install to First Sync
seoDescription: A complete BookmarkSync walkthrough for new users: install from the store, log in by email, set your sync passphrase, run the first sync and restore on a new device — plus true-tree sync, tombstone deletes, end-to-end encryption and five more capabilities.
keywords: BookmarkSync tutorial,how to use bookmark sync,set up bookmark sync,cross-browser bookmark sync guide,sync passphrase,restore bookmarks on a new device
---

# Quick Start: From Install to Your First Sync

From install to your first sync takes about five minutes. This guide splits the path into four steps, then explains what the sync engine is actually doing.

## 1. Download and install

Search for BookmarkSync in your browser store and install with one click: Chrome Web Store, Edge Add-ons, or Firefox Add-ons. You can also grab an offline package from the download page and load it manually.

## 2. Log in

Open the extension options page and sign up or log in with your email. The website and the extension share the same account (the same Supabase Auth), so what you see on the site matches the extension.

## 3. Set your sync passphrase

Set a sync passphrase after your first login. Every bookmark is encrypted on your device before upload; the passphrase only derives the decryption key locally and is never sent to the server.

> Store the passphrase in a password manager. Lose it and the encrypted cloud data can never be decrypted — no one, including us, can recover it.

## 4. Start syncing

Tap Sync Now to upload your local bookmarks encrypted. On a new device, log in and enter the same passphrase to restore from the cloud; a default sync space is created automatically.

## Restoring on a new device

1. Confirm and remember your sync passphrase on the old device.
2. Install the extension on the new device and log in with the same account.
3. Enter the same passphrase when prompted.
4. Tap Sync Now — bookmarks restore from the cloud.

## What the engine does

The sync engine works on the **real bookmark tree**, not flattened path strings. These eight capabilities are the core of it.

### True-tree sync

Syncs the bookmark tree as-is. Rename, move, or reorder folders without losing children or hierarchy.

### Precise deletes, never resurrect

Deletes propagate across devices as tombstones; a bookmark removed on device A never reappears on device B from stale data.

### Automatic multi-device merge

Concurrent add, edit, or delete merges intelligently on both devices — both sides' changes are kept, nothing overwritten.

### End-to-end encryption (on by default)

Every bookmark op is encrypted (AES-256-GCM) on your device before upload; the server stores ciphertext only. Keys derive from your passphrase (PBKDF2, salt synced in the cloud); a new device decrypts with the same passphrase.

### Multiple sync spaces

Each space is an independent bookmark tree (for example work or personal), bindable to different browser profiles. Free 1 space, Plus 3, Pro 10.

### Device management

Syncing browsers register as devices automatically — view, rename, or unbind them, and remove unused old devices anytime.

### Automatic sync

Detects local bookmark changes and uploads or pulls deltas in the background automatically; can be disabled under Advanced for manual-only sync.

### Cross-browser bookmark menu

The Firefox Bookmark Menu location is mirrored as a same-named folder under Chrome's bookmark bar, synced across devices.

## When something goes wrong

Forgot passphrase, restoring on a new device, whether deletes can be recovered, sync not triggering — the most common questions and failures all live in Common Questions and Troubleshooting. To understand the mechanics first, read how to tell whether a bookmark sync extension is really end-to-end encrypted.
