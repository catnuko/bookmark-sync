---
title: Firefox Sync Squashed All Your Bookmarks Into One Folder
description: After Firefox sync, 3,000 bookmarks collapse into a single folder and subfolders come back empty. The root cause isn't anything you did — bookmark tree nodes carry no sync provenance, and Firefox Sync uses a merge model.
category: fix
order: 5
seoTitle: Firefox Sync Mangled My Bookmark Tree · BookmarkSync
seoDescription: Firefox sync flattened 3,000 bookmarks into one folder, emptied subfolders on a new laptop, or scattered the tree? The cause is BookmarkTreeNode having no syncing field and no folderType, plus Firefox Sync's merge model. Tests and fixes inside.
keywords: firefox sync messed up bookmarks,bookmarks merged into one folder,firefox sync flattened bookmark tree,firefox subfolders empty after sync,bookmarks all in one folder,firefox bookmark tree broken,mozilla sync hierarchy
faq: true
---

# Firefox Sync Squashed All Your Bookmarks Into One Folder

Firefox finished syncing and several thousand bookmarks collapsed into a flat mess: content from a dozen folders ended up in a single one, subfolders on a brand-new laptop came back as empty shells, or the whole tree got flattened into the root. The same operations don't do this in Chrome. This isn't random corruption — the Mozilla forums are full of threads on the exact same problem. The root cause lives in the data model, not in what you did.

## Match your symptom first

What you see after sync falls into one of three buckets. Knowing which one tells you where to look.

| What you see | Which failure | Immediate cause |
|---|---|---|
| Folders' contents all ended up in one folder | Identity collapse | Two distinct folders were treated as the same node |
| Nothing lost, but everything is flat at the root | Broken parent chain | A child's parent GUID failed to resolve locally, so it fell back to root |
| A subfolder is empty on the new laptop, its bookmarks scattered elsewhere | Hierarchy didn't sync | The folder record itself never landed; only its children did |
| Counts match, positions are all wrong | Reordering was discarded | Sort keys were judged stale during merge and dropped |

The second and fourth rows are the ones people mistake for data loss. Matching counts mean the data is there — only the relationships are wrong. That distinction matters, because it decides whether you're hunting for a recovery path or fixing a structure.

## Root cause 1: tree nodes carry no sync provenance

To understand this you need to know how Firefox represents the bookmark tree in code. The tree you see in the UI has each node represented by `BookmarkTreeNode` in gecko-dev. What it exposes is display-layer attributes: `title`, `uri`, `level`, `index`, `parent`.

What it does not have:

- No `syncing` field. A node has no idea whether it has been synced, which device created it, or which side of a merge it came from.
- No `folderType`. The folder's type isn't on the tree node; you have to reach through `nsIFolder` to get it.

Folder type matters a lot during merges. Toolbar, Bookmarks Menu, Other Bookmarks, and Mobile Bookmarks are distinct types in Firefox with their own storage conventions and display positions. A node carrying its type lets the merge engine pick a compatible landing spot when re-parenting it. A node without one can only be hard-attached along the GUID chain, and when that fails it lands at the root.

There's a second, subtler consequence. Firefox's sync status is **collection-level**, not per-node. The indicator in the status bar describes the result of one sync run for the entire bookmarks collection — not any individual folder. When the merge engine handles a conflicting record, it has nowhere to write "this came from device A, that one from device B, both edited it," so it guesses from timestamps and content.

> This explains something practical: when Firefox sync goes wrong, there's no way to tell from the UI which records were involved. You can only start over wholesale. It's the main reason this class of problem is so hard to diagnose.

## Root cause 2: merge model vs. local/remote split

When a sync engine sees "local and remote disagree," it holds one of two worldviews.

| Dimension | Local/remote split | Merge model |
|---|---|---|
| Data identity | Server assigns a unique tag per record; each client remembers which tags it holds | Records identified by GUID only; both sides share one identity space |
| Remote record, absent locally | Unambiguously "new from the server" → add it | "Missing locally" → suspect local deletion first |
| Decision basis | Is the tag in the local known set | Timestamp, content diff, whether the parent chain resolves |
| Extra local records | Clearly local additions | Might be additions, might be merge residue |
| Structure | Structure ships alongside the items | Structure rebuilt from GUID + parent chain; a break collapses it |
| Concurrent edits | Three-way comparison against base/remote snapshots | Merge + logical clock arbitration |

Firefox Sync is in the right-hand column. That's not a defect — both models work. The difference shows up under heavy structural change. A local/remote split can add remote records unconditionally, because it can tell "added" apart from "deleted." A merge model can't. Once local state is misjudged as "this was supposed to be empty here," the engine treats the incoming structure as redundant data to discard, and nodes get re-parented to the root.

The forum threads about "3,000 bookmarks and the tree got shredded" share a signature: renames, moves, and imports all at once — a large structural edit, then sync. That's the merge model's worst-case input.

## Root cause 3: structure is rebuilt from the parent chain

A bookmark tree's shape is determined entirely by "what does each node's `parentId` point at." On the wire that's a set of ID references; on the way back in, each one must be resolved in order.

The moment one reference fails to resolve, the entire subtree's parentage is dangling. Engineering-wise there are only two options: attach to the root, or attach to a guessed parent. The first is "everything flattened at the root." The second is "everything ended up in one folder."

**"Everything ended up in one folder" usually comes from that second path.** Two folder records get judged as the same node during merge (a GUID conflict or identity collapse), the engine keeps one, and the other's `parentId` changes — so everything under it changes parents too. Not a single bookmark is lost; they just all hang off the same parent now.

That mechanism explains the most confusing part: **why the total count matches perfectly.** What's lost is identity, not data.

## Four tests you can run yourself

No documentation, no support ticket. Four actions separate the failure classes above.

**Test one: count the nodes.** Open the bookmark manager and search the address bar for a term you know exists.

- Total matches pre-sync → no data loss, it's structural. Go to test two.
- Total is clearly lower → data is actually gone. Start with test four.

**Test two: find a folder with children, rename it, sync, and check the children.** If the children vanish, the tool matches identity by path or title rather than by node ID. This one action separates path-string implementations from node-identity ones.

**Test three: take two devices offline, add bookmarks to the same folder on each, then bring both online.** This is the minimal concurrency test.

- Both additions survive → real merge capability
- One side's three bookmarks vanish wholesale → timestamp-overwrite implementation, and you just lost data

**Test four: on a new device, sync and touch nothing locally.** Sign in and let sync finish before importing any HTML.

- Tree is intact → the cloud copy is fine, the merge step is at fault
- Structure is already scrambled here → the cloud copy is scrambled, and your old device was just faithfully reproducing it

Test four carries the most information of the four. It cleanly separates "the stored data is wrong" from "the merge went wrong." Almost nobody runs it, which is why people guess back and forth between the two for months.

## How the options compare in this scenario

| Option | Structure integrity | Concurrency safety | Moving to a new device |
|---|---|---|---|
| Firefox native sync | Structure can collapse after bulk edits | Merge model, unstable under heavy changes | Just sign in — but structure may already be damaged |
| Chrome / Edge native sync | Syncs the whole profile; structure holds up better | Base/remote snapshots plus unique tags | Same vendor only; no cross-browser path |
| Manual HTML export/import | Empty folders and folder-only levels are not preserved | No notion of concurrency | Manual every time, and needs cleanup |
| A tool that syncs node identity | Rename changes `title` only; move changes `parentId` only | Depends on whether it uses a CRDT | Sign in and the whole tree arrives |

One specific note on the third row: HTML bookmark files do not store empty folders or intermediate levels that contain only subfolders. Move your bookmarks across browsers once through HTML and those levels are gone permanently, with no way to restore them by hand, because they were never in the file.

## The order to fix things in

Order matters here. Doing it backwards destroys the last correct copy.

1. **Pause sync on every device immediately.** Otherwise the collapsed structure keeps propagating and a correct copy can get overwritten. This step comes first.
2. **Export an HTML backup** from a device that's still healthy. Ten seconds.
3. **Confirm whether data is actually missing.** Run test one. Matching counts mean it's structural — this is a reordering problem, not a recovery problem.
4. **Repair the structure on one device and make it the source.** Pick the device with the most complete data and treat it as the authoritative copy; everything else syncs from it.
5. **Restore sync only after the repair.** Reversed, you'll keep merging two broken structures into each other.

> If multiple devices already disagree about structure, don't try to merge them. Fix one, then sync the rest one-way from it. Merging two broken structures only produces a third broken structure.

## How BookmarkSync does it

We sync node identity, not paths. Every bookmark carries its own ID and `parentId`; a rename touches `title` only, and a move touches children's `parentId` only. Neither operation changes any node's identity, which makes them the two safest kinds of change under sync.

Ordering travels with the nodes. Every bookmark carries a sort key ordered lexicographically, with a UUID tie-break. Reorder on device A with drag-and-drop and device B follows — no need to resend the whole tree.

Concurrency uses a CRDT with a logical clock, so convergence is deterministic: the same set of inputs yields the same result everywhere. It doesn't win here today and there tomorrow.

Firefox is genuinely one of the messier real-world cases, which is why our automatic organizer only ever calls move and create, never delete. That limit comes from two data-loss incidents, not from a technical impossibility.

## FAQ

### Firefox sync kept the count but scrambled everything — is my data still there?

Yes. What's lost is node identity and parentage, not the data. This is the case most often mistaken for data loss.

The check is direct: open the bookmark manager and search for a term you know is in there. If the count matches, the data is intact and the tree is wrong — which means fixing relationships, not recovering files.

And you usually don't have to reorder anything by hand. If a complete structure still exists in the cloud, signing into a clean device and syncing brings down the correct tree.

### Why does changing the folder name back bring everything back?

Because at the moment of the rename the merge engine failed to recognize the node by GUID and fell back to matching on title. Changing the name back made the title match again.

That's an illusion, not a repair. The real test: at the instant of the rename, did the bookmark's unique identity change? If it did, the tool identifies nodes by title or path, and it will collapse again.

### When sync fails, can you find out which records were involved?

Rarely. Firefox's sync status is collection-level — the indicator reports the result of one run over the whole bookmarks collection, not per record.

The node object carries no sync provenance, so the engine has nowhere to record "this one from A, that one from B, both edited." There's no observable intermediate state, so recovery means starting over. That's the direct cause of the diagnostic difficulty here.

### Is it safer to import HTML on a new device before syncing?

Usually it makes things worse. Two sources get merged first, and structural differences get arbitrated as conflicts instead of being adopted as clean data.

What you want is "import nothing, sign in, sync, wait for it to finish." Then the cloud structure lands as-is and you can see whether it's good or bad. If it's bad, at least you know the problem is in the cloud rather than in the local copy.

### Would a third-party auto-organizer make this worse?

It depends on which APIs it calls. An organizer that only moves and creates cannot lose data — it changes `parentId` and nothing else. Anything that calls a delete API carries real risk, because a deletion that joins the sync stream is no longer a local operation.

If the structure is already damaged, sequence matters: fix the structure first, organize second.

### Can I move the whole tree from Firefox to another browser intact?

Yes, if the other side also consumes node identity. Native Chrome sync is a dead end — it syncs the whole profile and cannot be pulled into a different browser.

One more thing: whatever route you take, manual HTML export can't be the primary method, because empty folders and folder-only levels don't exist in the HTML file. Every export loses them again.