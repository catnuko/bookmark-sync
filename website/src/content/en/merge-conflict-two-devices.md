---
title: Two Devices Edited the Same Bookmarks: Four Merge Strategies and What Each Costs
description: You added 30 bookmarks at the office, synced at home, and the 30 were gone. This is a merge conflict. The root cause is which strategy your engine uses to arbitrate "both sides changed" — and only one of the four can guarantee nothing is lost.
category: fix
date: 2026-09-28
seoTitle: Bookmark Merge Conflicts Explained · BookmarkSync
seoDescription: New bookmarks vanish after a two-device sync, or merges keep fighting each other? Compare last-write-wins (loses data), three-way merge (needs a common ancestor), full overwrite, and CRDT. With offline concurrency tests.
keywords: bookmark merge conflict,sync conflict bookmarks,new bookmarks disappeared after sync,last-write-wins data loss,bookmarks overwritten between devices,CRDT bookmark sync,two way merge conflict
faq: true
---

# Two Devices Edited the Same Bookmarks: Four Merge Strategies and What Each Costs

You collect 30 new bookmarks on your work laptop, open your home desktop, sync, and the 30 are gone. Or both devices add a few items and the result changes on every sync attempt. People usually read this as "sync is flaky," but it's deterministic — it happens the same way every time. Only the trigger differs. What changes is how your engine arbitrates the fact that both sides edited.

## Identify the conflict class first

Four symptom classes map to four different mechanisms. Knowing which one you're looking at tells you where to investigate.

| What you see | Conflict type | Mechanism-level cause |
|---|---|---|
| New entries vanish wholesale, old ones remain | Overwrite | The engine picked a whole snapshot by timestamp or version |
| The same bookmark's title flip-flops between two values | Divergent convergence | The merge result isn't deterministic, or ordering is unstable |
| After merging, the total count is too low | Merge dropped data | The conflicting branch was discarded instead of merged |
| Everything is present but the order changes every sync | Unstable ordering | Sort keys are unstable or lack a tie-break |

The second class is the one most often reported as "sync is flaky." It isn't random — the same inputs converge on the same wrong answer every time. It looks random because the input combination differs each run.

## Mechanism 1: last-write-wins (timestamp overwrite)

The most common approach and the easiest way to lose data. Each record carries a timestamp; whichever version is newer wins.

It has a flaw no patch can fix: **it can express "which version is newer," but not "what each version independently changed."**

Concretely, here's how it breaks with bookmarks:

1. Your desktop is offline and you add 5 bookmarks
2. Your laptop syncs, renames an old bookmark, and that record's timestamp gets refreshed
3. The desktop comes online and the engine sees "the laptop's record is newer," so it overwrites
4. Result: the 5 new bookmarks are deleted, because their timestamps are older

Every step the engine took was correct under its own rule. The rule just doesn't distinguish "this entry was modified" from "this entry is newly created."

There's a second, sneakier problem: **clocks aren't reliable.** Devices with drifted clocks, a user who manually changed the system time, a daylight-saving transition — any of these produce wrong arbitration. What you end up with is a sync system whose outcome depends on whose clock is more accurate.

**How to spot it:** Take two devices offline, add a few bookmarks on each, then bring both online at once. If one side's additions disappear entirely, that's this mechanism.

## Mechanism 2: three-way merge

Version control uses it for code conflicts, and it works well. The precondition is that a common ancestor must be available: you can only compute differences if both branches can be compared against the same base.

Ported to bookmark sync, it needs something sync engines usually don't have: **a trustworthy historical baseline.**

| Requirement | What three-way merge needs | Reality in bookmark sync |
|---|---|---|
| Common ancestor | A snapshot both sides agree on | A device may have been offline for months; no usable common snapshot exists |
| Local changes | Diff against the ancestor | Requires keeping the local unpushed changeset |
| Remote changes | Diff against the ancestor | Requires keeping the remote version |
| Conflict markers | Insert markers for manual resolution when auto-merge fails | The bookmark tree has no place to put markers |

After a device has been offline long enough, the common ancestor is either stale or nonexistent. At that point three-way merge degrades into a slower last-write-wins.

The messier part is that conflict markers have nowhere to go in a bookmark tree. If both sides renamed the same bookmark, code can insert `<<<<<<<` and ask the user, but a bookmark has no such position — the engine either picks one arbitrarily or splits it into two folders.

**How to spot it:** When a conflict happens, the interface asks you to choose which version to keep, and two devices may suggest *different* picks. Three-way merge almost always comes with a visible human-in-the-loop step.

## Mechanism 3: full-tree overwrite

The crudest option. Sync doesn't diff at all: it pushes the local bookmark tree over the cloud, or pulls the cloud over the local, wholesale.

On a single device this looks flawless, because local is the only source of truth. With two devices it collapses immediately: any action on any device silently erases every change on every other device.

Worse, you get no warning at all, because the transfer succeeded. **A successful transfer masking an incorrect merge** is what makes this mechanism dangerous.

**How to spot it:** Take two devices offline and edit *different* folders on each (avoid the same folder so merge logic isn't triggered), then sync the devices in sequence. If the second sync erases the first device's changes entirely, it's full overwrite.

## Mechanism 4: CRDT (convergent replicated data type)

The last option, and the only one that gets both guarantees at once: nothing is lost, and convergence is deterministic.

The core idea is to design the data structure so operations are commutative, associative, and idempotent — meaning a set of operations produces the same result no matter what order they arrive in or which device applies them. That's a mathematical property, not something that needs an external rule to decide a winner.

How that lands for bookmark sync:

1. Every bookmark has a unique ID
2. Editing a title attaches a new timestamped update to that ID rather than overwriting in place
3. Merging collects all versions of the update and folds them into a final state by timestamp and node identity
4. Because the fold is a pure function, every device necessarily computes the same result

The decisive difference is the last one. **Overwrite-style mechanisms are "whoever arrived first wins" plus a fallback rule. A CRDT is "the result is determined by the inputs, independent of arrival order."**

Two verifiable consequences:

- No random flipping. The same inputs produce the same result on the second run as on the first, and you can check this repeatedly.
- No mutual overwrite. Changes to different fields of the same bookmark, or independent additions, both survive.

The cost is on the table: all versions of updates must be transmitted and retained for a while. Storage buys correctness. And **node identity must be stable** — if identity is judged wrong (one node treated as two, or two treated as one), a CRDT's convergence guarantee breaks down. It guarantees "all replicas converge on the same input set," not "the input set is correct."

| Dimension | Last-write-wins | Three-way merge | Full overwrite | CRDT |
|---|---|---|---|---|
| Concurrent additions lost | Yes | Depends on ancestor availability | Yes | No |
| Result deterministic | Depends on clocks | Depends on human choice | Deterministic but harmful | Deterministic |
| History required | No | Needs a common ancestor | No | No |
| Human intervention | Not needed | Needed on conflict | Not needed | Not needed |
| Effect of an inaccurate clock | Wrong version wins | Skews judgment | No direct effect | Logical clock orders instead |
| Storage cost | Low | Medium | Low | Medium-high |
| Cost of wrong identity | Data loss | Data loss | Entire tree overwritten | Converges on a wrong state |

## Testing your implementation yourself

Three tests. Two devices is enough; nothing more.

**Test one: concurrent additions (the one that matters).** Take both devices offline. On device A, create a folder and add 4 bookmarks inside it. On device B, add 2 completely different bookmarks elsewhere. Then bring both online at the same time.

- Result is 6 bookmarks across two folders → real merge capability
- Only 2 remain, or only 4 → overwrite implementation, and you just lost data

Both devices must be offline for this test. If either one just synced, the baseline is gone and the test proves nothing.

**Test two: edit one bookmark twice.** With both devices offline, rename bookmark X twice on device A. Also rename it twice on device B, ending on a different value. Sync, and inspect.

- Same result every time → convergence is deterministic
- Title changes after syncing back and forth → you have a divergent-convergence implementation

**Test three: sort-key stability.** Take a folder with 5 bookmarks. Reorder by dragging on device A, then sync. Once device B reflects the new order, drag it into a different order on device B and sync back to A.

- Order follows consistently → stable sort keys
- Order changes on every sync → unstable sort keys, or no tie-break

Sort keys need two things: lexicographic ordering so new items can be inserted in the middle, and a deterministic tie-break when two keys collide. Doing the first without the second means two bookmarks with equal keys can swap relative order on every sync.

## The correct order for repairing existing conflicts

Get this sequence wrong and you keep merging two bad states into each other.

1. **Export a backup first.** Before changing anything. A damaged state is the least able to absorb a second change.
2. **Pause sync on all devices.** One at a time — make sure no device is still uploading an old structure.
3. **Pick the device with the most complete data as the authoritative copy.** "Most complete" means the most bookmarks with the most correct structure, not the most recently synced one.
4. **Fix the structure on the authoritative device.** Parent relationships, ordering, folder membership.
5. **Wipe local data on the others and pull one-way from the authoritative device.** One way, not a mutual merge. Merging two broken structures just produces a third.
6. **Only restore sync once everything has caught up.** Reversed, you haven't fixed anything.

> If you're on an overwrite implementation, steps 3 through 5 are mandatory, not optional. Two devices' data has already been partially lost to the overwrite process, and nothing recovers the overwritten portion automatically — what the server stores *is* the overwritten version.

## How BookmarkSync does it

We use a CRDT with a logical clock. The logical clock is a monotonically increasing counter that doesn't depend on device clocks being accurate — it records how many changes have happened on this device, and orders multiple versions of the same record by that.

Convergence is deterministic: the same set of operations produces the same result on every device, no winner-this-round-then-winner-next-round. You can verify this repeatedly, which is the point of test two above.

Deletions use tombstones. A tombstone is a record with an identity that is retained long-term, not an absence. That's what stops a device that never saw the deletion from re-uploading the bookmark. Tombstones cost a little storage, and that's the price — **a deletion with no marker is, by definition, a deletion that cannot propagate.**

Sort keys are fractional positions: lexicographic, with a UUID tie-break. Drag-and-drop reordering changes only the key and never touches node identity, so it doesn't collide with concurrent edits.

## FAQ

### Both devices edited the same bookmark — which version wins?

Depends on the implementation. Last-write-wins keeps the newer timestamp, which is the wrong one if clocks are off. Three-way merge makes you choose. A CRDT keeps a deterministic result and doesn't erase either side's changes — rename on one device and icon on the other, and both survive.

Test it with test two above: go offline on both, edit once each, sync twice, and see whether the result changes. If it changes, convergence isn't deterministic.

### I added bookmarks on both devices and only one side survived — why?

Classic last-write-wins. The engine arbitrates the whole record or whole snapshot by timestamp, so edits from the device that was offline longer get discarded as stale.

It also explains why this looks "sometimes fine" — as long as both devices were online recently and the interval was short, timestamp order happens to be correct and you never see the problem. The real trigger is long offline stretches.

### My drag-and-drop reorder keeps drifting — why?

Almost certainly unstable sort keys. You need lexicographic ordering so entries can be inserted mid-list, and a deterministic tie-break when two keys collide. Without the tie-break, relative order can change on every sync, which looks random.

The other possibility: the sort key is being treated as an ordinary attribute in the merge, so it gets arbitrated like any other field instead of accumulating stably.

### I have a CRDT, so why is the structure still wrong?

Because a CRDT guarantees "all replicas converge on the same result for the same input set." It does not guarantee the input set is correct.

If node identity is judged wrong — one folder treated as two, or two treated as one — a CRDT will converge very reliably onto a wrong state. This is exactly why we sync by node identity (ID plus `parentId`) rather than by path: identity is a precondition for convergence being meaningful.

### Do conflicts have to be resolved by hand?

Depends on whether you need "no data loss" or "structurally perfect."

No data loss can be fully automatic, guaranteed by the merge semantics. Structural correctness in some scenarios requires a human: if both sides renamed the same folder to two different names, any automatic rule is guessing.

What a CRDT solves is the first. The second you reduce by design — keep the ID on rename instead of creating a new node, so the conflict never arises.

### After getting a new device, which device should it sync from?

From whichever one has the most complete, most correct structure.

Don't let the new device merge against multiple old ones at once — that's all the possible historical states settling the argument a second time. Pick one source and let the rest follow it.