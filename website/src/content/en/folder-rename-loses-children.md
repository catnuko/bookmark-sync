---
title: Folder Renamed, Children Gone: Why It Happens and How to Avoid It
description: Rename or move a folder and hundreds of child bookmarks vanish. The cause is almost always bookmarks being stored as path strings instead of independent nodes — and there is only one real fix.
category: fix
date: 2026-09-22
seoTitle: Folder Rename Loses Children · BookmarkSync
seoDescription: Child bookmarks disappear after renaming or moving a folder? The root cause is bookmarks stored as path strings (bookmarks/work/child) rather than independent nodes, so changing the parent path orphans them. Compare sync approaches and fix it.
keywords: folder rename loses children,bookmarks disappear after rename,moving folder loses bookmarks,bookmark hierarchy broken,bookmark tree structure corrupt
faq: true
---

# Folder Renamed, Children Gone: Why It Happens and How to Avoid It

You rename a folder and the hundreds of bookmarks inside it are gone. Or you drag a folder to a new spot and its entire contents "evaporate." This isn't a mistake you made, and it isn't a browser bug — it's how the sync engine was built.

## The root cause: bookmarks stored as path strings

To see why this happens you need to know something most sync tools never tell you: what a bookmark node actually *is* to the sync engine.

There are two approaches:

| Storage model | What one bookmark actually is | After renaming the parent folder |
|---|---|---|
| **Path string** | `"Bookmarks/Work/Tools/Some Site"` | The path prefix changed → the bookmark is an orphan → **gone** |
| **Independent node + parent pointer** | `{id: "n7", parentId: "f3", title: "Some Site"}` | The parent just has a new id; this node's id is untouched → **intact** |

Path-string tools can only sync by asking "is the path on both sides the same?" The moment you rename a folder, the tool concludes "a bunch of things disappeared on your side, so they must have been deleted" — and propagates that deletion to every device. So it's not just a local loss: **every device loses the bookmarks.**

> This also explains why some tools seem to "fix themselves." Rename the folder back and everything reappears. Nothing was repaired; the tool simply landed back on a path that happens to match again.

## The correct approach: sync node identity, not paths

BookmarkSync uses the second model. Concretely, three rules:

1. **Every bookmark and folder has its own ID.** What syncs is the relationship between IDs (`parentId`), not where the node sits in a path.
2. **Renaming only changes the `title` field.** No IDs change, no relationships change. To the sync engine a rename is just an attribute update.
3. **Moving a folder changes its children's `parentId`.** The children's own IDs are untouched. All hundred child bookmarks still exist; they're simply attached to a new parent.

Which gives you the outcome you expect: renaming and moving are "the location changed," and not a single item is lost.

### A test you can run yourself in ten seconds

Pick any sync tool, find a folder **that has children**, rename it, then refresh:

- Children gone → it stores path strings
- Children intact and in order → it stores node identity

This is faster than reading any documentation, and far more reliable than any marketing claim.

## How the common options actually behave

### Browser-native sync

Chrome and Edge handle folder moves and renames correctly, because they sync the entire browser profile — the "only the bookmark tree" structural problem doesn't arise.

Their problems are elsewhere: bookmarks sit in the vendor's cloud as plaintext (unless you set a passphrase), the sync stops working the moment you switch browsers, and profiles don't interoperate at all. If your goal is "move between browsers," native sync can't get you there.

### Migrating via exported HTML files

It looks universal, but there's a subtle trap: **HTML bookmark files don't preserve empty folders and intermediate levels that contain only sub-folders.** After importing into another browser you'll find certain nesting levels flattened, or extra empty directories you don't remember creating.

And the whole process is manual — you redo it every time you change devices, with no way to undo a misclick.

### File-level sync (cloud drive / Git / WebDAV)

These approaches (putting your browser profile directory into a synced folder) preserve the full structure, because it literally copies files. The cost is **no multi-device merge.** Two devices edit the same folder while offline, and the sync picks a winner by file timestamp — the three bookmarks you added on your laptop get wiped by the older version from your desktop.

Staying safe means locking files manually, which defeats the entire point of automatic sync.

## Which one to pick

| What you need | What fits |
|---|---|
| Chrome only, occasional machine swap | Native sync is enough |
| **Interoperate across browsers without structural loss** | A tool that syncs node identity |
| A team or many devices, with automatic merging | The same, plus real conflict resolution |
| Complete control of your own data | File-level sync, but accept the lack of merging |

BookmarkSync supports Chrome, Edge, and Firefox, syncs node identity, and turns on end-to-end encryption by default — the server stores ciphertext, so we can't read your bookmarks either. The free tier covers 1,000 bookmarks, 1 sync space, and 3 devices, which is enough to verify whether this model is what you want.

## FAQ

### After renaming a folder and losing its children, can I recover them?

If the children still exist in the cloud on another device, usually yes: **pause syncing on every device first** so the deletion doesn't keep propagating, then work from whichever device still holds an intact copy.

A more dependable habit is to export a backup periodically. Exporting to HTML takes a minute, but it won't preserve empty intermediate folders — treat it as a safety net, not the primary strategy.

### Why do some tools "fix it" when I change the name back?

Because they store path strings. Renaming breaks the path, the bookmark is classified as deleted; renaming back makes the path match again and it looks recovered. That's an illusion — and the deletion may already have propagated to your other devices in the meantime.

The real test: did the tool change the bookmark's identity when you renamed it? If yes, it's path-based, and the structure will break eventually.

### Does moving a folder without renaming cause the same problem?

It depends on the implementation. If it syncs paths, moving changes the path and loses the same content. If it syncs node identity, a move only changes the parent relationship and the content stays put. The difference is observable in a single folder rename.

### Can an automatic organizer (dedupe, classification) break my structure?

That depends on which browser APIs it calls. An organizer that only moves and creates won't lose data. An implementation that deletes folders does carry risk — once a deletion propagates through sync, it isn't local anymore. That's also why our automatic organizer only ever moves and never deletes.

### Is it safe to rename bookmarks while sync is active?

Yes. Renaming is the easiest operation for a sync engine to handle correctly, because it touches one node's attributes and changes no relationships.

Moving is the one to be careful with, since it changes the parent of an entire subtree. If an implementation expresses a move as "delete + create," that whole subtree can disappear in a way you didn't intend.