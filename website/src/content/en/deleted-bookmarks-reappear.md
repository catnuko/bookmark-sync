---
title: Deleted Bookmarks Keep Coming Back: How Deletion Syncs and Four Ways to Fix It
description: You delete bookmarks on machine A and they reappear on machine B after syncing. That's not a sync failure — it's deletion failing to propagate. Here's how deletion sync works and how to tell which implementation you have.
category: fix
date: 2026-09-26
seoTitle: Deleted Bookmarks Keep Reappearing · BookmarkSync
seoDescription: Deleted bookmarks reappear after sync (Firefox "bookmarks keep reproducing themselves")? The root cause is that deletion isn't recorded as a fact, so other devices treat it as "not yet received." Four deletion-sync implementations explained.
keywords: deleted bookmarks reappear,bookmarks keep coming back,bookmark deletion not syncing,deleted bookmarks come back after sync,firefox sync keeps restoring bookmarks
faq: true
---

# Deleted Bookmarks Keep Coming Back: How Deletion Syncs and Four Ways to Fix It

You delete a batch of bookmarks on machine A. The next morning you open machine B and they're all sitting exactly where they were. It feels like you mis-clicked and undid it, but the deletion never actually synced.

That's not a sync failure. Quite the opposite — the sync is working perfectly. It's faithfully executing a design you didn't want.

## The key distinction: local deletion vs. global deletion

When a sync engine sees "this device is missing something," it has to answer one question first: **did the user deliberately delete it, or does this device simply not have other devices' changes yet?**

Two guesses, two behaviors:

| The engine's guess | What it does | What you see |
|---|---|---|
| "You deleted it" | Propagates the deletion everywhere | Normal deletion; it stays gone |
| "You haven't received it yet" | Re-adds it on the next sync | Bookmarks resurrect and won't stay deleted |

The second is the root cause of nearly every "deleted bookmarks came back" report. And it has a deeply misleading property: **after one sync, delete again and it often "takes" this time** — because the engine's state has now caught up. So the bug looks intermittent when it's actually deterministic.

## Four implementations, and how to tell which you have

### 1. Plain deletion (the most fragile)

The sync log records only "this node was deleted," with no marker attached. This falls apart with concurrent devices: device B may not yet have seen that deletion and pushes its own stale copy back up, which device A then re-adds. You land in a loop.

**How to recognize it:** delete something, sync a few times, watch it come back. If it returns every time, this is your type.

### 2. Tombstone sync (the correct approach)

Deletion is written as a marker-bearing record ("deleted, id is xxx") that propagates to all devices and is **retained long-term**. Any device that receives that tombstone will never re-add the node.

The essential point: a deletion is a **fact**, not an absence. It needs its own identity and its own lifecycle.

We use this approach. That's the technical meaning behind "precise deletion, never resurrects."

### 3. Last-write-wins (timestamp override)

Each record carries a timestamp; on sync, the newer version wins. This looks fine but breaks down on deletion: deleting means "make it not exist," and a timestamp cannot express "not existing." Deletion is typically handled as an ordinary update, so if another device has a newer timestamp for that same record, the deletion gets overwritten.

**How to recognize it:** the older your deletion, the more likely some later "edit" resurrects it.

### 4. Whole-tree sync (the bluntest)

Every sync pushes this device's entire bookmark tree, overwriting everything else. Single-device, this looks flawless. The moment you add a second device it stops working — any operation on one device silently wipes every change on the other.

**How to recognize it:** take both devices offline, make different changes on each, then bring both online. One device's changes will usually vanish entirely.

## How to confirm which one you're dealing with

Three tests you can run yourself, no documentation required:

**Test 1 — single-device cycling.** Delete a bookmark, sync, then delete it again and sync once more on the same device. If the second deletion "sticks" more reliably, you're on a timestamp-override implementation.

**Test 2 — cross-device.** Delete on device A while device B stays online. Once B has synced, immediately delete the same bookmark on B too, then sync on A. If the bookmark appears on A, it's a tombstone-style implementation. If it doesn't, it's an overwrite-style one.

**Test 3 — watch the iteration count.** If you have to sync two or three times for a deletion to take effect, deletion is ranked below addition in the implementation. That's not good design.

## Before you try to fix anything

**Export your bookmarks first.** The steps below can all cause irreversible results, and understanding what you're dealing with comes before acting. Browsers' built-in "export to HTML" takes ten seconds.

Concretely: until you know which implementation you're dealing with, don't do several things. Don't delete the same bookmarks on multiple devices at once. Don't try to "clean it up" by resetting sync. Don't delete your local bookmarks directory or browser data. These steps make both the deletion state and the actual data unjudgeable.

## How BookmarkSync handles it

Deletions participate in sync as **tombstones**. Each tombstone carries the node ID, propagates to all devices, and stays effective long-term. Three properties follow:

- Delete on device A → device B receives the tombstone and won't re-add it
- Two devices deleting the same node concurrently → the result is deterministic (both consider it gone); it doesn't flip-flop
- A deletion can't be overwritten by a stale push from another device

Tombstones consume a negligible amount of storage, and that cost is unavoidable — **a deletion without a marker is, by definition, a deletion that cannot propagate.**

## FAQ

### Why do my deleted bookmarks reappear, then deleting again works?

This usually indicates a timestamp-override implementation. On your first deletion, another device may still be pushing a newer version of the same record, overwriting your delete. By the time your deletion syncs again, its timestamp is the newest, so it appears to "take."

The problem is that this depends on timing; a different device or moment can bring it back. It wasn't fixed — you just happened to win that round.

### Is deleting on a single device enough?

With a correct implementation, yes. One caveat: that device must complete an **upload** so the deletion can propagate. If you delete bookmarks while offline and then wipe your browser data, the deletion never had a chance to upload — and that device is no longer a participant in the sync.

### Does uninstalling and reinstalling fix this?

No, and it can complicate things. Uninstalling loses local bookmark data, but cloud-side tombstones (if any) remain. If bookmarks reappear after reinstall, that's tombstone sync working correctly — **the cloud records "deleted," and your fresh install interpreted that as a change from elsewhere and pulled it back.** The thing to inspect there is sync state, not repeated reinstalls.

### Do browser-native syncs have this problem?

For simple deletions, Chrome's and Edge's native sync handles things fairly reliably, because they sync the whole browser profile rather than a standalone bookmark tree.

They run into trouble in a different scenario: if you delete a bookmark in Chrome while the same data exists elsewhere (say, in a third-party service), re-linking can leave the deletion state inconsistent. Cross-system setups are where "deleted then came back" shows up more readily.

### How do I confirm the deletion propagated to every device?

The most direct approach is to sync on each device, then **check on each device individually** whether those bookmarks are still there. Don't check on just one — deletion is a broadcast operation and needs confirming at every receiver.

### Can an automatic organizer cause accidental deletions?

That depends on which APIs it calls. An organizer that only moves and creates won't produce deletions, so it won't trigger this issue. Implementations that call delete do carry risk, because once a deletion propagates through sync it's no longer a local operation. That's also why our automatic organizer only ever moves and never deletes.