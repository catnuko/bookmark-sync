---
title: Bookmark Sync Not Working: A Troubleshooting Checklist in Order
description: Sync does nothing, the status stays on scheduled, or it works half the time. This is a runbook, not a list of causes: check status meaning first, then account, then quota and rate limits, and only then touch local data.
category: fix
date: 2026-10-02
seoTitle: Bookmark Sync Not Working · BookmarkSync
seoDescription: Bookmark sync does nothing, stuck on scheduled, or fails intermittently? Key causes include rate_limited responses causing intermittent failures and the Free tier's 1,000-item limit and 5MB byte quota. Ordered steps and error code tables.
keywords: bookmark sync not working,sync stuck scheduled,bookmarks not syncing,bookmark sync troubleshooting,rate limited sync,bookmark sync quota exceeded,e2ee sync error code,bookmark sync failed
faq: true
---

# Bookmark Sync Not Working: A Troubleshooting Checklist in Order

You click sync and nothing happens. The status bar sits on scheduled forever. Or it works some days and not others. This page doesn't list possible causes — it gives you an execution order. Each step has a clear pass condition. Move on only after it passes, because skipping steps sends you down the wrong path for a long time.

## Step 1: work out which kind of "not working" this is

"Bringing sync not working" covers at least four unrelated situations. Skipping this distinction makes everything after it guesswork.

| Symptom | Category | Which step applies |
|---|---|---|
| Status stuck on scheduled, never starts | Scheduler never fires | Step 3 |
| Status runs, but the cloud count doesn't move | Upload failing | Step 4 |
| Cloud has changes, local doesn't | Download failing, or local conflict wins | Step 5 |
| Local changes upload then keep falling back | Uploads succeed, then get overwritten | Step 6 |
| Needs a manual click to work at all | Interval or rate limiting | Steps 3 and 7 |

One thing separates upload from download: **on one device, add 3 test bookmarks, wait for sync to complete, then check the count in the web dashboard.** That halves the problem space before you start.

> Don't use bookmarks you actually care about. Add three entries named `sync-test-1`, `sync-test-2`, `sync-test-3`, then delete them together when done. Their presence doesn't affect sync logic.

## Step 2: rule out the account layer

This step looks trivial and is the single most common failure.

Check these in order; each takes under ten seconds:

1. **Is the extension signed in at all?** Login state is usually bound to the browser profile. A new profile, an incognito window, or a reinstall all require signing in again. When signed out, sync never queues.
2. **Is it the same account?** Sign-in paths (email, one-time code, third-party OAuth) can produce different space IDs for the same address. What you think is one browser across devices can be two spaces syncing independently.
3. **Are requests being blocked?** Sync requests need to get out. Extension permission policies, a blocker extension, corporate TLS inspection, or a proxy requiring authentication all cause silent failures. Check: open the extension's developer console and look for timeouts or TLS errors.
4. **Is the system clock accurate?** Sync protocols generally depend on timestamps for freshness. Large clock skew can cause the server to reject uploads outright, and the error message is rarely helpful. Easiest step to skip, and skipping it costs hours.

## Step 3: what "scheduled" actually means

`scheduled` is not an error. It means the sync task is queued but hasn't been triggered. The engine is waiting on a condition — usually an interval, or a debounce window so that editing one bookmark doesn't trigger a sync.

So a status stuck on scheduled is a scheduling problem, not a network or account problem. Three possibilities:

| Possible cause | How to confirm | What to do |
|---|---|---|
| Long sync interval | Check the interval in settings; measure the real delay between edits and automatic runs | Trigger manually, then wait out the interval |
| Long debounce window | Edit a bookmark and watch how long before it starts | Same; usually tens of seconds to a few minutes |
| Browser throttling background tabs | Switch to another tab and see whether it starts | Keep the tab in the foreground |

**If it syncs immediately in the foreground**, background throttling is the cause and nothing is broken. Browsers slow or pause timers aggressively in tabs they classify as background. This is standard browser behavior, not something every extension can work around.

**If it doesn't move in the foreground either**, go check for an auto-sync toggle in settings. Don't skip this one — a disabled auto-sync switch is more common than rate limiting and quota problems combined.

## Step 4: check the quota — the most misdiagnosed cause

This deserves its own section because exceeding quota doesn't always produce an error. Some implementations stop uploading silently, and the symptom is "sync does nothing" — indistinguishable from being offline.

The counterintuitive part: **quota is counted in bytes, not items.**

| Tier | Item limit | Byte limit |
|---|---|---|
| Free | 1,000 items | 5 MB |
| Plus | 10,000 items | 20 MB |
| Pro | Unlimited items (engineered to cap around 250,000) | 500 MB |

Why bytes? Under end-to-end encryption the server holds ciphertext. **The only metering metric the server can enforce is bytes** — there's no item count in the ciphertext, so the server has no way to know how many bookmarks you have.

That design produces a concrete number: **an encrypted bookmark averages about 2 KB.** Do the arithmetic and you see what 5 MB actually buys on Free.

- 1,000 × 2 KB ≈ 2 MB. Free gives you 5 MB — over twice that — so a typical bookmark (~0.5 KB) goes a lot further, and even large ones fit 1,000.
- So why do people hit the ceiling below 1,000 items? Because record size isn't fixed. A bookmark with a long title, a long URL, and deep folder nesting runs noticeably larger. One bookmark with all three can be three or four times a typical one.
- Symmetrically, Pro's 500 MB works out to roughly 250,000 items at 2 KB — which is where the "around 250,000" figure comes from.

**Confirming whether you've hit the ceiling:**

1. Check the actual byte usage in the web dashboard, if it reports one
2. Trigger a manual sync, open the developer console, and look for an explicit quota error in the response
3. Estimate: item count × 2 KB, compared against your tier's byte limit

If the dashboard doesn't show bytes, use step 3. Once your estimate passes 90% of the ceiling, treat it as exceeded.

## Step 5: uploads are failing and the error is being swallowed

Open the developer console and inspect the sync request's response. With encryption on, the server stores data in this shape:

```
{ iv, ciphertext }
```

If the response carries a `reason` field, that's your failure cause. **The one value to know is `rate_limited`.**

Rate limiting is the server protecting itself: too many requests in a short window, or a body that's too large, gets refused with a reason attached.

The symptom worth memorizing is that **it's intermittent.** Wait a bit and a manual sync may succeed, then fail again. So if you see "sometimes it works," suspect rate limiting before you suspect data corruption.

| Response | Meaning | Direction |
|---|---|---|
| `reason: 'rate_limited'` | Server-side rate limiting | Sync less often; wait for the window |
| An explicit quota error code | Byte or item limit exceeded | Upgrade tier, or delete some bookmarks |
| An auth error code | Login state expired | Sign in again, then sync |
| No response or a timeout | Network layer blocked | Back to step 2, item 3 |

> Worth keeping straight: rate limiting is a **rate** problem (too many requests per unit time); quota is a **total** problem (cumulative usage too large). Rate limiting clears on its own. Quota never clears on its own. Mixing them up costs a long wait for nothing.

## Step 6: error codes

The browser side reports codes like `E034` and `E030`. They're client-side error identifiers and their meanings are defined per implementation — check that extension's documentation. Numbering isn't portable across vendors.

Before you look anything up, there's a useful split to establish: **does this happen before or after the request goes out?**

- Before the request (local encryption, key derivation, storage reads) → local problem; check login state and local data
- After the request (a response arrived but was judged a failure) → server or network; use the table in step 5

That split saves a lot of blind guessing. What a specific `E0xx` number maps to varies by vendor — don't copy another product's interpretation.

## Step 7: the AAD binding layer and intermittent failures

This one is more technical, but it's a common source of "it works sometimes," so it gets its own section.

In end-to-end encryption, AAD (additional authenticated data) is data that is **not encrypted but is covered by the integrity check**. Its job is binding the ciphertext to its context: take a ciphertext from space A into space B and verification fails outright.

We use `space_id` as AAD. The effects:

- A ciphertext from one space cannot be decrypted in another
- Tampering with the space association fails decryption rather than silently returning garbage

This layer produces an operational consequence people need to know about: **a space association mismatch shows up as intermittent sync failure, not as a clear error.**

If you've manually switched spaces, imported someone else's space data, or mixed multiple accounts' extension data in one browser profile, this can happen. To confirm: sign out, clear the extension's local storage, sign back into the same account, then sync.

## Before you touch local data

None of the first seven steps requires destroying anything. If all seven pass and the problem persists, do these two things before you start making changes:

1. **Export an HTML backup** from whichever device is in the best state. Ten seconds.
2. **Record the current state.** Item count and folder count per device, plus the timestamp of the last successful sync. You'll need these numbers to know whether you actually fixed it.

**What not to do:**

- Don't hit "reset sync" on multiple devices at once. It overwrites other devices with an unverified state.
- Don't delete your browser's bookmarks directory or the whole browser profile. It's irreversible and it makes the local state undiagnosable — afterwards you can't tell whether the problem is sync or something you deleted.
- Don't start by clearing caches. It usually doesn't clear cloud state, doesn't fix anything, and it destroys the evidence you'd need.
- Don't treat uninstall and reinstall as step one. Reinstalling loses your local bookmarks, and if the cloud copy was already wrong you'll just see the same wrong data copied back.

## How BookmarkSync does it

Encryption is on by default. The server stores `{ iv, ciphertext }` with `space_id` as AAD. Between the data on our server and the data on your machine sits AES-GCM, and the server has no plaintext — which is exactly why quota has to be metered in bytes: it cannot count your records.

Sync status is collection-level. The bookmark set either syncs successfully or it doesn't; there is no intermediate state where "a few bookmarks silently didn't sync." That's useful when debugging — when something fails you know the whole batch didn't move, rather than guessing which items went missing.

Rate limiting returns an explicit `reason: 'rate_limited'` instead of failing silently, so you can tell "wait" apart from "change something."

## FAQ

### The status says scheduled — is sync broken?

Not necessarily. `scheduled` means the task is queued but untriggered, usually waiting on an interval or a debounce window.

First check whether the browser considers the tab background. Timers in background tabs get slowed or paused heavily, and switching the tab to the foreground often starts the sync immediately. If it still doesn't move in the foreground, confirm the auto-sync switch is on in settings.

### Sync works half the time — is it a network problem?

Not necessarily. Check for rate limiting first.

The server returns `reason: 'rate_limited'`, and the signature is intermittency: wait a while and a manual sync may succeed. Rate limiting is a rate problem that clears on its own; quota is a cumulative problem that never clears. Confusing the two means waiting a long time for nothing.

Open the extension's developer console and read the sync response to tell them apart directly.

### Free allows 1,000 items — why does sync stop below 500?

Because quota is metered in bytes, not items.

Under end-to-end encryption the server holds ciphertext, and bytes are the only metric it can enforce — there's no item count in the ciphertext. Free is 5 MB, which at ~2 KB per encrypted bookmark works out to roughly 2,500 items; if your bookmarks run large (long titles, long URLs, deep nesting), 5 MB can run out before 1,000.

But record size isn't fixed. Long titles, long URLs, and deep nesting run noticeably larger — three or four times a typical entry. That's how you hit the ceiling under 1,000 items.

### The dashboard doesn't show how many bytes I'm using — how do I check?

Estimate: item count times 2 KB, against your tier's byte limit. Free is 5 MB, Plus 20 MB, Pro 500 MB.

Once your estimate exceeds 90% of the ceiling, treat it as exceeded. You can also open the developer console during a manual sync and look for an explicit quota error code — either route confirms it.

### What do error codes E034 and E030 mean?

These are client-side identifiers and each implementation defines them differently. Check that extension's docs rather than copying another vendor's explanation.

Before you look them up, establish whether the error happens before or after the request leaves. Before means local (encryption, keys, storage); after means server or network, and the step 5 table applies. That split saves a lot of blind guessing.

### Sync is completely dead — can I uninstall and reinstall?

As a last resort, but not as the first diagnostic step.

Reinstalling loses your local bookmarks. If the cloud state was already wrong, reinstalling just shows you the same wrong data copied back and makes the problem look worse.

Correct order: run all seven steps, and only consider a reinstall if none of them resolve it. Export an HTML backup first.

If clearing the extension's local storage fixes it — which covers a lost login state or a destroyed encryption key — prefer that. It doesn't cost you your bookmarks, which reinstalling does.