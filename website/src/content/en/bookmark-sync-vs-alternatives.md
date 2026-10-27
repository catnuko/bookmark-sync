---
title: Choosing a Bookmark Sync Tool: Floccus, XBrowserSync, Raindrop, Cubox vs BookmarkSync
description: Everyone says "bookmark sync", but some tools move your bookmarks into their own panel while others write straight into the browser's native bookmarks bar. A fact-based comparison across five tools — native bar, self-hosting, E2EE, true-tree structure, concurrent merges, and ordering — including when you should pick someone else.
category: explain
date: 2026-10-25
seoTitle: Bookmark Sync Tools Compared · Floccus / XBrowserSync / Raindrop / Cubox / BookmarkSync
seoDescription: How to choose a bookmark sync tool. A comparison of Floccus, XBrowserSync, Raindrop.io, Cubox and BookmarkSync across the native bookmarks bar, self-hosting, end-to-end encryption, true-tree structure, concurrent merges and bookmark order — with an honest account of when each one fits.
keywords: bookmark sync tools compared,Floccus vs, XBrowserSync vs,Raindrop alternative,best cross-browser bookmark sync,native bookmarks bar sync
faq: true
---

# Choosing a Bookmark Sync Tool: Five Tools Compared by Facts

The most common mistake when picking a bookmark tool is comparing two completely different categories as if they were the same thing: **sync engines** (they move the bookmarks already in your browser to another browser — the bookmarks stay in your bookmarks bar) and **bookmark managers** (they collect bookmarks into their own panel, leaving the browser's bookmarks bar empty). Both get called "bookmark tools", but they solve different problems.

This article puts five common tools in one table using facts you can check, then explains where the differences actually come from — and when you should pick someone else.

## Two categories first

**Sync engines**: Floccus, XBrowserSync, BookmarkSync. They read and write the browser's own bookmark tree. After installing, the folders and links you see in your bookmarks bar are still yours — they just also exist in your other browsers. Their value is moving data and keeping it consistent.

**Bookmark managers**: Raindrop.io, Cubox. Their value is organizing — collections, tags, full-text search, read-later. Bookmarks live in their own interface, and your browser's bookmarks bar does not gain anything. To find a link you have to remember to open that panel.

These are not competitors. If you want tags and full-text search over thousands of research links, a manager fits better. If you want bookmarks saved in Chrome to show up in Edge and Firefox's bookmarks bar, a manager cannot help — it just moves your bookmarks from iCloud into another app.

## The matrix: sync engines first

Comparing the three sync engines side by side only makes sense among themselves — they do the same job.

| Criterion | BookmarkSync | Floccus | XBrowserSync |
|---|---|---|---|
| Syncs to the native bookmarks bar | ✓ | ✓ | ✓ |
| No server to run yourself | ✓ | ✗ needs WebDAV / Nextcloud | ✗ needs self-hosted sync server |
| End-to-end encryption | ✓ on by default | set a passphrase manually | ✓ on by default |
| True tree — renames never drop children | ✓ | ✓ | ✓ |
| Deletes propagate and never resurrect | ✓ | ✓ | ✓ |
| Concurrent edits merge without overwriting | ✓ | △ master side wins | ✗ whole-tree overwrite |
| Conflicts resolve automatically — no manual work | ✓ | △ failsafe may halt the sync | ✗ edits overwritten, redo required |
| Order preserved across devices | ✓ | ✗ known issue | ✓ |
| Isolated spaces (work / personal) | ✓ | ✗ | ✗ |
| Free tier | 1,000 bookmarks, free forever | free, but you pay for the server | free, but you self-host |

## Drawing the line with bookmark managers

Raindrop.io and Cubox do not move bookmarks, so questions like "does renaming a folder drop children" or "does a merge overwrite" do not apply — they never touch the tree in your browser. The only thing worth comparing is where your bookmarks actually live.

| Criterion | BookmarkSync | Raindrop.io | Cubox |
|---|---|---|---|
| Syncs to the native bookmarks bar | ✓ | ✗ own panel | ✗ own panel |
| Chrome ↔ Edge ↔ Firefox | ✓ | via its panel | via its panel |
| No server to run yourself | ✓ | ✓ | ✓ |
| End-to-end encryption | ✓ on by default | ✗ not E2EE | ✗ not E2EE |
| Tags / full-text search / read-later | ✗ | ✓ | ✓ |
| Free tier | 1,000 bookmarks, free forever | freemium | paid |

Two points get misread most often, so let us be precise.

**"Not applicable" is not "not supported".** A manager that does not move bookmarks cannot meaningfully "drop children when you rename a folder" — it never touches the tree in your browser. That is why those dimensions do not appear in the second table at all, rather than being marked failed.

**"Set a passphrase manually" and "on by default" are different promises.** Floccus's E2EE depends on the storage backend: Nextcloud Bookmarks, WebDAV, Google Drive and Dropbox support encryption; the Git backend does not. You also have to set a passphrase yourself when configuring the account, and every device must use the same one — skip it and your data is stored in the clear. BookmarkSync and XBrowserSync encrypt by default, so users never have to know that "encryption" is an option.

## Floccus: the most flexible, at the cost of running a server

Floccus is the most mature pure sync engine here: open source, cross-browser, genuinely writes to the native bookmarks bar, and its tree sync and merge semantics are sound. If you have the technical background, there is hardly a fatal flaw.

Its barrier is entirely deployment. Syncing needs a backend: the Nextcloud Bookmarks app, a WebDAV space, Google Drive, Dropbox, or a file in a Git repo. For a developer that is ten minutes of work, but "recommend it to a non-technical family member" does not work — they would first have to sign up for Nextcloud or buy a WebDAV service.

Bookmark order is its known weak spot. Floccus has no ordering setting; the order is a joint result of how the backend stores items and how two clients interleave during a merge, so after a multi-device merge the sequence may not match what you dragged into place. The issue has been open upstream for a long time; the practical workaround is to treat one device as authoritative and make the others read-only, or simply accept that order gets reshuffled.

## XBrowserSync: open source and encrypted by default, but whole-tree overwrite

XBrowserSync's design is clean: install the extension, point it at a sync server, keep bookmarks consistent — end-to-end encrypted throughout, with the server storing only ciphertext.

Its problem is concurrency semantics. Each sync uploads the **entire bookmark tree** as one encrypted snapshot; the server only compares `lastUpdated` and a version number, and whichever timestamp is newer wins. That is not a per-item merge. If two devices edit at the same time, the later upload replaces the earlier one's changes wholesale. It does warn you when the server has a newer version, but a warning cannot rescue a situation where you have already changed different halves on two devices.

The other practical concern is maintenance pace. Its server API has stayed on the same version line for a long time and the dependency tree is old; whether the public sync server is reliable long-term has been a recurring discussion among users. Self-hosting fixes reliability, but that brings back "you have to maintain a server".

## Why their conflicts need you and ours do not

This is the most technical section in the article, and the one that shows the real difference. Let us clear up a common misconception first: **none of these tools pop up a dialog asking "keep A or keep B?"** Their conflict handling is automatic — the question is what you have to do *after* the automatic part.

### XBrowserSync: your edits get overwritten, and the tool asks you to redo them

Its unit of sync is one encrypted snapshot of the whole tree. The server compares only a timestamp and a version number, and the newer one wins. If two devices each changed half of the tree, the later upload replaces the earlier one's work wholesale.

Its own UI strings say this plainly (`res/strings/en.json`):

> `Sync conflict detected` — "Local data was out of sync and has now been refreshed. **Please reapply last change.**"

That is not a choice. It is the tool telling you your last edit is gone and asking you to do it again.

### Floccus: it does not overwrite, but it halts syncs or leaves duplicates

Floccus uses a three-way merge (cache snapshot + local tree + remote tree), which is far more careful than whole-tree overwrite. But its "automatic" handling pushes work back to you in three cases:

**One: a failsafe aborts the sync outright.** It has a deletion threshold; if a run would delete more than a set percentage of your links, it refuses to execute at all (`applyDeletionFailsafe` in `strategies/Default.ts`):

> `E029: The current sync run would delete {0}% of your links on the server. **Refusing to execute.** Disable this failsafe in the profile settings if you want to proceed anyway`

The sync does not run, and you have to go into settings and turn the failsafe off. Is that manual intervention? Yes — and it asks you to make a riskier decision at the exact moment you are least sure whether your data is right.

**Two: concurrent edits are arbitrated by "master side wins".** In the source, `masterLocation` is pinned to local (`Default.ts:625`), and concurrent UPDATEs and MOVEs are resolved as "master takes precedence, do nothing on the other side" (`Default.ts:1488`, `:1320`). There is no error and no prompt — the remote edit is simply gone. The same set of changes can produce different results on different devices, because "master" is relative to each device.

**Three: no cache means deletions do not propagate.** First sync, a cleared cache, or a new device falls back to the `Merge` strategy, whose source comment is explicit (`Merge.ts:60`): `a copy of DefaultSyncProcess#reconcileDiffs without anything involving REMOVEs`. It merges creations and edits only — **deletions do not sync**. Duplicates are deduplicated heuristically ("bookmarks match by URL, folders by title"), and whatever the heuristic misses is yours to clean up by hand.

### BookmarkSync: "conflict" is not a state that exists structurally

We use Move-CRDT (Kleppmann et al., 2021, the replicated tree move operation). The core is `apply_op` in `src/crdt/moveCrdt.ts`, implementing the convergence semantics from Fig. 4 of the paper:

> the state of the tree is **as if all operations had been applied using do_op in increasing timestamp order, regardless of the order in which they were actually applied**

In plain terms: no matter what order operations arrive in, the final result depends only on the *set* of operations, not the *order*. So:

- **Deletion** is "move to the trash node" (`TRASH_NODE_ID`) — not a comparison or an overwrite. A bookmark deleted on A cannot come back because B still has stale data;
- **Moves** are ordered by Lamport timestamps; operations that would create a cycle are rejected but still logged, keeping undo/redo consistent across replicas;
- **No cache snapshot is required**, so there is no "cache lost, deletions stop propagating" mode;
- **No failsafe** — because there is no "would this run delete too much?" judgement to make. A deletion is just a determined move.

The result: **no "please redo your change", no "refusing to execute", no "turn off the failsafe and retry", and no duplicates for you to clean up.**

### One boundary we should state clearly

CRDT converges **structure** (who is under whom, and what exists), not **fields**.

If the same bookmark's title is renamed on two devices at once, **the later write still wins** (`types.ts` documents metadata as `LWW by timestamp`). That one rename is silently dropped.

The difference is that this is a **deterministic outcome that requires nothing from you** — not "sync has stopped and is waiting for you", and not "your change is gone, please redo it". We are not pretending there is no trade-off here; only that the trade-off does not pull you into it.

| | How the conflict shows up | What you have to do |
|---|---|---|
| XBrowserSync | whole-tree overwrite | redo the overwritten edits |
| Floccus | halted sync / silent master-side discard / duplicates | disable the failsafe, accept the loss, clean up by hand |
| BookmarkSync | structure converges automatically; concurrent same-field rename is last-write-wins | nothing |

## Raindrop.io and Cubox: managers, not sync tools

Both products are good at what they do. Raindrop's collections, tags and full-text search are a benchmark in this category, and Cubox's read-later experience is mature in the Chinese market. Their positioning is **collection and research management**, not "make Chrome's bookmarks appear in Edge".

The test is simple: if you would open a dedicated panel to find a link, they fit. If you want links to sit in the bookmarks bar you already look at, they cannot help — they only move "bookmarks live somewhere else" from iCloud to another app.

## Where BookmarkSync differs

We do the same category of thing as Floccus and XBrowserSync: we write to the browser's native bookmark tree. The difference is in specific details.

**No server to run.** Sign up and it works; we host the sync service. That removes Floccus's entire deployment barrier.

**E2EE on by default.** Every bookmark operation is encrypted on your device before upload, and the server only holds ciphertext. Keys never reach the server, and a new device decrypts with the same passphrase.

**A real tree, not path strings.** Some implementations store a bookmark as a path string like `Bookmarks bar/Work/Item`, so when the parent path changes the child can no longer find its home — that is the root cause of "I renamed a folder and all its children vanished". We sync nodes, so renaming, moving and reordering preserve every child and level.

**A delete is a determined move, not a diff.** Deletion is modelled as "move to the trash node", so a bookmark deleted on device A will not come back because device B still has stale data.

**Concurrent edits converge via CRDT, not a three-way merge.** Two devices adding, deleting and editing at once keep each other's additions; offline edits merge in when you reconnect — and the result depends only on the set of operations, not their arrival order (see the previous section).

**Order follows you.** Reorder by dragging on one device and the others keep the same order. The engine converges on sort keys rather than scrambling your arrangement into internal ID order.

**Isolated spaces.** One tree for work, one for personal, each bound to different browser profiles — switching spaces switches sync context. None of the other four offer this.

## When you should pick something else

To be honest, there are three cases where we are not the best answer.

**You want research management, not sync.** Tags, full-text search, cross-device read-later — Raindrop.io is far more mature here and has spent years on exactly that.

**You already run Nextcloud and want the data entirely under your control.** Floccus plugs into your existing WebDAV or Nextcloud, and you never have to trust a third-party service. We cannot offer "the server is completely yours" — that is the inherent cost of a hosted service.

**You need Safari sync.** This one deserves to be explicit: Safari's extension model does not expose the `bookmarks` API, so any tool that syncs Safari's native bookmarks bar needs a native macOS component as a bridge. We currently support Chrome / Edge / Firefox only, have no Safari support, and do not intend to ship a half-finished app to pretend otherwise. If Safari-to-Chrome interop is your core need, look at options with a macOS companion app.

## FAQ

### Can I install several of these at once, or will they fight?

Do not run two bookmark-writing sync tools in the same browser at the same time. Each maintains its own idea of what the tree should look like, and when both write to the same tree they treat each other's changes as dirty data — the usual result is repeated overwriting back and forth. Disable the old tool before switching, and export a manual backup first.

### If two devices edit at once, do I have to pick which side to keep?

No. Structure (whether a bookmark exists, which folder it sits under, and its order) converges automatically via CRDT — the result depends only on the set of operations, not their arrival order, and sync never stops waiting for you to resolve something.

The one exception is the same bookmark's title or URL being changed on two devices at once: the later timestamp wins and the earlier write is silently dropped. That outcome is deterministic and needs nothing from you, but it is also genuinely not "both edits kept".

### How do I verify "end-to-end encryption" instead of trusting the vendor?

Several checkable criteria: whether password reset requires the server (with real E2EE the server has no key, so reset can only wipe and start over), whether the web preview asks for your passphrase, whether the algorithm and KDF iteration count are published, and whether the server can read a single bookmark title. Our site has a dedicated article with the full verification checklist.

### Is the free tier enough?

Our free tier is 1,000 bookmarks, 1 space and up to 3 devices, free forever, with sync capability identical to paid tiers — the three tiers differ only in bookmark count, spaces and device count. Most people have a few hundred bookmarks, so free is enough.

### How do I switch tools without losing bookmarks?

Export an HTML backup first. It takes a minute and is the only thing that lets you undo a bad sync. Then disable the old tool, confirm the bookmark tree in your browser is what you want, and install the new tool for its first sync. After that first sync, check folder counts level by layer — do not just compare totals.

### Why no Safari support?

Safari has not provided the `bookmarks` API since 2011 and has not restored it. This is not a matter of implementation difficulty — the platform simply offers no interface. The only reliable path is a native macOS app that reads and writes Safari's bookmark database directly, plus handling its relationship with iCloud. We evaluated it and decided not to ship a half-finished version: rather than a Safari sync that loses data, we say plainly that it is not supported yet.
