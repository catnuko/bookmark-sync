---
title: Safari Bookmarks to Chrome: What You Lose and the Fastest Path
description: Safari's bookmarks live in a binary plist, but the fastest path isn't a file export — it's Apple's official iCloud Bookmarks extension. What Reader and Smart Folders lose, why order doesn't export, and Chrome's real cost.
category: migrate
date: 2026-10-05
seoTitle: Safari Bookmarks to Chrome · BookmarkSync
seoDescription: What do you lose moving Safari bookmarks to Chrome? Reader and Smart Folders have no Chrome equivalent, and bookmark order doesn't export to HTML. Start with Apple's official iCloud Bookmarks extension, compare paths, and learn how to verify.
keywords: Safari bookmarks to Chrome,import Safari bookmarks into Chrome,iCloud bookmarks Chrome,export Safari bookmarks,bookmark order changed after import,move Reader list to Chrome
faq: true
---

# Safari Bookmarks to Chrome: What You Lose and the Fastest Path

The fastest way to get Safari bookmarks into Chrome is neither a file export nor a third-party tool — it's Apple's own iCloud Bookmarks extension. Install it and Chrome reads your iCloud bookmarks directly; you're done in minutes. But it's read-only, and several Safari features have no Chrome counterpart at all. Here's what gets lost first, then how to do it.

## What to know before you start

### Where Safari's bookmarks live, and why you can't just read them

Safari's bookmarks are **not** something the browser reads from `~/Library/Safari/Bookmarks.plist` in any routine way. That plist is a binary Apple property list in a proprietary format, and on modern macOS the actual source of Safari's bookmarks is iCloud — the local plist behaves more like a cache or a compatibility leftover.

Two consequences follow. Any third-party tool that wants Safari's bookmarks directly has to handle that binary plist first. And more fundamentally, **reading the file is not the path Apple intends you to use.** That path is next.

### The first path to try is Apple's official iCloud Bookmarks extension

This is the method to try first, because it satisfies three things at once: it's fast, it's safe, and no third party ever touches your data. Apple's official iCloud Bookmarks extension for Chrome lets Chrome read your iCloud bookmarks directly — **no export, no intermediate file, no conversion.**

Compare how many stages the alternatives involve:

| | iCloud Bookmarks extension | Manual HTML export, then import | Third-party migration tool |
|---|---|---|---|
| Who touches your data | Apple and Google only | You only | Depends on the tool |
| Speed | Done once installed | Ten-odd minutes | A few minutes |
| Requires an Apple ID | Yes | No | No |
| Read-only | **Yes** | N/A | Bidirectional |
| Empty intermediate folders | Preserved | **Lost** | Preserved |
| Bookmark order | Preserved | **Reordered** | Preserved |

> Be clear about the tradeoff though: this extension is **read-only**. Changes you make in Chrome do not write back to Safari, and it is not a mechanism for continuous two-way sync. It solves "get the bookmarks over here once," not "keep both sides in step."

It also depends on being signed in to an Apple ID. If you'd rather Google not have access to your iCloud content, or you don't use iCloud bookmarks at all, this route is closed — use the native import and verification steps below instead.

### Reader and Smart Folders have no Chrome equivalent

This is what genuinely gets lost in a Safari bookmark migration, and it's the least-mentioned part.

Safari has two concepts Chrome simply doesn't have:

- **Reader** — Safari maintains a "read later" list separately from bookmarks. Plenty of people conflate the two, but they aren't the same thing. Chrome has no Reader, so the nearest equivalents are "Send to your devices"-style reading lists or third-party extensions, and neither behaves identically.
- **Smart Folders** — folders that aggregate dynamically by rule, such as unread, recently added, or carrying a given tag. A Smart Folder is a query, not a stored list: its contents are computed from a rule rather than saved as a fixed set.

After migrating you'll notice these **weren't carried over**, because the format has nowhere to put them. The HTML bookmark format knows exactly two things — folders and bookmarks — and has no field that can express "this is dynamically computed" or "this is a reading queue."

> How to handle it: before migrating, open Safari's Reader list and manually bookmark (Cmd+D) anything you want to keep. For Smart Folders you care about, expand it and save the selection as an ordinary folder. It's a one-time manual chore, and skipping it means losing those items for good.

### Bookmark order does not export — a format limit, not a bug

This deserves its own section because so many people assume a tool did it badly. The HTML bookmark format (Netscape Bookmark File Format) **has no order field.** Entries inside a folder may be stored alphabetically in the file, but the information "this is the order I dragged them into" simply does not exist at export time.

So after importing into Chrome you'll find the order changed — usually to alphabetical or import order. **That is not a bug; the format cannot carry that information.** Every HTML-based migration reorders as a side effect.

If order matters to you, write it down elsewhere or keep it in a note, then drag things into place once after migrating. It's a one-time cost.

### Chrome's cost: what the sync passphrase doesn't cover

This one is security-relevant and Google states it plainly in their own documentation. Chrome's sync encryption has limits: **payment methods and addresses are not encrypted by the sync passphrase.**

So if you set a passphrase on Chrome sync, don't assume everything is covered. Bookmarks are within its scope; payment methods and addresses are not.

How this affects the decision: if you care about how much data Google ends up holding, then routing your bookmarks through Apple's extension (they pass through both Apple and Google) involves one more hop than exporting the file yourself and importing locally. A purely local import — export HTML, then import it yourself in Chrome — moves the least data, because nothing is uploaded to anyone by your action.

## The two migration paths

Beyond the iCloud extension above, there are two real options:

| | Native import (Safari export → Chrome import) | Cross-browser sync tool |
|---|---|---|
| Speed | One-off, ten-odd minutes | Install once, works long-term |
| Empty intermediate folders | **Lost** | Preserved |
| Bookmark order | **Reordered** | Preserved (each entry carries a sort key) |
| Editing on both sides afterwards | Impossible | Supported |
| Who handles the data | You only | The tool's server (AES-GCM by default, ciphertext only at rest) |
| Safari support | Not needed | **No Safari extension today** |

**The distinction that matters: a native import is a one-time move; a sync tool is continuous cross-browser sync.** But for Safari specifically, be straight about this: BookmarkSync does **not** support Safari yet, and there is no Safari extension. If what you want is "Safari and Chrome stay in sync over time," that's not achievable right now.

The honest combination today: **do the one-time move with a native import, then rely on Chrome-side sync to stay consistent across your devices.** If you want Safari itself to remain part of the picture, keep Safari's own copy in step through iCloud Bookmarks and iCloud Tags within the Apple ecosystem.

## Step by step

### Path 1: Apple's official iCloud extension (try this first)

1. Confirm your Safari bookmarks have reached iCloud. Check the Bookmarks toggle in iCloud settings — on macOS it's System Settings → Apple Account → iCloud.
2. Install Apple's official iCloud Bookmarks extension for Chrome. This step requires signing in with your own Apple ID; Apple does not hand it to any third party.
3. Once installed, open Chrome's bookmark manager. The extension adds an iCloud bookmarks entry in the sidebar. The first load can take a while depending on how many bookmarks you have and the state of iCloud.
4. Click through your top-level folders one by one and confirm the hierarchy and counts match what you expect. Remember the extension is read-only: nothing you do in Chrome writes back to Safari.
5. When it looks right, go to Chrome Settings → Sync and turn on Bookmarks so these bookmarks enter Chrome's own sync system. Keep in mind the caveat above about payment methods and addresses not being covered by the passphrase.

### Path 2: manual export and import (no iCloud dependency)

1. Handle the lossy parts first in Safari: manually bookmark everything you want to keep from Reader, and expand Smart Folders to save them as ordinary folders. Don't skip this — skipping means permanent loss.
2. Select the folders to migrate (or press Cmd+A for everything), then use the right-click menu or the File menu to export as bookmarks. You can also right-click the "Favorites" bookmarks folder and export from there; the resulting `.webarchive` retains the folder structure.
3. **Open the exported file and look at it.** If you remember an intermediate level with no direct bookmarks in it, search for it — if it isn't there, that level is already gone.
4. Open Chrome, go to the bookmark manager (`chrome://bookmarks`), then the three-dot menu at top right → "Import bookmarks and settings."
5. Choose the HTML file option and point it at the file from step 2. Pick the "Imported" folder as the destination so your existing bookmarks aren't disturbed.
6. After importing, run the verification steps below, then clean up the stray empty directories.

## How to verify the migration worked

1. **Compare totals.** Count bookmarks (excluding folders) in Safari first, then in Chrome. If they disagree, check whether folders got counted, or whether an entry is duplicated.
2. **Verify hierarchy.** Pick a nested folder you remember well and click into each level. Matching totals with flattened hierarchy is the classic HTML-migration failure mode.
3. **Confirm the Reader and Smart Folder handling matches what you want.** If you didn't convert those manually before migrating, that content is gone. Go back in Safari, save the items you want as ordinary bookmarks, and export a second incremental batch.
4. **Look at the order.** Changed order is a format limit, not a migration failure. But if a folder's order matters to you, drag it into place now — another export will scramble it again.
5. **Clear out the stray empty folders.** HTML's dropped intermediate levels leave this kind of residue. They're useless, so delete them — while recognizing that this migration did lose information.

## FAQ

### Can Safari bookmarks be imported straight into Chrome without exporting a file?

Yes, and it's the preferred method. Apple's official iCloud Bookmarks extension lets Chrome read your iCloud bookmarks directly, with no export and no intermediate conversion. The prerequisites are that your Safari bookmarks are already in iCloud and that you're comfortable with that link existing while signed into Chrome. The limitation is that the extension is read-only — changes in Chrome don't write back to Safari.

### My bookmark order all changed after migrating. Did the migration fail?

No — this is a format limit. The HTML bookmark format has no order field, so the arrangement you produced by dragging in Safari doesn't exist at export time. After import you generally get alphabetical or import order. Every HTML-based migration reorders as a side effect. To restore it, drag things into place once after migrating.

### Can Safari's Reader list move to Chrome too?

No, and there's no exact equivalent. Reader is a "read later" queue that Safari maintains separately from bookmarks, and the HTML bookmark format has nowhere to put it. Chrome's nearest counterparts are its reading list or a third-party extension, neither of which behaves identically. The reliable approach is to manually bookmark the articles you want in Safari before migrating.

### What about Smart Folders — is there a Chrome equivalent?

There is no matching concept. A Safari Smart Folder is a rule-based dynamic query, not a static list, and the HTML format can't express that structure. Before migrating, expand any Smart Folder you care about, select everything, and save it as an ordinary folder — you'll then have an equivalent static version in Chrome.

### Can a sync tool keep Safari and Chrome in step over time?

Not at the moment. BookmarkSync supports Chrome, Edge, and Firefox, and **Safari is not supported yet** — there's no Safari extension. So the workable combination today is: a native import for the one-time move, then Chrome-side sync to stay consistent across devices, while Safari's own copy stays in step through iCloud. The value of continuous cross-browser sync only holds between Chrome, Edge, and Firefox.

### If I sign into the extension with my Apple ID, who sees my bookmark data?

With the iCloud extension path, bookmark data passes through both Apple and Google. If you'd prefer less data movement, or don't want iCloud content associated with a Google account, skip the extension and do the manual HTML export and import yourself — on that path the bookmarks stay on your machine and aren't uploaded by anything you do. Also keep in mind that Chrome's sync encryption has a defined scope: Google states plainly that payment methods and addresses are not encrypted by the sync passphrase.
