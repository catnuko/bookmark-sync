---
title: Common Questions and Troubleshooting
description: Forgot passphrase, restoring on a new device, whether deletes can be recovered, how to read the sync message, the account bookmarks bar folder — plus decryption failures, the menu folder, extensions not updating, and sync not triggering.
category: guide
date: 2026-10-10
seoTitle: BookmarkSync FAQ & Troubleshooting
seoDescription: Common questions and troubleshooting for BookmarkSync: forgotten sync passphrase, restoring on a new device, whether deleted bookmarks can be recovered, reading sync messages, the account bookmarks bar folder, decryption failures, and sync not triggering.
keywords: BookmarkSync FAQ,bookmark sync troubleshooting,forgot sync passphrase,restore bookmarks on new device,recover deleted bookmarks,sync not triggering
---

# Common Questions and Troubleshooting

The most frequent questions and failures from daily use, in one place. The first half is how to use it; the second half is what to do when it breaks.

## Common questions

### What if I forget my sync passphrase?

The passphrase is the only key to decrypt: losing it means the encrypted cloud data can never be decrypted. Save it in a password manager. New versions sync the salt in the cloud, so you only need the same passphrase on a new device.

### How do I restore bookmarks on a new device or after a reinstall?

1. Remember your sync passphrase on the old device;
2. Log in with the same account on the new device;
3. Enter the same passphrase when prompted;
4. Tap Sync Now — bookmarks restore from the cloud, and a default sync space is created automatically.

### Can deleted bookmarks be recovered?

No. Deleting creates a tombstone that syncs to every device; deletion is consistent across devices and is never pulled back from the cloud. Confirm before deleting.

### How do I read the sync-done message?

Messages describe the outcome instead of push or pull counts (those are internal op counts and do not match your bookmark count). First sync done = first upload or cloud restore; Two-way sync done = both sides changed and synced; Up to date = nothing new.

### Can I turn off automatic sync?

Yes. Turn off the auto-sync toggle under Advanced in the options page; sync then only runs when you tap Sync Now.

### Why is there an extra Account Bookmarks Bar folder under Other Bookmarks in Firefox or Edge?

When Chrome is signed into a Google account, it has a separate account bookmarks bar distinct from your local bar. Firefox and Edge have no native place for it, so the extension collects those bookmarks into a same-named Account Bookmarks Bar folder under Other Bookmarks, so you can still see and edit them there. This is by design — not a duplicate and not a bug. The bookmarks inside match exactly what you see in Chrome, and editing on any device syncs everywhere.

### How do bookmarks merge across the three browsers? Will the layout drift?

Each browser lays out its bookmarks bar, other bookmarks, and bookmarks menu differently. The extension maps them onto one consistent set of standard locations: a bookmark you put in Chrome's bookmarks bar lands in Firefox's toolbar and Edge's bar too. Deletes sync as tombstones — remove it on one device and it stays gone everywhere. If two devices change things at the same time, both sets of additions are kept; nothing overwrites the other. The only small difference is the one above: Chrome's account bookmarks bar has no matching root in Firefox or Edge, so it shows up as a folder under Other Bookmarks. Apart from that, structure and order stay consistent across devices.

## Troubleshooting

### Seeing N cloud items failed to decrypt?

It means the sync key does not match the cloud data. Check that you entered the correct sync passphrase, or whether the key changed. Never keep overwriting sync while decryption fails — it can truncate cloud data.

### Deleted the Bookmark Menu folder in Chrome?

That only clears the bookmarks inside (synced to all devices); the folder itself auto-recovers — designed behavior, not a bug. Do not delete it repeatedly; to clear its contents, delete the bookmarks inside.

### Developer-mode extension does not update?

Extensions loaded via Developer Mode do not auto-update: rebuild after code changes and click Reload on the browser's extensions page.

### Sync is not triggering?

Check network and login state. Auto-sync is on by default: local changes push after a roughly 2-second debounce, and a delta pull runs every 30 minutes. You can also tap Sync Now manually.
