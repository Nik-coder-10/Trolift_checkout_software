# Environment variables — Trolift platform

Single source of truth for every environment variable the code reads.
`.env.example` lists names only; this document explains them. **No real
values ever appear here or in Git.**

Legend for the environment matrix: **R** = required, **O** = optional,
**—** = must not be set / not used.

| Variable | Public? | Local | Test | Staging | Production | Purpose |
| --- | --- | --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Public | R | R | R | R | Supabase project URL (anon-scoped client). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | R | R | R | R | Anon key; RLS is the real boundary. |
| `NEXT_PUBLIC_SITE_URL` | Public | O | O | R | R | Canonical origin for absolute URLs (metadata, robots). Default `http://localhost:3000`. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | R | R | R | R | Server-only bypass of RLS. `server-only` import guards bundling. |
| `SUPABASE_DB_URL` | **Secret** | O | — | O | O | Direct Postgres URL for `supabase db push` / migration CLI only. Never read by app code. |
| `OWNER_UPI_ID` | **Secret-ish** | R | R | R | **R** | Payee VPA (`user@bank` shape) for payment instructions + QR. Server-only. Presence **and** VPA shape are **readiness-critical in production** — a malformed VPA prints an unpayable QR, so config and `getOwnerUpi()` both fail closed (see below). |
| `OWNER_UPI_PAYEE_NAME` | Public-ish | O | O | O | O | Payee display name in the UPI intent. |
| `PAYMENT_WINDOW_HOURS` | — | O | O | O | O | Displayed "payable within N hours" window. Default 48. Informational only (no auto-cancel). |
| `TROLIFT_STATE_CODE` | — | O | O | R | R* | 2-digit GST home-state code (CBIC list incl. 37 Andhra Pradesh, 38 Ladakh; 97/99 never select a CGST split — IGST by construction). Unset/invalid ⇒ every GST order is IGST (documented, tested fallback — surfaced as a readiness **warning**, never silently defaulted). |
| `TROLIFT_BUSINESS_NAME` | — | R | R | R | **R** | Seller name printed on every tax invoice. **Readiness-critical in production.** |
| `TROLIFT_BUSINESS_ADDRESS` | — | R | R | R | **R** | Seller address on invoices. **Readiness-critical in production.** |
| `TROLIFT_BUSINESS_PHONE` | — | O | O | O | O | Optional invoice field; omitted from PDF when empty. |
| `TROLIFT_BUSINESS_EMAIL` | — | O | O | O | O | Optional invoice field; omitted when empty. |
| `TROLIFT_BUSINESS_GSTIN` | — | O | O | R† | R† | Seller GSTIN (format-checked, display-only — never verified with the government). Empty or malformed ⇒ readiness **warning** (never 503); the value is never echoed. |
| `TROLIFT_INVOICE_PREFIX` | — | O | O | O | O | 2–10 uppercase letters prefixing invoice numbers. Default `INV`. An invalid value is **readiness-critical in production** (issuance would 500 every paid-order download, so `/api/ready` 503s instead — fail-safe, no silent fallback on a financial document). |
| `QUOTATION_VALIDITY_DAYS` | — | O | O | O | O | Quotation validity window in days. Default 7; invalid values fail safe to 7. Frozen into each quotation at issuance. |
| `TROLIFT_DELIVERY_GST_RATE` | — | O | O | O | O | GST percent on the cartage (delivery) line of quotations. Default `18.00`; invalid values fail safe to `18.00` (quoted freight must never silently zero-rate). The order/invoice delivery charge itself stays untaxed. |
| `TROLIFT_DELIVERY_SAC` | — | O | O | O | O | 6-digit SAC for the cartage line; invalid/blank renders the cell blank. |
| `TROLIFT_DELIVERY_LINE_NAME` / `TROLIFT_DELIVERY_LINE_DESC` | — | O | O | O | O | Cartage line copy overrides; defaults match current quotation practice. |
| `TROLIFT_BANK_NAME` / `TROLIFT_BANK_ACCOUNT_NAME` / `TROLIFT_BANK_ACCOUNT_NO` / `TROLIFT_BANK_IFSC` / `TROLIFT_BANK_ACCOUNT_TYPE` | **Secret-ish** | O | O | O | O | Bank block printed on quotations (server-only, display-only). The block is omitted unless the account number is set. Configure via the host secret manager; never commit values. |
| `TROLIFT_SIGNATORY_NAME` / `TROLIFT_SIGNATORY_TITLE` | — | O | O | O | O | Signatory printed on quotations; omitted when the name is blank. |
| `TROLIFT_QUOTATION_TERMS` | — | O | O | O | O | Newline-separated quotation terms override; defaults are the current standard terms. Frozen into each quotation at issuance. |
| `BUSINESS_TIMEZONE` | — | O | O | R | R | IANA zone for business-day boundaries (dashboards/reports). Default `Asia/Kolkata`; an *invalid* name is a readiness warning (would silently shift day boundaries to UTC — not acceptable un-signalled). |
| `RATE_LIMIT_BACKEND` | — | O | O | `memory`† | **R** | `auto` \| `memory` \| `upstash`. Production without Upstash **and** without explicit `memory` ⇒ financial mutations fail closed (429). |
| `UPSTASH_REDIS_REST_URL` | **Secret** | — | — | O | **R** | Shared sliding-window store so all instances enforce one budget. |
| `UPSTASH_REDIS_REST_TOKEN` | **Secret** | — | — | O | **R** | Paired token for the Upstash REST API. |
| `RATE_LIMIT_UPSTREAM_TIMEOUT_MS` | — | O | O | O | O | Shared-store call timeout. Default 1500. |
| `RATE_LIMIT_*_PER_MIN`, `RATE_LIMIT_WINDOW_MS` | — | O | O | O | O | Per-category budgets (orders, claim, session, recover, delivery, import, export, invoice, admin, auth, ready). Defaults live in `lib/rate-limit/index.ts`. |
| `TRUST_PROXY_HEADERS` | — | — | — | O | O | `true` **only** behind a proxy that overwrites `X-Forwarded-For`/`X-Real-IP`. On Vercel, `x-vercel-forwarded-for` is always trusted and this is unnecessary. |

\* Production can run with `TROLIFT_STATE_CODE` unset (IGST for all GST
orders) but readiness will warn until Trolift confirms its home state —
the tax split must never be guessed.

† "Required" for the GSTIN means required for *correct GST paperwork*,
not for readiness: the probe warns (listing `gstin` under
`checks.config.warnings`) whether it is empty or malformed, and stays
green. Do not "fix" the warning by inventing a GSTIN — confirm the
real one with the owner, or record that invoices intentionally omit it.

† Staging E2E runs single-instance against a disposable stack, so
in-process memory is the honest choice there; production mutations fail
closed without a shared store, which is what forces the Upstash choice.

## Staging E2E variables (Playwright, never app runtime)

Consumed only by `playwright.staging.config.ts` / `e2e/staging/*`, and
only when `STAGING_E2E_ENABLED=1`:

| Variable | Public? | Purpose |
| --- | --- | --- |
| `STAGING_E2E_ENABLED` | — | Hard gate: without `=1` the staging suite refuses to run at all. |
| `STAGING_BASE_URL` | — | Origin of the disposable staging stack. Loopback-only guard. |
| `STAGING_SUPABASE_URL` | Public | Staging Supabase URL (loopback-only guard). |
| `STAGING_SUPABASE_ANON_KEY` | Public | Anon key for the staging project. |
| `STAGING_SERVICE_ROLE_KEY` | **Secret** | Staging service-role key for fixture setup/cleanup. Synthetic identities only (`stge2e-*`), never production credentials. |

Guards (verified in config, not convention): any non-loopback
`STAGING_BASE_URL` or Supabase URL throws; the config refuses to run
without the enable flag; synthetic storage objects are namespaced
`STGE2E/` and cleanup deletes only tracked records.

## Fail-safe behaviour (verified in `lib/config/production.ts` + tests)

`/api/ready` runs `verifyProductionConfig()` on every uncached probe:

- **Production + any critical check failing ⇒ HTTP 503.** Critical:
  Supabase credentials, `OWNER_UPI_ID` (presence + `user@bank` shape),
  invoice seller block, invoice prefix shape, shared rate-limit
  backend. Serving money traffic without these produces broken
  payment instructions or un-downloadable invoices — worse than down.
- **Warnings are reported, never fatal**: GSTIN empty/malformed, home
  state unset/invalid, invalid timezone. `/api/ready` lists them under
  `checks.config.warnings` (ids only) on every probe.
- **Outside production nothing here can fail readiness** — dev and
  the hermetic test suite never fight production-only knobs.
- Checks emit **variable names and symptoms only**; values never
  leave the process (unit-tested).

`BUSINESS_TIMEZONE` and `TROLIFT_STATE_CODE` defaults are deliberately
conservative: an unset timezone defaults to Asia/Kolkata (India
business), but an *invalid* one is flagged rather than silently using
UTC day boundaries. An unset/invalid state code means IGST everywhere
— a wider tax, never a narrower one — and is flagged until confirmed.

## Secret handling rules

1. `.env.local`, `.env*.local` are gitignored; only `.env.example`
   (names + comments) is tracked.
2. Server-only secrets are imported behind `server-only`, so a
   client-bundle import is a build error, not a runtime leak.
3. Structured logs redact a fixed key list (tokens, keys, cookies,
   `service_role`, …) — see `lib/observability/logger.ts`.
4. Staging E2E writes browser identities to `e2e/staging/.auth/`
   (gitignored, mode 0600).
5. Never echo secret values in CI logs, docs, or chat. Configure
   production secrets via the host's secret manager (e.g. Vercel
   project settings), not files in Git.
