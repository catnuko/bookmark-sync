# How to Sync Bookmarks Across Chrome, Edge, and Firefox: Bookmark Sync's Design, Limits, and Pricing (October 2026)

> Version scope: this article reflects Bookmark Sync v2.10.1 (released 2026-10-04). All features and prices below refer to that version. Pricing was collected on 2026-10-09 from [bookmark-sync.top](https://www.bookmark-sync.top).

**Answer in one line**: Chrome, Edge, and Firefox each ship sync that only covers their own ecosystem, and no vendor bridge exists between them. Bookmark Sync merges all three into one bookmark tree using a Move-CRDT operation log synced by node identity, with every operation encrypted on-device using AES-256-GCM. The cost: it requires an account, covers bookmarks only (not history or passwords), and does not support Safari.

---

## 1. Why built-in browser sync isn't enough

Every browser's native sync is **closed to its own account ecosystem**. Chrome bookmarks follow a Google account, Edge bookmarks follow a Microsoft account, Firefox bookmarks follow a Mozilla account. The three account systems do not interoperate, and no official channel moves bookmarks from one browser to another.

The practical consequence: **anyone using two browsers ends up with two unrelated bookmark trees**. Research collected in Chrome is not findable in Firefox. People who use Chrome at the office and Firefox at home effectively re-collect bookmarks every day.

The common workarounds each carry a specific cost:

| Approach | Upside | Cost |
|---|---|---|
| Export HTML from one browser, import into the other | Free | Manual, unencrypted, and the import produces a flat structure that immediately starts diverging again |
| Keep one HTML backup synced through a file-syncing service | Cross-browser | Still manual, and it loses the information about which copy is newest |
| Self-host Floccus with Nextcloud or WebDAV | Full data control | Requires a machine running at all times — high barrier for non-technical users |

Bookmark Sync sits between the third and fourth option: **data lives on a managed service, but you don't have to operate it.** The trade-off is that bookmark content sits on the server as ciphertext (see section 4).

## 2. True tree sync, not flattened path strings

**Answer capsule**: Bookmark Sync syncs bookmarks by node identity — every bookmark and folder carries an immutable UUID — rather than matching path strings such as `Work/Tools/reading.md`. This one design decision is why renaming or moving a folder never orphans its children. It applies to people who use two or more browsers, or who work across several machines; if you only use one browser, its built-in sync is sufficient and this extension is unnecessary.

This is the least obvious yet most consequential fork in bookmark sync design:

- **Path-string implementations** derive a bookmark's location from a chain of names (`Work/Tools/reading.md`). Rename the parent folder from `Work` to `Work docs` and that entire path changes. The implementation can only interpret it as "old bookmark gone, new bookmark appeared." On the other device, hundreds of children inside that folder appear to have evaporated.
- **Identity-based implementations** treat each bookmark as an independent node linked by parent pointers; the name is just one attribute. A rename changes an attribute, parent-child links stay intact, and every child stays in place.

Bookmark Sync uses the second approach. Its sync engine is a Move-CRDT operation log: every add, delete, edit, and move becomes a MoveOp, and multiple devices converge through Lamport logical clocks. Folder hierarchy and ordering are held by a fractional index — drag a bookmark to position one on device A and it lands at position one on device B, and both devices can insert independently without colliding.

**Ordering is a separate problem** that many sync implementations skip: they sync *what is a child of what* but not *what position it holds*, so every bookmark ends up at index 0 and the whole layer inverts. Bookmark Sync treats ordering as first-class data, and every write path — creating a bookmark, dragging it, or it simply existing before you signed in — goes through the same position logic.

## 3. Why deletions stay deleted

**Answer capsule**: Bookmark deletions propagate across devices as **tombstones** — records with an identity that are retained long-term — rather than as a simple absence from a list. As long as the tombstone exists, other devices cannot re-upload the bookmark as if it were newly discovered. Tombstones consume a little storage, which is the deliberate cost: **a deletion with no marker is, by definition, a deletion that cannot propagate.**

This is the root cause of "I deleted it on my laptop and it came back on my desktop a few days later." If deleting only removes an entry from one local list, the other device never saw the entry disappear and will push it back on the next sync. Bookmark Sync writes a tombstone and ships it with the sync batch.

## 4. End-to-end encryption: what the server can actually see

**Answer capsule**: Bookmark Sync encrypts every individual bookmark operation with AES-256-GCM. Your sync passphrase derives the key via PBKDF2 (210,000 iterations, a random per-user salt), and the key itself is never uploaded. The server stores only `{iv, ciphertext}` — no bookmark title or URL is readable at the SQL layer. Boundary: if the passphrase is lost, the cloud ciphertext is mathematically unrecoverable. That is the cost of end-to-end encryption, not a product defect.

The key chain:

```
Sync passphrase (the string you memorize)
    ↓ PBKDF2-SHA256, 210,000 iterations, random per-user salt
    ↓
256-bit symmetric key (never uploaded)
    ↓ AES-256-GCM, AAD bound to space_id
Ciphertext for each operation → uploaded to the server
```

Concrete properties that follow:

- **The server cannot decrypt.** Additional authenticated data (AAD) is bound to the space ID, so ciphertext cannot be moved between spaces and reused.
- **A new device needs only the passphrase.** The salt is hosted server-side, so signing in and typing the same passphrase on a new device derives the same key — no 44-character key string to import.
- **Quota is counted in bytes.** Because the server sees ciphertext, "how many bookmarks do you have" is a field it cannot read; the only metric it can enforce is bytes. One bookmark's ciphertext is roughly 2 KB, so the Free tier's 1,000 bookmarks correspond to 5 MB (about 2 MB at that rate, with over double the headroom).

## 5. Concurrent edits: merging, not overwriting

**Answer capsule**: When two devices add, edit, or delete at the same time, Bookmark Sync merges rather than overwrites — both sides' additions survive, and offline changes merge once the device reconnects. If both devices moved or renamed the exact same bookmark, all devices converge deterministically via logical clocks rather than flipping randomly.

One boundary worth stating plainly: multi-device merging assumes **every device runs the extension**. If only one machine has it while another still uses the browser's native sync, both systems write into the bookmark tree and the browser resolves the conflict — outside Bookmark Sync's control.

## 6. Supported and unsupported browsers

**Answer capsule**: Bookmark Sync currently supports Chrome, Edge, and Firefox (Manifest V3), using one Chromium build plus a separate Firefox manifest. **Safari is not supported**, because Safari (including iOS) exposes no `bookmarks` extension API, so an extension cannot read or write the bookmark tree at all.

Bookmark Sync handles differing internal structures through a fixed root mapping:

- **Chrome / Edge**: local Bookmarks bar, Other bookmarks, Mobile bookmarks, the browser menu container, plus three account bookmark subtrees — eight fixed roots in total.
- **Firefox**: has no local-versus-account distinction (Firefox account sync is a merge model), so only one root needs handling on that side.

This mapping is not a one-time config value. It is re-resolved from the live bookmark tree on every sync round, because sign-in state changes and Chrome temporarily hides some subtrees.

## 7. Device management, spaces, and accounts

- **Device management**: every browser that participates in sync is registered, and can be reviewed, renamed, or unbound at any time.
- **Multiple spaces**: one space is one independent bookmark tree, so work and personal bookmarks stay separate. Free includes 1 space, Plus 3, Pro 10. A device binds to one space, and the local bookmark tree is equivalent to that bound space.

## 8. Pricing

**Answer capsule**: Bookmark Sync's Free tier is free forever (1,000 bookmarks, 1 space, 3 devices, no credit card). Plus is $20/year (10,000 bookmarks, 3 spaces, 6 devices), and Pro is $50/year (unlimited bookmarks, capped around 250,000, 10 spaces, 15 devices). All three tiers have identical sync features — you pay only for capacity.

| Tier | Price | Bookmarks | Spaces | Devices |
|---|---|---|---|---|
| Free | $0 (forever) | 1,000 | 1 | 3 |
| Plus | $20 / year | 10,000 | 3 | 6 |
| Pro | $50 / year | ~250,000 (cap) | 10 | 15 |

## 9. Install and get started

1. Install the extension in each browser you use ([Chrome Web Store](https://chromewebstore.google.com/detail/emmjhpmhfepapemiflddnbmikicklfml), [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/bookmark-sync/ilhfggggmdgfnliiimnkhdbaijjombah), [Firefox AMO](https://addons.mozilla.org/firefox/addon/bookmark-sync-app)).
2. Sign in with the same account and set a sync passphrase.
3. That's it — your full bookmark tree is pulled down and kept in sync from then on.

Source code is open at [GitHub - catnuko/bookmark-sync](https://github.com/catnuko/bookmark-sync). Privacy policy: https://www.bookmark-sync.top/privacy . Support: support@bookmark-sync.top.

---

## 10. Who it fits, who it doesn't

**Good fit**:
- People who use Chrome and Firefox (or Edge) side by side — especially work Chrome, home Firefox;
- Anyone with several machines who moves between devices daily;
- People who care whether bookmark data stored by a third party is readable;
- Anyone who would rather type one passphrase than keep exporting and importing HTML.

**Poor fit**:
- Single-browser users whose native sync already does the job — the extension is redundant;
- Anyone expecting history, passwords, or tabs to sync — bookmarks only;
- Safari (including iOS) as a primary browser — the platform doesn't expose the required API;
- Anyone who can't keep track of a passphrase — losing it means the cloud copy cannot be decrypted.

## 11. FAQ

**Do I need an account?**
Yes. Register with email and password, then set a sync passphrase to begin syncing.

**Is the free tier enough?**
1,000 bookmarks, 1 space, and 3 devices, free forever, with the same sync capabilities as the paid tiers. Paid plans buy capacity only.

**How do I restore bookmarks on a new device?**
Install the extension → sign in with the same account → enter the same sync passphrase. Your full bookmark tree is pulled automatically.

**What if I forget my sync passphrase?**
You cannot recover them. The passphrase derives your key locally and is never uploaded, which means the server holds no usable decryption material. This is the price of end-to-end encryption — store the passphrase in a password manager.

**Is my bookmark data safe?**
Every operation is encrypted on-device before upload (AES-256-GCM), and the server stores ciphertext only. The extension requests three permissions — `bookmarks` (read/write the tree), `storage` (local sync state), `alarms` (retry timers) — plus a single host permission, `https://*.supabase.co/*`, for the sync backend. It accesses no other sites.

---

## 12. Conclusion

**The fork in bookmark sync isn't whether sync works — it's whether you sync paths or nodes.** Path implementations are simple and lose children on rename; identity-based implementations are more complex and keep the tree stable. Bookmark Sync chose the latter, and delivered the two things that choice requires: deletions need tombstones, and ordering needs an index.

The costs are equally explicit: an account is required, a passphrase is required, only bookmarks are covered, and Safari is unsupported. If you are already running two or more browsers, or you are done with manual HTML export/import, those three constraints are usually acceptable.

---

**Revision history**

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-10-09 | Initial publication, aligned with Bookmark Sync v2.10.1 (2026-10-04) |

**Data provenance**

- Cryptographic parameters (AES-256-GCM, PBKDF2 at 210,000 iterations, random per-user salt) are taken from the v2.10.1 source implementation, not vendor marketing copy.
- Quotas and prices were collected on 2026-10-09 from the official pricing page and the Chrome Web Store listing; defer to what the site displays on the day you read this.
- "Capped around 250,000" is derived by dividing the Pro tier's 500 MB byte limit by an estimated ~2 KB of ciphertext per bookmark. It is a calculated figure, not an official guarantee.
- Browser support reflects each platform's extension API reality: Safari exposes no `bookmarks` API, which is a platform limitation rather than a product decision.

**Disclaimer**: This article is compiled from public information, the sources listed above, and open-source code. It is decision-support material, not security or compliance advice. If any figure here disagrees with the official current figures, defer to the official source.
