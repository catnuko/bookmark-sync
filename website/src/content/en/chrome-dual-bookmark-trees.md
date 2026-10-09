---
title: Chrome's Two Bookmark Trees: What "One Bookmark Tree" Really Means
description: Since 2025, Chrome has split bookmarks into an account tree and a local tree, so signed-in users see two sets of top-level folders. Does cross-device sync still mean "one bookmark tree"? This article explains how the sync engine normalizes multiple native roots into a single logical tree.
category: explain
date: 2026-10-08
seoTitle: Chrome's Dual Bookmark Trees Explained · BookmarkSync
seoDescription: After Chrome's 2025 dual bookmark trees (syncing account tree / non-syncing local tree), is "keeping one bookmark tree across devices" still accurate? How rootResolver maps roots by folderType + syncing, the 8 fixed-root UUIDs, a single-root Move-CRDT logical tree, and Lamport convergence.
keywords: Chrome dual bookmark trees,syncing subtree,non-syncing subtree,Chrome bookmarks two roots,bookmark sync dual tree,one bookmark tree
faq: true
---

# Chrome's Two Bookmark Trees: What "One Bookmark Tree" Really Means

Since June 2025, Chrome has split bookmarks into two parallel trees: a **syncing (account)** tree and a **non-syncing (local)** tree. After you sign in, your bookmarks bar can show two sets of folders, and the old intuition of "sync means one tree, identical everywhere" is no longer obvious. But inside the sync engine there is still a single CRDT logical tree rooted at ROOT_UUID — Chrome's two trees and Firefox's multiple roots are all normalized into fixed roots of that one tree. Here's how.

## Background: Chrome went from one tree to two

In June 2025, Chrome split the bookmark tree into two parallel subtrees:

- **Syncing subtree (account)**: bookmarks that follow your Google account, present after sign-in
- **Non-syncing subtree (local)**: bookmarks that exist only on this machine

To make it worse, Chrome explicitly warns **not to identify roots by id or name** (`id` is not fixed). You must classify by `folderType` and pick the subtree by `syncing`. Older implementations hard-coded the roots as `0`/`1`/`2`/`3` and silently skipped the entire account subtree — account bookmarks never synced.

The tree shape also changes with sign-in state:

| State | Roots present |
|---|---|
| Signed out | Local roots only |
| Signed in + local empty | Account roots only (local folders hidden) |
| Signed in + local non-empty | Both |

So the roots must be re-resolved every sync cycle; they cannot be cached as constants.

![Chrome dual-tree normalization: account and local trees are mapped by rootResolver into 8 fixed roots, all hanging under ROOT_UUID as one logical tree](/assets/chrome-dual-subtree.svg)

## The sync engine sees a logical tree, not the browser's trees

The browser shows you multiple roots; the sync engine maintains one **logical tree**: every fixed root hangs in parallel under ROOT_UUID, eight in total:

- Local roots (4): bookmarks bar, other bookmarks, mobile bookmarks, bookmarks menu
- Account roots (3): account bookmarks bar, account other bookmarks, account mobile bookmarks
- Plus ROOT itself

Chrome's account roots and local roots are **parallel** fixed roots (not aliases), and the chromeId ↔ uuid mapping stays 1:1. Firefox has no dual trees; its four native roots (menu / toolbar / unfiled / mobile) map onto the same fixed roots via a static id table. Browser-internal folders such as managed bookmarks are explicitly ignored so they are never mistaken for fixed roots.

The engine turns every bookmark operation into a MoveOp (a Kleppmann tree CRDT) and converges across devices by Lamport timestamps: the same bookmark tree, edited on both sides independently, converges to an identical structure — no lost bookmarks, no cycles.

## So is "one bookmark tree" still accurate?

Look at it on two levels:

- **Logical level: yes.** What syncs is a single-root CRDT logical tree that converges to the same structure across devices. That is exactly what the slogan "one consistent bookmark structure" means technically.
- **UI level: there is a difference.** When Chrome is signed in with non-empty local bookmarks, the machine shows both account and local top-level folders — the user sees multiple roots, not one tree. The slogan describes the synced logical structure, not a single-root display in the browser UI.

One more thing that is easy to miss: **the local (non-syncing) subtree is in sync scope too.** One device / one browser profile binds to one space, and the whole local bookmark tree equals that space — so the intuition "Chrome only syncs account bookmarks" does not hold here; local bookmarks become consistent across devices as well.

Devices that are not signed in receive account content through a **fallback folder**: the engine creates a same-named folder under Other Bookmarks, and once the real account root appears after sign-in, the fallback retires automatically — so the same CRDT subtree never has two representations on one machine.

## What this means for you

1. Seeing both account and local bookmarks bars after signing into Chrome is normal dual-tree behavior, not a broken sync
2. Sign in on another device and both the account tree and the local tree stay consistent
3. If a bookmark "lands in the wrong folder", first decide whether it belongs to the account subtree or the local subtree, then judge whether it is a mapping issue

## FAQ

### After a Chrome update, my bookmarks bar shows two sets of folders — is sync broken?

No. Since June 2025, Chrome's dual trees make account bookmarks and local bookmarks parallel sets of roots; when you are signed in with non-empty local bookmarks, both are shown. The sync engine normalizes both into one logical tree, so they never overwrite each other.

### Can a device that is not signed in receive account bookmarks?

Yes. When there is no real landing root for the account tree on a signed-out device, the engine creates a same-named fallback folder under Other Bookmarks to hold it; once the device signs in and the real account root appears, the fallback retires automatically.

### Do local (non-syncing) bookmarks sync to other devices too?

Yes. The whole local bookmark tree binds to one sync space, and the local subtree enters the CRDT tree as well. This differs from Chrome's official "non-syncing means local-only" semantics: with this extension, local bookmarks also stay consistent across devices.

### Firefox has no dual trees — does it sync less?

No. Firefox's four native roots (menu / toolbar / unfiled / mobile) map onto the same fixed-root UUIDs through a static id table, and account-root content lands via the fallback folder. Every end syncs the same logical tree.
