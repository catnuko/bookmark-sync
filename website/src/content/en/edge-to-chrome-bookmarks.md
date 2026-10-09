---
title: Merging Edge Favorites into Chrome: The Easy Migration and the Duplicates Problem
description: Edge and Chrome share the Chromium engine and a fully compatible bookmark format, making this the cheapest migration there is. What carries over, what doesn't (Collections, edge:// paths), and why deleted favorites come back.
category: migrate
date: 2026-10-06
seoTitle: Edge Favorites to Chrome · BookmarkSync
seoDescription: How do you merge Edge favorites into Chrome? Both run on Chromium with fully compatible formats, but Collections and edge:// paths don't carry over. Full HTML import steps, two paths compared, and why deleted Edge favorites keep reappearing.
keywords: Edge favorites to Chrome,import Edge bookmarks into Chrome,sync Edge favorites to Chrome,Edge favorites keep duplicating,can't delete Edge favorite,Chromium bookmark compatibility
faq: true
---

# Merging Edge Favorites into Chrome: The Easy Migration and the Duplicates Problem

Edge to Chrome is the lightest of all bookmark migrations: both run on the Chromium engine, the formats are fully compatible, and the same HTML file imports without trouble. But "easy" isn't the same as "lossless" — Edge's Collections feature and `edge://favorites` paths don't carry over, and there's a problem that frustrates a lot of people: deleted favorites reappear. Here's what the boundaries are and what to do.

## The good news: the most compatible pair there is

Edge and Chrome both run on Chromium and share the same internal bookmark format. Two consequences:

1. **HTML export and import barely loses structure between them.** Compare that with Chrome to Firefox (where Firefox's `BookmarkTreeNode` has neither `folderType` nor `syncing`) or Safari to Chrome (a binary plist with no matching concepts), and Edge to Chrome is the cleanest path at the format level.
2. **Both use the same browser extension API.** Anything built on `chrome.bookmarks` behaves identically on Edge and Chrome, with no per-browser adaptation.

So if you only want to "get Edge's favorites into Chrome and stop using Edge," a native import is the right answer and no third-party tool is needed. The data never leaves your machine.

## What to know before you start

### What comes with you and what doesn't

| Item | Transfers? | Notes |
|---|---|---|
| Bookmark entries (URL + title) | Yes | Fully preserved |
| Folder hierarchy (including nesting) | Yes | Edge's nesting maps straight across |
| Folder order | Yes | Same format, order preserved |
| Collections | **No** | Edge-only concept, no Chrome equivalent |
| Bookmark paths | **No** | `edge://favorites` path rules don't apply to Chrome |
| Passwords, extensions, history | Out of scope | Browser profile data, not bookmarks |

### Edge's Collections have no Chrome equivalent

Collections are how Edge groups related favorites together — one Collection can hold multiple folders and bookmarks, forming a logical grouping that cuts across the folder tree. Chrome has no such concept; its only organizational unit is the folder, which is a strict tree.

What you lose after migrating is the **cross-directory grouping view**. If your favorites are organized by Collections, they arrive in Chrome as a set of flat top-level folders. A Collection isn't preserved as a unit and doesn't turn into a folder.

> This isn't an export bug — the destination browser lacks the feature. To keep the organizational intent, build a same-named Chrome folder after migrating and move things into it. One-time work.

### `edge://favorites` paths don't apply in Chrome

Edge manages favorites internally at `edge://favorites`; Chrome's equivalent is `chrome://bookmarks`. The differing address is trivial, but there's a practical consequence: **any link you bookmarked in Edge favorites that points at an `edge://` internal page won't open in Chrome.**

Chromium allows bookmarking internal page addresses, and Edge favorites do accumulate these. After migrating they're still there but dead, because Chrome doesn't understand the `edge://` protocol. Delete them and move on.

### The real reason deleted favorites reappear

This is the long-tail question Edge users search for most, and it deserves its own section because it's so often misdiagnosed.

With Edge sync on, you delete a favorite in Edge, refresh or switch devices, and it's back. This is usually not a bug — it's **two sync engines fighting**:

1. Edge's built-in sync (signed into a Microsoft account) uploads your deletion to Microsoft's cloud.
2. If a third-party sync tool is also running (or a Chrome-side account is syncing the same bookmarks), that tool still records the bookmark as present.
3. Each engine treats the other as authoritative, and the deletion gets pulled back repeatedly.

Another common cause is **path matching**. If a tool stores bookmarks as path strings (something like `Favorites bar/Work/Tools`), deleting the "Work" folder leaves it seeing "the old `Favorites bar/Work/Tools` is gone" — but the path reappears on the next cycle, because it matches paths, not node identity. For those tools, deleting a folder and recreating it looks exactly like "it came back."

**Which one is it for you?** Turn off Edge sync and observe:

- Stops reappearing → two sync engines are conflicting
- Still reappears → the tool's deletion handling is broken. Try renaming the folder instead of deleting it. If renaming stops the resurrection, it's matching paths.

> The straightforward fix is to **keep only one sync engine.** If Edge is already syncing through a Microsoft account, don't add a second tool syncing the same bookmarks. Either use Edge's native sync, or use a cross-browser tool and turn Edge's native sync off.

## The two paths

| | Native import (Edge HTML export → Chrome import) | Cross-browser sync tool |
|---|---|---|
| Migration cost | Lowest — same-origin format loses little | Requires install and setup |
| Structural completeness | Good (same format); only the HTML format's own limits apply | Good — synced by node identity |
| Keeping Edge in use afterwards | **No longer synced**, two independent copies | Stays consistent |
| Fixes "deleted items come back" | No — that requires changing the sync mechanism | Yes (provided you keep only one engine) |
| Who handles the data | You only | The tool's server (AES-GCM by default, ciphertext only at rest) |

**The distinction that matters: a native import is a one-time move; a sync tool is continuous cross-browser sync.** This is especially worth stating for Edge to Chrome: if Edge is only installed for some legacy system and you're done with it, a native import takes ten minutes and you shouldn't involve a third party. But if you plan to use both Edge and Chrome long-term — let alone want them to stay in step — that's where a tool earns its place.

## Step by step

### Path 1: native import (when this is a one-time move)

1. Type `edge://favorites` in Edge's address bar to open the favorites page.
2. Search for bookmarked `edge://` internal pages (search `edge://` to see how many there are). They won't open in Chrome, so know the count in advance and delete them after importing.
3. Use the export option in the favorites page (or bookmark manager) to export an HTML file. **Export only the folders you're actually moving**, not everything — a full export drags along years of links you never open.
4. **Open the exported file and look at it.** If you remember an intermediate level with no direct bookmarks in it, search for it. Edge to Chrome is the same format, so this rarely bites, but looking costs less than discovering it later.
5. With Chrome installed, open `chrome://bookmarks`, then the three-dot menu at top right → "Import bookmarks and settings."
6. Choose the HTML file and point it at the file from step 3. Pick the "Imported" folder as the destination so existing bookmarks aren't overwritten.
7. After importing, run the verification steps below. Two things to check specifically: bookmarks beginning with `edge://` (dead on click) and any stray empty directories.

### Path 2: use cross-browser sync to stay consistent

If you'll be using both Edge and Chrome long-term:

1. Decide which sync system you're keeping. If Edge syncs through a Microsoft account, **turn that off first** (Edge Settings → Accounts → turn off "Sync favorites"), or the two engines will fight.
2. Install the BookmarkSync extension on both Edge and Chrome and sign in to the same account. Edge runs on Chromium, so the `chrome.bookmarks` API is available natively — no special adaptation needed.
3. Once the pull completes, both trees match, and folder renames and moves propagate. A rename only changes the `title` field; a move only changes the children's `parentId`. Node IDs never change, so structure can't collapse from a rename.
4. When you hit an entry you can't delete, rename or move it instead of deleting. In a node-identity implementation a move only changes the parent relationship, which safely sidesteps the trap where a deletion is read as a path change.

BookmarkSync supports Chrome, Edge, and Firefox; **Safari is not supported yet.** Limits: free tier 500 bookmarks, 1MB, 1 sync space; Plus 10,000 bookmarks, 20MB, 3 spaces; Pro unlimited bookmarks, 500MB, 10 spaces, each bindable to a different browser profile. Encryption is AES-GCM on by default and the server stores only ciphertext.

## How to verify the migration worked

1. **Compare totals.** Count bookmarks (excluding folders) in Edge and in Chrome. If they disagree, check whether folders got counted or an entry is duplicated.
2. **Spot-check hierarchy.** Pick two or three nested folders you remember well and click into each level. Same-format migration rarely breaks this, but spot checks are cheaper than a full read-through.
3. **Clear out the `edge://` bookmarks.** Search `edge://` in Chrome's bookmark manager and delete the results. They're dead links once you're there.
4. **Check for duplicates.** If the same bookmarks existed on both sides and you didn't clean up before importing, you'll get duplicate entries. Search a few of your most-visited sites and confirm there's exactly one copy.
5. **If "deleted items come back" was already a problem**, follow the section above: shut down one sync engine and watch. If entries still return, try a rename instead of a delete — whether they come back tells you immediately whether you're dealing with path matching or node identity.

## FAQ

### How do I import Edge favorites into Chrome?

The simplest route is exporting to HTML and importing: open `edge://favorites` in Edge, export your bookmarks as an HTML file, then in Chrome go to `chrome://bookmarks`, click the three-dot menu at top right, choose "Import bookmarks and settings," and select the HTML file option. Edge and Chrome share the Chromium engine and a fully compatible format, which makes this the cleanest migration path at the format level — nesting normally survives intact.

### Can Edge Collections move to Chrome too?

No. Collections are an Edge-only concept. Chrome's only organizational unit is the folder, which is a strict tree, with no cross-directory grouping view. After migrating your content is all there, but a Collection isn't preserved as a unit and becomes a set of flat top-level folders. To keep the organizational intent, create a same-named Chrome folder after migrating and consolidate them by hand.

### Why do my Edge favorites keep coming back after I delete them?

Usually not a bug — two sync engines are fighting. Edge's built-in sync uploads your deletion while a third-party tool (or a Chrome-side account syncing the same bookmarks) still records the bookmark as present, and they overwrite each other until the deletion is restored. Another common cause is a tool that matches bookmarks as path strings: you delete a folder, and on the next cycle it sees the path disappear and reappear and concludes nothing was deleted. The fix is to keep only one sync engine. If Edge is already syncing, don't add a second one; if you want cross-browser sync, turn off Edge's native sync.

### If I migrate to Chrome, can I still use my bookmarks in Edge?

Yes, but it depends on which path you took. With a native import, the two sides are **no longer synced** — changes in Edge don't reach Chrome or vice versa. If you need them to stay consistent, use a cross-browser sync tool: it syncs by node identity (node ID + `parentId`), and since Edge and Chrome share the Chromium `chrome.bookmarks` extension API, behavior is consistent with nothing browser-specific to maintain.

### Will `edge://favorites` links I bookmarked in Edge open in Chrome?

No. `edge://` is Edge's internal protocol and Chrome doesn't understand it, so those links are dead on click. Chromium permits bookmarking internal page addresses, so these entries survive the migration but do nothing. Search `edge://` in Chrome's bookmark manager to find them all and delete them. The same applies in reverse: `chrome://` bookmarks don't open in Edge.

### Should I turn off Edge sync before migrating?

Not if you only use a native import — the two sides are independent afterward. But if you're running a cross-browser sync tool on both, **you should turn off Edge's native sync.** Two engines managing the same bookmarks makes delete/add conflicts unavoidable, and the symptom is exactly "I deleted it and it came back." Keeping a single sync engine is the simplest fix.
