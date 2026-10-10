---
title: How to Tell If a Bookmark Sync Extension Is Actually End-to-End Encrypted
description: "We support end-to-end encryption" carries almost no information — plaintext storage can say it too. Here are seven criteria you can verify yourself, starting with the strongest one: whether the vendor can email you a link to reset your master password.
category: explain
date: 2026-10-07
seoTitle: Is It Really E2EE? A Checklist · BookmarkSync
seoDescription: How do you check whether a bookmark sync extension is genuinely end-to-end encrypted? Seven verifiable criteria: password reset flow, web preview, algorithm disclosure, KDF iteration count, third-party audit, open source, and whether they can send you a reset-your-master-password email.
keywords: how to tell if e2ee is real,end-to-end encryption bookmark sync,is my bookmark sync encrypted,verify e2ee bookmark extension,e2ee checklist,bookmark sync encryption audit,master password reset email,encryption audit
faq: true
---

# How to Tell If a Bookmark Sync Extension Is Actually End-to-End Encrypted

Every bookmark sync extension's page says it supports end-to-end encryption. That sentence carries close to zero information, because plaintext storage can say the same four words. The real differences live in the details of the flow, and most of those you can check yourself. This checklist is ordered by "can I test this without technical background," and the first five need no background at all.

## The decisive one: can they email you a link to reset your master password?

This comes first because it outweighs every other criterion.

Suppose a vendor **can** send you an email with a "reset your master password" link. The mere existence of that link proves at least one thing: **they hold your key, or they can validate it.**

Both are mutually exclusive with end-to-end encryption. Real E2EE requires the server to have ciphertext and no key. Being able to validate your key means the server has something that matches your ciphertext — and that thing is the key, or an equivalent.

So:

| What you can do | What it proves |
|---|---|
| Forget your password, support resets it for you | Server holds or can validate your key → not real E2EE |
| You receive a "reset your master password" email link | Same thing; the link itself is the evidence |
| Forgotten passwords can only be reset, and historical data is lost | Textbook real E2EE behavior |
| Moving to a new device needs only your passphrase, nothing else | The server hosts non-secret parameters, but not the key |

The last row needs a distinction. **"No 44-character key to copy down" does not by itself mean fake E2EE.** The problem with real E2EE is precisely that the key must be held by the user, and hosting the salt and iteration parameters server-side exists to spare users from transcribing a key by hand. It doesn't leak the key.

That's what we do: switching devices takes the same passphrase, the key parameters (the salt) are hosted server-side, and the master key is always derived from your passphrase and never stored by us.

### The direct test

On a second account or a second device, deliberately **discard the passphrase and see whether you can get back in.**

- You get back in and history is intact → the server has the key or an equivalent
- You can't get back in and historical data is unrecoverable → real E2EE

More concretely: register, export a copy of your bookmarks immediately, then wipe the stored credentials, keeping only the browser session. Sign out, and try to regain access without holding any key material. If you succeed, the server can decrypt your data for you.

## Criterion 2: does the web preview ask for a password?

Many services offer a "view your bookmarks in your browser" page. Does that page ask for a password?

- No password, you click and see folder names and URLs → the server can decrypt → not real E2EE
- Password required, or no web preview exists at all → consistent with real E2EE

This criterion is easy to route around: a vendor can say "the preview is end-to-end encrypted and decrypts in your browser." That can be technically true, but it raises the next question:

**The preview page's code is served by the server.** If a decryption key is sent to the browser to decrypt client-side, the server controls that code. You have to assume the vendor could change it to send your plaintext anywhere. That's not paranoia — it's the same trust model you're trying to escape.

So criterion 2 isn't really "does the preview ask for a password." It's **"is there a server-rendered preview at all."** A genuine E2EE product usually doesn't offer one, because that position is inherently untrustworthy.

## Criterion 3: is the algorithm named?

Not naming the algorithm is a clear negative signal.

Cryptography isn't a secret. Mature schemes number in the handful: AES-256-GCM, ChaCha20-Poly1305, XChaCha20-Poly1305. Key derivation is usually PBKDF2 or Argon2. Publishing the name doesn't help an attacker, because the attacker already knows what you're using. The security lives in key length and implementation quality.

Not naming it leaves two possibilities: you're still choosing, or you don't want people verifying. Neither is reassuring.

We use AES-GCM. Worth adding that a 128-bit key is no longer a meaningful defense — that number is now marketing copy rather than a technical parameter.

## Criterion 4: what's the key derivation iteration count?

This is the least examined item and the strongest read on how much thought went into the implementation.

Under client-side encryption, most of the security doesn't come from the cipher — it comes from **stretching a weak secret (the passphrase in your head) into a strong key.** Human passwords carry tens of bits of entropy at most, so brute force is entirely practical. The key derivation function exists to make that cost unacceptable, and the iteration count is the multiplier.

For PBKDF2-SHA256:

| Iterations | What it means |
|---|---|
| 1,000 | Early-2000s default, effectively no protection today |
| 10,000 | Clearly below current recommendations |
| 100,000+ | Reasonable range |
| 600,000+ (OWASP's 2023 recommendation with SHA-256) | Current recommended tier |

Argon2 parameters can't be converted directly into PBKDF2 iteration counts, but the test is the same: **was a number published?** Publishing means it was considered. Not publishing means key derivation was probably written offhand.

One additional consideration: if the vendor hosts KDF parameters server-side (we host the salt for the same reason), those parameters must be **identical on every device**. Otherwise the same passphrase derives a different key everywhere. It's an implicit consistency requirement that's harder to satisfy than it looks.

## Criterion 5: is there a third-party audit?

Saying "we're really E2EE" convinces nobody. The value of a third-party audit is that the auditor gets to see what you'd rather they didn't — server-side code, key handling procedures.

What to check in an audit report isn't "passed." It's **scope**:

| Audit scope | Assessment |
|---|---|
| Client only | The server is still untrusted; limited value |
| Just the crypto functions | Too narrow to say anything about the design |
| Full path, server and client, including key lifecycle | This is the meaningful scope |
| Repeat audits on a schedule | Implementations change; a one-off isn't enough |

Also check who performed it and whether the report is public. An unpublished report halves the audit's value.

## Criterion 6: is it open source?

Open source doesn't guarantee safety — plenty of open projects ship backdoors. What it does guarantee is **verifiability**: you don't have to trust the author, you can look.

This matters especially for E2EE, because the entire value proposition is "you don't have to trust the server." A closed-source server-side encryption story asks you to trust the one party you just declared untrustworthy.

One caveat: **open source doesn't mean the server is open source.** Some products open the client and the protocol while keeping the server closed. That verifies "the client doesn't snoop," not "the server wasn't tampered with." Done properly, the client encryption code and the server data format are both public.

## Criterion 7: what does the server actually hold?

This one needs developer tools and takes ten seconds.

Log in to the vendor's site in your browser and inspect network requests and response payloads. Real E2EE should look close to this shape:

```
{ iv, ciphertext }
```

An IV and ciphertext. No plaintext fields, no filenames, no size statistics.

If you can see folder names, URLs, bookmark titles, or a `folders` array with readable labels, then whatever they call it, the data is readable on the server.

One stricter check: **look for metadata like `size` or `count`.** If the server reports "you have 342 bookmarks," it's counting your data. Under real E2EE the server only knows the byte count.

We use `space_id` as AAD (additional authenticated data). AAD isn't encrypted but is covered by the integrity check, and its job is binding the ciphertext to a specific space: a ciphertext from space A fails verification in space B. That field is visible in transit, but it's an identifier, not content — which is a different thing from "the server sees plaintext." Don't conflate them.

## The seven criteria side by side

| Criterion | Real E2EE | Fake E2EE |
|---|---|---|
| Password reset | Reset only; historical data unrecoverable | Support or an email link can reset it |
| Web preview | No server-rendered preview | Open on click, or password-gated |
| Algorithm named | Stated explicitly | Vague or unmentioned |
| KDF iterations | Published, with rationale | Unmentioned, or clearly too low |
| Third-party audit | Full path including key lifecycle | Partial scope, or report unpublished |
| Open source | Client and server data format public | Marketing page only |
| Server-side data | IV, ciphertext, and uninterpretable metadata only | Plaintext titles, URLs, filenames |

## Chrome native sync as a reference point

Chrome's built-in sync is a useful baseline, because its design goal is convenience, not privacy.

The key fact: **Chrome does not enable end-to-end encryption by default.** Bookmarks and history sit in Google's cloud in plaintext unless you manually set a sync passphrase. Once set, the data is encrypted and Google doesn't participate in decryption.

After setting it, two exceptions matter:

1. **Payment methods are not covered by the sync passphrase.** Card details saved in Chrome are outside that encryption scope.
2. **Addresses aren't protected either.** Your address book is stored and synced in plaintext.

This doesn't make Chrome bad. It keeps the key on your Google account, so Google can technically reach it — cryptographically that's not E2EE. But Chrome does considerably better outside the cryptographic layer: data is encrypted at rest, in transit, and in Google's storage (Google claims encryption at rest), using standard server-side key management.

**These are two different trust models.** Chrome asks you to trust Google's key management. Real E2EE asks you to trust nobody.

The conclusion isn't "Chrome is bad and E2EE is good." Chrome does a lot outside cryptography, while pure E2EE products are often much weaker on usability. The right question is what threat you're defending against:

| What you want to prevent | Reasonable choice |
|---|---|
| Vendor staff snooping, or a breach exposing data | E2EE |
| Your company's IT admin reading your browser data | E2EE |
| Interception in transit | Native sync is enough (TLS + encryption at rest) |
| A vendor handing over your data under legal request | E2EE |
| Fewest features, fewest accounts | Native sync |

If you're just syncing a few thousand bookmarks with nothing sensitive in them, native sync's usability advantage is real. This isn't saying E2EE is the only correct choice — it's saying the phrase "E2EE" carries no information, and the seven criteria above are how you replace the claim with something checkable.

## FAQ

### The vendor offers "forgot password" reset — so it's not really E2EE?

Essentially yes, and this is the strongest criterion on the list.

Being able to reset a password means the server holds a key that decrypts your data, or at least something that can validate yours. That directly conflicts with real E2EE, whose premise is that the server has ciphertext only.

The reverse is also worth stating plainly: "you can only reset your password, and historical data is gone" isn't a design flaw. It's an unavoidable consequence of end-to-end encryption.

### The web preview asks for a password. Is that still end-to-end encrypted?

It depends where the decryption happens.

If the preview runs entirely in your browser — you enter your passphrase, the extension decrypts on your machine, and the page never touches the server — that can be E2EE.

If decryption happens on a server-rendered page, the password or not, ask hard questions: that code is served by the vendor, who could change it. The real test is whether a server-rendered preview exists at all, not whether it prompts for a password.

### Is withholding the cipher name a sign of security?

No.

Publishing the algorithm is normal practice. An attacker already knows what you're using; security comes from key length, implementation quality, and key derivation strength. Naming the cipher lowers nothing.

Not naming it has only two explanations: you haven't chosen yet, or you don't want people verifying. Neither is worth trusting.

### Does a high KDF iteration count make syncing slow?

A little, but you usually won't notice. The key point is that KDF runs when **deriving** the key, not on every sync. After one derivation the key sits in memory, so a high iteration count shows up at sign-in or unlock time — a few seconds — not per sync run.

If syncing *is* slow every time, that may itself be a bug: re-deriving the key on every sync, for instance.

And the cipher's cost is negligible. AES is hardware-accelerated on modern processors, so encrypting a few hundred bookmarks takes milliseconds. What actually affects sync speed is upload bandwidth and concurrency handling, and there's no causal link to encryption. A service that tells you "it's slow because we encrypt" is looking for an excuse.

### Can we audit a tool ourselves?

Auditing the whole codebase isn't realistic, but partial verification is, and it's high value:

- Open developer tools and inspect the server's response shape (ten seconds, criterion 7)
- Test the forgotten-password recovery flow (criterion 1)
- Check whether it's open source and whether an audit report exists (criteria 5 and 6)

Under half an hour total, and it filters out most false claims. Deeper review belongs to a third-party audit firm — but at minimum confirm an audit exists and that its scope covers the server.

### How does your E2EE compare to others?

The technical base is the same: client-side encryption, ciphertext-only server.

A few specific choices: AES-GCM for the cipher, with `space_id` as AAD so ciphertext can't be reused across spaces; key parameters (the salt) hosted server-side so switching devices needs only a passphrase rather than a 44-character key; quota metered in bytes rather than items — not laziness, but the consequence of the only metric an E2EE server can enforce. An encrypted bookmark runs about 2 KB, which is why Free pairs 500 items with 1 MB.

Separately, the auto-organize feature only ever calls move and create, never delete. That limit comes from two data-loss incidents, not from technical constraints.