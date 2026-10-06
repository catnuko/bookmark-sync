---
title: Migrating Bookmarks from Chrome to Firefox: What You Lose and How to Do It Right
description: Moving Chrome bookmarks to Firefox flattens empty intermediate folders and lands your Chrome account subtree under Other Bookmarks. Four unavoidable limits, two migration paths, and how to verify the result.
category: migrate
order: 7
seoTitle: Chrome to Firefox Bookmark Migration · BookmarkSync
seoDescription: What do you actually lose migrating Chrome bookmarks to Firefox? HTML export drops empty intermediate folders, Firefox Sync is a merge model with no account subtree, the Chrome account subtree lands under Other Bookmarks, and tags________ must be skipped. Two paths compared, plus verification.
keywords: migrate Chrome bookmarks to Firefox,import Chrome bookmarks into Firefox,Chrome to Firefox bookmarks,bookmark sync across browsers,Firefox bookmark merge,bookmark hierarchy lost
faq: true
---

# Migrating Bookmarks from Chrome to Firefox: What You Lose and How to Do It Right

The easiest way out of Chrome is to export an HTML file and import it into Firefox. Nearly every tutorial tells you where to click but not what you lose. So you finish the import and discover your nesting changed, empty folders appeared, and bookmarks ended up scattered. This one starts with the four unavoidable limits, then gives you two paths and a way to verify the result.

## What to know before you start

### HTML bookmark files do not store empty intermediate folders

This is the easiest trap to fall into and the easiest to misdiagnose as a bug. The HTML bookmark format structurally cannot express an intermediate level that "exists, contains no bookmarks, and only holds sub-folders." In Chrome you can build a chain like `Work/Frontend/Specs` where `Specs` contains only sub-folders. After export that level is gone, and in Firefox you find `Work/Frontend` holding what used to live one level down.

Stray empty folders show up the same way: those folders you made in Chrome and never used may reappear in odd forms after import. **This is a format limitation, not a tool failing.** No HTML-based migration can avoid it.

> How to check whether you hit it: pick a folder you remember as "three or more levels deep with an empty middle level" and count the levels in Firefox. One level short means it got flattened.

### Firefox Sync is a merge model with no local/account split

This is the most fundamental difference between Chrome and Firefox, and the hardest problem for every cross-browser sync tool.

Chrome splits the bookmark tree into two **parallel subtrees**: local and account, distinguished by a `syncing` field on each root node. So a Chrome signed into a Google account may return six roots from `getTree()` under the root node: local bookmarks bar, local other bookmarks, local mobile bookmarks, plus the account bookmarks bar, account other bookmarks, and account mobile bookmarks.

Firefox has no such thing. Firefox's `BookmarkTreeNode` has **neither a `syncing` field nor `folderType`** — just a fixed `root________` root with four built-in folders beneath it: Bookmarks Menu, Bookmarks Toolbar, Other Bookmarks, and Mobile Bookmarks. Firefox Sync's approach is to **merge** the two sides into one copy rather than distinguish "which part belongs to the account, which is local."

The direct consequence: **you cannot have three independent account roots in Firefox.** Any product claiming to replicate Chrome's three-account-root structure on Firefox is compromising somewhere — usually by quietly folding everything into a single folder.

### The Chrome account subtree can only land under Other Bookmarks in Firefox

Following from the point above. Since Firefox has no concept of an account subtree, the bookmarks Chrome synced down from your Google account have no corresponding home on the Firefox side. The only sensible destination is local "Other Bookmarks" — Firefox's `unfiled_____`.

BookmarkSync's handling is deliberate: when a root lands, it **always falls back to local Other Bookmarks**, creating a same-named folder beneath it to hold the whole subtree. It never falls back into Chrome's account subtree.

> Why not the account subtree? It looks like the more "corresponding" target, but Chrome manages that automatically via its own sync. An extension writing there is uploading the user's bookmarks into their Google account. The position would be right and the ownership wrong.

That behavior is locked down by a regression test. The case in `tests/sync/crossBrowser.test.ts:157` runs against Firefox's real root shape (no `folderType`, no `syncing`) and verifies the account subtree content does land in a same-named folder under Other Bookmarks. That's what a regression test is for: the behavior is a fixed contract, not an accident.

### Firefox's `tags________` must not be captured

Firefox has a built-in bookmark folder called `tags________`, used internally to manage bookmark tagging. It shows up in the bookmark tree, but it is not user data.

Any sync tool scanning the Firefox tree should skip it. What happens if it doesn't? You get a batch of ghost nodes nobody wants and that reappear the moment you delete them — they belong to browser-internal structure, and Firefox recreates them.

## The two migration paths

| | Native: export HTML and import | Cross-browser sync tool |
|---|---|---|
| Speed | One-off, ten-odd minutes | Install once, works long-term; new devices initialize in seconds |
| Empty intermediate folders | **Lost** — the format can't express them | Preserved, synced by node identity |
| Account subtree handling | No such concept; the whole tree lands mixed together | Lands in a same-named folder under Other Bookmarks |
| Manual cleanup | Redone every time you switch devices | Not needed |
| Best for | Switching exactly once | Living across browsers and devices from now on |

The distinction that matters: **a native export is a one-time move; a sync tool is continuous cross-browser sync.** If you are leaving Chrome for Firefox permanently and never coming back, the native path is faster, safer, and no third party ever touches your bookmark data. Don't reach for a tool.

A tool earns its place only when you need **multiple devices and multiple browsers over time** — and that value comes from continuity, not from moving.

## Step by step

### Path 1: native import (when this is a one-time switch)

1. In Chrome open `chrome://bookmarks`, then the three-dot menu at top right and choose "Export bookmarks."
2. **Open the saved `.html` file before importing anywhere.** Search for a folder you remember as "an intermediate level with no direct bookmarks." If it isn't there, that level is already gone and you know exactly what to expect.
3. With Firefox installed, use the menu bar Bookmarks → Show All Bookmarks, then Import and Backup → Import from HTML file.
4. Pick the file from step 1. Firefox asks which folder to import into — choose Other Bookmarks, because as established above, Firefox has no account subtree concept.
5. Don't delete anything in Chrome yet. Run the verification steps below first.

### Path 2: pull the full tree with BookmarkSync

1. Install the BookmarkSync extension in Chrome and sign in with any account. It uploads the current bookmark tree by node identity (node ID + `parentId`), preserving empty intermediate folders as real nodes.
2. Install the same extension in Firefox and sign in to the **same** account.
3. Once the pull completes, your Chrome account subtree content appears in Firefox under a same-named folder in Other Bookmarks. No HTML export, no rebuilding the hierarchy by hand.
4. After that, renaming a folder or moving it on either side updates the other. A rename only touches the `title` field; a move only changes the children's `parentId`. Node IDs never change, so the structure can't collapse.

BookmarkSync supports Chrome, Edge, and Firefox. **Safari is not supported yet.** Limits: free tier 500 bookmarks, 1MB, 1 sync space; Plus 10,000 bookmarks, 20MB, 3 spaces; Pro unlimited bookmarks, 500MB, 10 spaces. Encryption is AES-GCM, and the server stores only ciphertext.

## How to verify the migration worked

Checking once is far cheaper than repairing later. Do these four in order:

1. **Compare totals.** Count bookmarks (excluding folders) in both Chrome and Firefox. If they disagree, first check whether a root is missing or whether an empty folder got counted as a bookmark.
2. **Verify hierarchy, not just counts.** Pick a three-level nested folder you remember well and click into each level to confirm it's intact. Matching counts with flattened hierarchy is the classic HTML-migration failure mode.
3. **Look for stray empty folders.** Skim for empty folders you never created. Leftover empty directories are the residue of dropped intermediate levels — delete them, but recognize that this migration lost information.
4. **Try a rename.** Rename a folder that has children, then refresh the other side. Children still there → the structure is sound. Children gone → that tool stores path strings rather than node identity, and it will break eventually. This is the most sensitive test in the whole set.

Step 4 is worth doing specifically because it doesn't test whether *this* migration worked. It tests whether *every future rename* will work. An HTML export only survives being tested once; a node-identity scheme survives the second test too.

## FAQ

### Some folders are missing after importing Chrome into Firefox — did I lose data?

Most likely your empty intermediate folders were flattened. The HTML bookmark format structurally cannot express an intermediate level that holds only sub-folders and no bookmarks, so it is lost at export time. This is a format limitation that hits every HTML-based migration, not a specific tool's bug. Actual bookmark entries — the ones with URLs — are not lost for this reason.

### Can Firefox have multiple independent account bookmark roots like Chrome does?

No, and this is an architectural difference rather than a missing feature. Chrome splits the bookmark tree into parallel local and account subtrees, distinguished by a `syncing` field on the root nodes. Firefox's `BookmarkTreeNode` has no `syncing` field and no `folderType`, and Firefox Sync merges the two sides into a single copy. So on the Firefox side, content from a Chrome account subtree can only land under local Other Bookmarks. That's decided by the model.

### Should I keep Chrome around after migrating to Firefox?

Keep it until you've run the four verification steps above. Exporting to HTML takes a minute, but since it can't preserve empty intermediate folders it works as a safety net, not a primary strategy. If you settle on a sync tool, leaving Chrome installed is just one redundant copy — the two don't interfere, since they're independent sync channels.

### Will my Chrome signed-in account bookmarks sync over to Firefox too?

Yes, but their landing spot on the Firefox side is a same-named folder under local Other Bookmarks rather than an independent account root, because Firefox has no account-subtree concept. BookmarkSync explicitly falls back to local Other Bookmarks instead of Chrome's account subtree. The latter is managed automatically by Chrome, and an extension writing there would upload the user's bookmarks into their Google account — the position would be right and the ownership wrong.

### Why do sync tools skip Firefox's `tags________` folder?

It's the folder Firefox uses internally to manage bookmark tagging, not user bookmarks. Capturing it produces ghost nodes that can't be removed, since Firefox recreates them. Anything that belongs to browser-internal structure should be left alone during sync.

### Should I turn on Firefox Sync after migrating?

Depends on whether you'll use multiple devices. If it's just one Chrome machine plus one Firefox machine, a cross-browser channel like BookmarkSync is enough, and Firefox Sync would only add merge conflicts — it treats both sides as the same data while a cross-browser sync is already running. Running two sync engines over the same bookmarks guarantees conflict eventually. If you do use Firefox across several devices, turn on Firefox Sync for that part and leave cross-browser sync for the rest — a cleaner split.
