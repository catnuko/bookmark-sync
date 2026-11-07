# Self-hosting bookmark-sync

bookmark-sync is end-to-end encrypted, so you can run the whole backend yourself: the extension talks to Supabase (Postgres + Auth), and this repository contains everything the backend needs — database migrations and, optionally, the billing edge functions.

After self-hosting you have a fully working sync service under your own Supabase project. What you do **not** get is the hosted service's billing: the Creem subscription/checkout integration belongs to the hosted deployment and its Creem account, so self-hosted instances cannot use it (see [Billing functions (optional)](#billing-functions-optional)).

## 1. Create a Supabase project

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard) (any region close to your users).
2. Note the **Project URL** and the **anon/publishable key** (Project Settings → API). You will need both in step 3. The anon key is a public, client-side key — it is safe to embed in the extension, Row Level Security does the real access control.

## 2. Apply the database migrations

All schema lives in [`supabase/migrations/`](../supabase/migrations/) as numbered SQL files. Apply them **in filename order**. Two ways:

**Option A — Supabase CLI (recommended):**

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

**Option B — SQL Editor:** open the SQL Editor in the Supabase dashboard and paste/execute each migration file in order (0001 → …). They are written to be applied top-to-bottom.

The migrations create the `bsync_*` tables (op log, profiles, devices, subscriptions/orders, error reports, …), the RPCs, and the Row Level Security policies.

Auth setup: in **Authentication → Providers → Email**, turn off **"Confirm email"** if you want instant sign-up without email verification (this is how the hosted service runs). Enabling email confirmation also works — the extension just requires users to verify before first sync.

## 3. Build the extension against your project

The extension reads its Supabase endpoint from two constants at the top of [`src/lib/supabase.ts`](../src/lib/supabase.ts):

```ts
export const SUPABASE_URL = 'https://<project-ref>.supabase.co';
export const SUPABASE_ANON_KEY = '<anon-or-publishable-key>';
```

Replace both values with your own project's, then build:

```bash
pnpm install
pnpm build            # Chromium build -> extension/
pnpm build:firefox    # Firefox build -> extension-firefox/
```

Load the result in your browser (see the [README](../README.md#development)) and sign up in the options page.

> Note: `vite.config.js` also supports a `__DEV_CREDS__` injection from an untracked `.dev-creds.json` — that is a local development convenience (pre-filling the login form) and has nothing to do with backend configuration. Never commit that file.

## 4. Billing functions (optional)

The three edge functions in [`supabase/functions/`](../supabase/functions/) implement the hosted service's paid plans (checkout, self-service portal, and webhook for Creem):

- `bsync-creem-checkout` — creates a Creem checkout session for an upgrade
- `bsync-creem-portal` — returns the customer portal URL
- `bsync-creem-webhook` — receives Creem webhooks and grants/revokes plans

**You only need these if you want to run your own paid tiers with your own Creem account.** If you skip them, everything else still works — free quotas and sync are unaffected; there is simply no upgrade path in the extension UI (the buttons will not be able to reach a working checkout).

To deploy them for your own Creem account:

```bash
supabase functions deploy bsync-creem-checkout
supabase functions deploy bsync-creem-portal
supabase functions deploy bsync-creem-webhook
```

and set their secrets (`supabase secrets set ...`):

| Secret | Purpose |
| --- | --- |
| `CREEM_API_KEY` | Your Creem API key |
| `CREEM_WEBHOOK_SECRET` | Webhook signing secret from Creem |
| `CREEM_PRODUCT_PLUS` / `CREEM_PRODUCT_PRO` | Your Creem product IDs for the Plus and Pro tiers |
| `CREEM_SUCCESS_URL` | Where to send users after a successful checkout |
| `CREEM_API_BASE` | Optional; defaults to `https://api.creem.io` |
| `SUPABASE_URL` / `SERVICE_ROLE_KEY` | Set automatically by the Supabase CLI / platform |

The extension-side plan display (`PlanCard`, `QuotaCard`, upgrade modal) reads your plan from `bsync_profiles`; if no billing functions exist it simply shows the free quota.

## 5. Quotas

Per-account quotas live in `bsync_profiles`: `plan` (`free` / `plus` / `pro` / `lifetime`) and `quota_bytes`. The free tier defaults are set by migration `0048` (1,000 items / 5 MiB). On a self-hosted instance you are the admin: adjust `quota_bytes` (or grant plans) with SQL directly, e.g.

```sql
update public.bsync_profiles set quota_bytes = 52428800 where user_id = '<uuid>';
```

## 6. Telemetry and error reports

The extension reports sync errors (metadata only — never bookmark content, see [docs/PRIVACY.md](PRIVACY.md)) to the `bsync_error_reports` table via RPC. On a self-hosted instance these reports land in **your** database and stay there; nothing is forwarded anywhere else. If you don't want them, you can revoke the RPC or ignore the table.

## What is *not* part of self-hosting

- The Creem subscription of the hosted service (its product IDs, customers and webhooks belong to it).
- The hosted service's account data — a self-hosted project starts empty; the extension does not migrate accounts between Supabase projects.
