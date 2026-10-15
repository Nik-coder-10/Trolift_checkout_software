# Release-gate checklist — status, evidence, commands

Audit date: 2026-10-11 (branch `main`). This checklist supersedes the
prose gate summary in `release-readiness.md` for item-level status.
**Overall classification remains `STAGING VERIFIED — PRODUCTION NOT
YET VERIFIED`.** Local checks passing does not make the project
production-ready; the production environment does not exist to verify.

Status legend:

- **PASS** — verified on the current tree, in this session, with the
  command shown.
- **FAIL** — a real defect found; see the note.
- **BLOCKED** — cannot be completed without an external input
  (credentials, business-owner decision) or a dependency not present.
- **NOT RUN** — deliberately not executed (needs production/staging);
  does not imply success.

## A. Locally verifiable gates (no external input)

| # | Gate | Status | Evidence | Exact command |
| --- | --- | --- | --- | --- |
| A1 | Lint | **PASS** | exit 0, 0 errors / 18 warnings | `npm run lint` |
| A2 | Type check | **PASS** | exit 0 | `npm run typecheck` |
| A3 | Unit tests | **PASS** | exit 0 — 38 files, **609/609 passed** | `npm test` |
| A4 | Production build (placeholder public env) | **PASS** | exit 0 | `NEXT_PUBLIC_SITE_URL=https://ci.invalid NEXT_PUBLIC_SUPABASE_URL=https://ci.invalid.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-placeholder npm run build` |
| A5 | Production-deps audit | **PASS** (last run) | 0 production vulnerabilities | `npm audit --omit=dev --audit-level=high` |
| A6 | CI has **no deploy/migrate job** | **PASS** | `ci.yml` jobs: lint, typecheck, unit, build, security, e2e — no deploy | `grep -nE "deploy" .github/workflows/ci.yml` |
| A7 | CI steps cannot mask failures | **PASS** | no `grep/tail/tee` in any `run`; only `npm audit --audit-level=high \|\| true` (informational dev audit, deliberately non-blocking) | `grep -nE "grep\|tee\|tail" .github/workflows/ci.yml` |
| A8 | Old `e2e.yml` removed | **PASS** | file staged deleted, no longer tracked | `git ls-files .github/workflows/e2e.yml` (empty) |
| A9 | Production config validator fails safe | **PASS** | `verifyProductionConfig()` 503s on critical gaps in production; names only, never values | `npx vitest run tests/config-production.test.ts` |
| A10 | Secrets absent from `.env.example` | **PASS** | 32 variable names, 0 values over 8 chars | `grep -E "^[A-Z_]+=.{8,}" .env.example` (no matches) |

## B. Staging-workflow safety gates (task 3)

All four executed this session from the repo root; each **exits 1**
before a browser launches.

| # | Gate | Status | Evidence |
| --- | --- | --- | --- |
| B1 | Refuses without `STAGING_E2E_ENABLED=1` | **PASS** | `Error: [staging-e2e] STAGING_E2E_ENABLED is not 1. Refusing to run.` |
| B2 | Refuses a non-loopback `STAGING_BASE_URL` | **PASS** | `Error: [staging-e2e] STAGING_BASE_URL must be loopback, got https://staging.example.com. Refusing to run (production guard).` |
| B3 | Refuses a non-loopback `STAGING_SUPABASE_URL` | **PASS** | `Error: [staging-e2e] STAGING_SUPABASE_URL must be loopback. Refusing to run (production guard).` |
| B4 | Refuses if a required key is missing | **PASS** | `Error: [staging-e2e] Missing required env var STAGING_SUPABASE_ANON_KEY. Refusing to run.` |
| B5 | `staging-e2e.yml` fails closed on missing secrets | **PASS** | "Require staging secrets" step prints names (never values) and exits non-zero if any of the 4 secrets is empty |
| B6 | `staging-e2e.yml` never runs on push/PR/forks | **PASS** (manual) | trigger is `workflow_dispatch` only; no `push`/`pull_request` |
| B7 | `staging-e2e.yml` runs against an isolated local stack on the runner | **PASS** | Workflow rewritten (Prompt 48): boots disposable Supabase (`start` → `db reset` → `migration up`), verifies migration parity tree-vs-DB, health-checks Kong, smoke-checks the seed, then runs the Playwright staging suite against loopback only. Loopback guards untouched. Every constituent command verified locally this session; full local-stack run exit 0 (see C1). |
| B8 | First green manual dispatch observed on GitHub Actions | **NOT RUN** | Cannot be dispatched from here; needs an operator run after commit. |

Reproduce B1–B4 (one command per case):

```bash
# B1
STAGING_E2E_ENABLED= npx playwright test --config=playwright.staging.config.ts --list
# B2
STAGING_E2E_ENABLED=1 STAGING_BASE_URL=https://staging.example.com \
  STAGING_SUPABASE_URL=http://127.0.0.1:54321 STAGING_SUPABASE_ANON_KEY=x \
  STAGING_SERVICE_ROLE_KEY=y npx playwright test --config=playwright.staging.config.ts --list
# B3
STAGING_E2E_ENABLED=1 STAGING_BASE_URL=http://127.0.0.1:3100 \
  STAGING_SUPABASE_URL=https://prod.supabase.co STAGING_SUPABASE_ANON_KEY=x \
  STAGING_SERVICE_ROLE_KEY=y npx playwright test --config=playwright.staging.config.ts --list
# B4
STAGING_E2E_ENABLED=1 STAGING_BASE_URL=http://127.0.0.1:3100 \
  STAGING_SUPABASE_URL=http://127.0.0.1:54321 STAGING_SUPABASE_ANON_KEY= \
  STAGING_SERVICE_ROLE_KEY=y npx playwright test --config=playwright.staging.config.ts --list
```

### Confirmed gap 1 — staging workflow vs. loopback guard (RESOLVED, Prompt 48)

`playwright.staging.config.ts` requires `STAGING_BASE_URL` **and**
`STAGING_SUPABASE_URL` to be loopback, but the old `staging-e2e.yml`
ran on a GitHub-hosted `ubuntu-latest` runner reading those values
from repository secrets. Fixed by inverting the dependency: the
workflow now boots the disposable stack on the runner itself and
points Playwright at loopback services, so the production guard
holds unchanged. The no-op fork guard is gone (see gap 2); fork
safety now follows from the design (manual dispatch + zero secrets +
disposable local state). Managed (remote) staging runs stay BLOCKED
pending owner secrets and an allowlist review — deliberately not
reintroduced here.

### Confirmed gap 2 — no-op fork guard (RESOLVED, Prompt 48)

`staging-e2e.yml` used `if: github.repository_owner != ''`, which was
always true and guarded nothing. Removed rather than faked: with
manual-dispatch-only triggering, zero secrets, and a disposable local
stack, a fork run can only ever test its own loopback services —
there is nothing to steal and nothing shared to pollute.

## C. Staging-only gates (need a live disposable stack + credentials)

| # | Gate | Status | Evidence / reason |
| --- | --- | --- | --- |
| C1 | Full staging E2E this session | **PASS** (local disposable) | **38 passed / 2 skipped / 0 failed** (desktop + Pixel 7), exit 0. The 2 skips are the pre-existing backend-outage placeholders. Debug probe spec removed from the gate (it asserted nothing). |
| C2 | Backend-outage staging specs | **BLOCKED** | Single `test.skip` in `e2e/staging/4-failure.spec.ts:281` — counted twice across the desktop+mobile projects, which is the "2 skips". Requires real Upstash credentials and/or killing the DB container mid-run. Server-error mapping is unit-covered (`tests/error-handling.test.ts`). |
| C3 | Rate-limit fail-closed behavior end-to-end | **BLOCKED** | Unit-tested (`tests/rate-limit-distributed.test.ts`), not exercised against a real Upstash outage. |
| C4 | Restore drill with transactional data | **PASS** (local disposable) | 2026-10-11: populated fixtures (2 orders, 2 items, 2 payments, 1 invoice, 2 reservations, 3 inventory events, 1 shipment, 10 events, 2 tokens, 2 notes, 1 audit row), backed up with `supabase db dump` and restored into a throwaway `postgres:15-alpine`. Schema restore exit 0, data restore exit 0; `verify.sql` output **identical** on source and target — 18/18 tables counts+md5, all 17 FKs + entity check 0, all financial/operational invariants 0, schema fingerprint identical. **Scope: local disposable PostgreSQL only — managed staging/production recovery NOT tested.** Evidence: `docs/operations/backup-restore.md` §2026-10-11. |

```bash
# C1 (requires a loopback Supabase stack + the 4 STAGING_* vars)
STAGING_E2E_ENABLED=1 STAGING_BASE_URL=http://127.0.0.1:3100 \
  STAGING_SUPABASE_URL=http://127.0.0.1:54321 \
  STAGING_SUPABASE_ANON_KEY=... STAGING_SERVICE_ROLE_KEY=... \
  npm run test:e2e:staging
```

## D. Business-owner / operator inputs (BLOCKED)

None can be invented or approved by an agent.

| # | Item | Status | Needed from owner |
| --- | --- | --- | --- |
| D1 | `TROLIFT_STATE_CODE` (home GST state) | **BLOCKED** | Confirm the 2-digit code. Until then all GST orders compute IGST (wider tax, never narrower) and `/api/ready` warns. |
| D2 | `TROLIFT_BUSINESS_GSTIN` | **BLOCKED** | Confirm the registered GSTIN (or confirm invoices intentionally omit it). |
| D3 | `OWNER_UPI_ID` + `OWNER_UPI_PAYEE_NAME` | **BLOCKED** | Provide the payee VPA; readiness is critical-fail without it. |
| D4 | Invoice seller block (`TROLIFT_BUSINESS_NAME/ADDRESS/PHONE/EMAIL`) | **BLOCKED** | Confirm the real legal identity to print. |
| D5 | RPO/RTO ratification and PITR decision | **BLOCKED** | Accept the free-plan ≤24 h RPO, or buy PITR (≤5 min). |
| D6 | Production secrets configured in host secret manager | **BLOCKED** | No host exists yet. |
| D7 | Release-critical files are untracked — commit them before any gate can run from a fresh checkout | **RESOLVED (verify)** | Commits `1940628` + `d50de05` now track `supabase/config.toml`, migrations `0001–0030`, `playwright.staging.config.ts`, `e2e/staging/`, and both workflows (`git ls-files` confirms; old `e2e.yml` stays deleted). Operator to re-verify from a fresh checkout before relying on it. |

## E. Production-only gates (NOT RUN — environment does not exist)

| # | Gate | Status |
| --- | --- | --- |
| E1 | Provision production Supabase project + host | **NOT RUN** |
| E2 | First `supabase db push` per migrations.md steps 1–7 | **NOT RUN** |
| E3 | Deploy app build to production origin | **NOT RUN** |
| E4 | Run `production-smoke-test.md` in full (incl. controlled test order) | **NOT RUN** |
| E5 | Managed/staging + production restore verification (and platform `auth`/`storage` recovery) | **NOT RUN** | The local disposable fixture drill is done (C4, PASS), but it does **not** prove managed Supabase or production recovery. `profiles→auth.users` is cross-schema; the platform auth-restore path is untested. |
| E6 | `PRODUCTION VERIFIED` classification | **WITHHELD** — by definition unavailable until E1–E5 pass on the production origin |

## F. Known residual risks (accepted or open)

1. **No PITR** — free-plan RPO ≤ 24 h; mitigated by the scheduled
   logical dump in `backup-restore.md`, not eliminated.
2. **`TROLIFT_STATE_CODE` unconfirmed** — invoices wrong for
   same-state customers until D1 lands (IGST fallback, no
   under-collection risk).
3. **Upstash egress latency** on Vercel mutations — acceptable at this
   scale, revisit if checkout p95 matters.
4. **Supply chain** — `npm audit` clean today; no lockfile-signature or
   provenance verification enabled. Related: `staging-e2e.yml` pins
   `supabase/setup-cli@v1` (floating major) and the local CLI (v2.26.0)
   already reports a newer release (v2.120.0); pin the action to a
   full SHA when the workflow is first adopted.
5. **CLI version skew in local-stack setup** — `supabase db reset` on
   CLI v2.26.0 silently caps at a stale newest-migration file (observed:
   stopped at 0028 while 0029 existed). The workflow runs
   `supabase migration up` plus a tree-vs-DB parity check that fails
   the gate on any miss, so this class can no longer pass silently.

## G. Prompt 49 addendum — tax, invoice, readiness hardening (2026-10-11)

Gaps confirmed against the code/SQL this session (all locally
reproducible, no credentials needed):

1. **GST state list wrong** — `lib/tax/india.ts` had `37 = Ladakh`,
   was missing `38`, and used pre-merger UT names. Fixed: 37 Andhra
   Pradesh, 38 Ladakh added, 25/26/28 labelled legacy-or-merged,
   97/99 documented as never selecting a CGST split.
   Tests: `tests/gst.test.ts` (+state-list, +GSTIN/state cross-check).
2. **Seller GSTIN shape unchecked** — `verifyProductionConfig()`
   treated any non-empty GSTIN as fine, so a typo would print on every
   tax document unwarned. Fixed: format-validated warning (never
   echoes the value). Tests: `tests/config-production.test.ts`.
3. **Invoice prefix unchecked** — an invalid `TROLIFT_INVOICE_PREFIX`
   throws at issuance (every paid download 500s) but readiness stayed
   green. Fixed: critical `invoice-prefix` check (503 in production).
4. **UPI shape unchecked** — whitespace or a non-VPA value rendered a
   broken QR. Fixed: trim + `user@bank` shape; `getOwnerUpi()` and
   `buildUpiIntent()` fail closed. Readiness `upi` check covers shape.
5. **Readiness dropped warnings** — the checklist promised "`/api/ready`
   warns" on the home state, but the route returned only critical
   `failing` ids. Fixed: `checks.config.warnings` (ids only) on every
   probe; `configWarnings()` helper, unit-tested.
6. **Invoice builder trusted its caller** — `buildInvoiceData()` would
   render an unpaid order or a treatment/GSTIN mismatch if called
   directly. Fixed: paid-only gate + GST⇔GSTIN coherence checks
   (service gate unchanged). Existing route tests updated where their
   fixtures were incoherent (a GST-taxed invoice with no customer
   GSTIN cannot exist via the order engine).
7. **GSTIN/billing-state mismatch accepted** — a typo'd state with a
   valid GSTIN silently picked the wrong split. Fixed:
   `gstinMatchesBillingState()` enforced in checkout validation and
   `normalizeBillingForm()` (422 server-side). Unit-tested.
8. **Float money parsing on the invoice path** — `toPaise()` used
   `Number × 100`. Fixed: exact decimal→paise parsing, fail-closed.
9. **Invoice numbering reachable by any login** — 0017 granted the
   sequence to `authenticated` and the generator kept its default
   authenticated EXECUTE (the 0028 `revoke from public` pattern does
   not remove it). Fixed by migration `0030` (sequence + generator
   locked to `service_role`).
10. **Tax-split invariant app-only** — CGST+SGST vs IGST exclusivity and
    non-GST zero-tax lived only in `buildInvoiceData()`. Fixed by
    migration `0030` (`orders_tax_split_check`; legacy all-zero rows
    satisfy it). Contract tests added to
    `tests/migration-contract.test.ts`.

Re-verified on the current tree this session: `npm run lint` exit 0
(0 errors / 18 warnings, unchanged), `npm run typecheck` exit 0,
`npm test` exit 0 — **38 files, 621/621 passed** (was 609; +12 new),
production build with placeholder public env exit 0. Nothing
deployed, no migration applied to any database, no secret touched.

Still BLOCKED (owner/staging only, unchanged): D1 home state code,
D2 seller GSTIN value, D3 owner UPI value, D4 seller block values, D5
RPO/RTO + PITR, D6 production secrets/host, C2–C3 Upstash-backed E2E,
E1–E6 production-only gates. In particular: the 0030 SQL is
*reviewed code only* — it must go through migrations.md steps 1–7
(backup-verify → staging migrate → staging smoke → approval → prod
migrate → post-verify) and a managed-staging restore drill before any
production claim.

## H. Prompt 50 addendum — customer-to-admin journey + 0030 verification (2026-10-11)

Tree at start: clean at `d50de05` (Prompt 49 pushed); no staged,
unstaged or untracked changes; old `e2e.yml` stays deleted. All work
below is uncommitted (this prompt forbids committing).

### Test boundary (recorded before running)

- Target: disposable local Supabase stack only (`supabase start` /
  `db reset` / `migration up`), loopback base `http://127.0.0.1:3100`
  and loopback Supabase `http://127.0.0.1:54321`. Guards untouched:
  `STAGING_E2E_ENABLED=1` required, non-loopback base/Supabase URLs
  throw, keys from environment only, synthetic `stge2e-*` /
  `STGE2E` identities with tracked-record-only sweep cleanup,
  Desktop Chrome + Pixel 7, `retries: 0`.
- Seed: `supabase/seed/seed.sql` via `db reset` (path fix from
  Prompt 48 still in place). Auth: fresh per-run admin + plain-user
  identities via Auth Admin API, written to gitignored
  `e2e/staging/.auth/` (0600).
- Migration parity (workflow `staging-e2e.yml` tree-max vs
  `schema_migrations`-max) globs `supabase/migrations/*.sql`, so
  `0030` is covered by construction — confirmed live: tree max
  `0030` = DB max `0030` after the documented
  `reset` → `migration up` sequence.

### Two harness failures that are NOT app evidence

1. First attempt passed empty keys (bad shell extraction) — config
   refused to load (guard working as designed). NOT RUN.
2. Second/third attempts used PowerShell-captured keys truncated by
   console line-wrapping — the app received a partial JWT and every
   catalogue query failed decode (`CompactDecodeError ... got 1`),
   yielding 6 passed / 32 failed. Root cause was the extraction
   method (verified: direct keys return REST 200), not the app. The
   rerun passes keys from an unwrapped process instead. These runs
   are discarded, not counted.

### One real regression found by the journey (FIXED)

Prompt 49's exact decimal→paise parser called `.trim()` on
PostgREST NUMERIC values, which arrive as **JSON numbers**
(`12598.00` → `12598`) on the live stack but as strings in all
mocks — every real invoice download 500'd (`TypeError: e.trim is
not a function`, download canceled in 2-admin + 4-failure invoice
specs, desktop + mobile). Fixed: `toPaise()` accepts
`string | number` (numbers via `toFixed(2)` into the same exact
parse); snapshot interfaces and `parseGstRate`/`lineTaxPaise`/
`rateLabel` widened accordingly. Regression test added
(`invoice-routes.test.ts`: NUMERIC-as-number rows → 200 + `%PDF`).
Full staging suite re-run whole afterwards: **38 passed / 2 skipped
/ 0 failed** (the 2 skips are the pre-existing backend-outage
`test.skip` at `4-failure.spec.ts:281`, counted twice — no new
skips added).

### Journey matrix (all synthetic, disposable stack unless noted)

| # | Scenario | Expected | Actual | Evidence | Env | Status |
| --- | --- | --- | --- | --- | --- | --- |
| J1 | Browse catalogue, product detail, price/stock/delivery | Renders, correct money/availability | Pass | hermetic `catalogue.spec`, staging `1-customer` | mock + disposable | PASS |
| J2 | Cart qty/totals, invalid + over-stock qty | Rejects with item named, creates nothing | Pass | `cart.test`, `checkout.test`, staging `4-failure` (stale cart, price-move repricing) | mock + disposable | PASS |
| J3 | Checkout validation: missing fields, bad pincode, malformed GSTIN, GSTIN/state mismatch | 400/422, no order created | Pass | `gst.test`, `checkout.test`, `api-orders.test` | mock | PASS |
| J4 | Tax math (paise rounding, intra vs inter, totals, frozen snapshots; later edits can't rewrite) | Exact identities hold | Pass | `gst.test`, `pricing.test`, `invoices.test`, staging `1-customer` | mock + disposable | PASS |
| J5 | UPI instructions/intent from test config; no fund movement | Real QR from authoritative total; missing VPA fails loudly | Pass, no money moved | `payments.test` | mock | PASS |
| J6 | Synthetic UTR claim; order stays unpaid until admin verifies | `pending`→`submitted` only; duplicate UTR conflicts; fresh retry works | Pass | `payments.test`, staging `1-customer`/`4-failure` | mock + disposable | PASS |
| J7 | Customer-side paid-marking attempts / unauthorized verify | Denied, no status/invoice/inventory change | Pass | `guest-access.test`, `invoice-routes.test` (409), staging `3-auth` | mock + disposable | PASS |
| J8 | Guest tracking: valid/invalid/expired/revoked/malformed/foreign token; zero-read probes | 404 fail-closed; one credential never opens another order | Pass | `guest-access.test` (incl. zero-DB-read), staging `3-auth` + `4-failure` (expiry, recovery) | mock + disposable | PASS |
| J9 | Invoice before payment (409), after verification (PDF), builder paid-only + GST⇔GSTIN gates | Gate enforced in builder, not just callers | Pass | `invoices.test`, `invoice-routes.test`, staging `2-admin` + `4-failure` delivered-invoice | mock + disposable | PASS |
| J10 | Invoice↔order↔snapshot paise reconciliation | Exact, not visual-only | Pass (unit-exact; browser asserts `%PDF` + totals) | `invoices.test`, `invoice-pdf.test`, staging delivered-invoice | mock + disposable | PASS |
| J11 | Invoice-number allocation vs ordinary users | `anon`/`authenticated` denied (function + sequence, live calls); `service_role` retains | Pass on disposable DB; managed boundary untested | perm probe (`has_*` ×6 + live `SET ROLE` denials ×2, residue 0, no numbers burned) | disposable PG | PASS (local only) |
| J12 | Admin auth: anon + non-admin denied on pages/APIs/mutations | 401/403 before any lookup | Pass | `shipment-auth.test`, `admin-*.test`, staging `3-auth` | mock + disposable | PASS |
| J13 | Admin verify: approve once, reject/duplicates can't double-pay | Guarded transitions, `PAYMENT_VERIFIED` + `ORDER_CONFIRMED` exactly once | Pass | `admin-orders.test`, `invoice-routes.test` (single `INVOICE_ISSUED`), staging `2-admin` | mock + disposable | PASS |
| J14 | Fulfillment transitions (valid/invalid/repeated/out-of-order) | 409 without corruption | Pass | `fulfillment-workflow.test`, `order-events.test`, staging `2-admin` | mock + disposable | PASS |
| J15 | Shipment create/tracking/timeline consistency | Timeline consistent with order state | Pass | `shipments.test`, staging `2-admin`/`4-failure` | mock + disposable | PASS |
| J16 | Admin notes + event scoping; no error-detail leakage | Scoped, authorized; generic customer errors | Pass | `staff-notes.test`, `order-events.test`, `error-handling.test` | mock | PASS |
| J17 | Reservation/release across approve/reject/cancel/retry; idempotency + concurrency | Exactly-once stock moves; duplicate key replays one order | Pass | `inventory.test`, `journey.test`, `api-orders.test`, staging `4-failure` (rapid duplicates → one order) | mock + disposable | PASS |
| J18 | Migration 0030 parity + clean apply | Tree max = DB max; `reset`→`up` green | Pass (live repro of CLI stale-cap: reset stopped at 0029, `up` applied 0030) | workflow parity step + this run | disposable | PASS (local only) |
| J19 | DB tax-split CHECK (mixed split + taxed non_gst rejected; intra/non_gst/IGST accepted) | 5/5 correct, rolled back, residue 0 | Pass | disposable-DB probe `p50_tax_probe.sql` (NOTICEs) | disposable PG | PASS (local only) |
| J20 | Upstash-backed outage E2E (rate-limit fail-closed, backend-outage specs) | Needs real credentials | Not exercised | `4-failure.spec.ts:281` skip (×2) | — | BLOCKED |

### Layer results (exact commands, post-fix tree unless noted)

- `npm run lint` → exit 0, 0 errors / 18 warnings (unchanged).
- `npm run typecheck` → exit 0.
- `npm test -- --run` → exit 0, **38 files, 622/622 passed** (+1 regression test vs §G).
- `npm run build` (placeholder public env per §A4) → exit 0.
- `npm run test:e2e` (hermetic) → exit 0, **56 passed**.
- `npm run test:e2e:staging` (disposable loopback stack) → exit 0, **38 passed / 2 skipped / 0 failed** (2.5 min; skips = J20 placeholders, never passes).
- Targeted SQL probes → all PASS, residue 0, no invoice numbers burned.

### Changes made (uncommitted — this prompt forbids committing)

- `lib/invoices/service.ts`: `toPaise()` accepts PostgREST JSON numbers; snapshot interfaces typed `string | number`.
- `lib/tax/india.ts`: `parseGstRate`/`lineTaxPaise`/`TaxedLineInput` accept numbers.
- `lib/invoices/data.ts`: `InvoiceItemSnapshot`/`InvoiceItem` accept numbers.
- `lib/invoices/pdf.ts`: `rateLabel` accepts numbers.
- `tests/invoice-routes.test.ts`: NUMERIC-as-number regression test.
- `docs/operations/migrations.md`: `0030` inventory row + staging pre-check query.
- This checklist: D7 corrected (0030 committed in `d50de05`), this §H.
- `docs/operations/release-readiness.md`: Prompt 50 note (below).

### Remaining blockers (unchanged classes)

Owner: D1 state code, D2 GSTIN value-or-omit, D3 UPI value, D4
seller block, D5 RPO/RTO+PITR, D6 prod secrets/host. Staging-creds:
J20 Upstash-backed outage paths. Managed: 0030 staging migration
per migrations.md steps 1–7 by an authorized operator (local apply
does NOT approve it), managed restore drill, `staging-e2e.yml` first
green dispatch. Production: all of §E (NOT RUN — no prod exists).

## I. Prompt 51 addendum — managed-staging 0030 gate: BLOCKED before first mutation (2026-10-11)

Tree at start: exactly the 8 uncommitted Prompt 50 files (3 docs +
5 invoice/tax/test files), no untracked files; HEAD `d50de05`
(pushed). Migration `0030` verified byte-identical between HEAD and
worktree. All preserved; nothing discarded, committed, or pushed
(this prompt forbids commit/push without separate authorization).

### Authorization: NOT AVAILABLE — stopped before any managed change

No explicit operator authorization exists in this task context, no
managed staging project is identified (no project ref, no approved
secret store), and no staging connection mechanism is present
(`STAGING_DB_URL`, `SUPABASE_DB_URL`, `PROD_DB_URL`,
`SUPABASE_ACCESS_TOKEN` all ABSENT — names only, never sought as
values). Per the gate rules, **zero managed-environment commands
were executed** — not even a connectivity probe (targets must not
be discovered by trying credentials). No production system was
touched, configured, or probed.

### Read-only review (local files only — no database touched)

- `0030` contents confirmed: (1) revoke generator + FY function
  EXECUTE from `authenticated`, revoke sequence from
  `authenticated`/`anon`, grant sequence usage to `service_role`;
  (2) add `orders_tax_split_check`. Dependencies: columns from
  `0016`, functions/sequence from `0017` — requires history
  `0001–0029` present or the push errors; target must be Supabase
  (`service_role` is a platform role).
- Re-runnable shape (`drop constraint if exists`, idempotent
  REVOKE/GRANT), no data rewrite, no table drop/truncate.
  Rollback is forward-only: a corrective migration (drop CHECK
  and/or re-grant), never history edits.
- Lock note: `ADD CONSTRAINT … CHECK` validates with a table scan
  (trivial at staging size; production will want a low-traffic
  window — not this gate's concern).
- Risk class for staging: LOW, conditional on the pre-check below.

### Operator handoff (ready to execute once authorized)

Missing prerequisites — return these before any run:

1. Explicit authorization naming the **staging project ref** (managed
   staging only — never production, never a personal DB).
2. The documented connection mechanism (`STAGING_DB_URL` via the
   approved secret store) made available to the operator shell.
3. Backup/PITR evidence for the staging project per
   `migrations.md` step 2 (existence AND restorability).
4. Owner sign-off that staging may be mutated in the chosen window.

Then, in order (migrations.md steps 1–7, nothing skipped, no
`db reset` / drops / truncates on managed staging):

```bash
# 1. Inspection (already done locally — re-confirm on the day)
git log --oneline -3  # expect 0030 present in history
# 2. Backup verification (backup-restore.md — must be real evidence, not a tick)
# 3. Read-only pre-checks against STAGING (adapt nothing; must return 0 / 0030-pending):
psql "$STAGING_DB_URL" -tAc "select max(version) from supabase_migrations.schema_migrations;"
psql "$STAGING_DB_URL" -tAc "SELECT count(*) FROM public.orders WHERE (cgst_amount + sgst_amount <> 0 AND igst_amount <> 0) OR (tax_treatment = 'non_gst' AND (cgst_amount <> 0 OR sgst_amount <> 0 OR igst_amount <> 0));"
# 4. Staging migration (documented mechanism only)
supabase db push --db-url "$STAGING_DB_URL"
# 5. Post-verify: history shows 0030 once; re-run the count above (0);
#    has_function_privilege/has_sequence_privilege per role (Prompt 50 local probe as template);
#    /api/ready on the staging app; invoice smoke items.
# 6-7. Record approval + post-migration verification here; Upstash outage specs stay skipped.
```

Stop-and-report triggers: any version mismatch, nonzero
pre-check count, unexpected error, or missing backup evidence — do
not repair staging or edit migration history.

### Workflow dispatch: NOT DISPATCHED (would test the wrong revision)

`staging-e2e.yml` verified: manual `workflow_dispatch` only, zero
secrets, disposable runner-local stack, no deploy/migrate job, no
production path. But it checks out the **committed** revision — the
8 uncommitted Prompt 50 changes (including the invoice NUMERIC-shape
fix the staging suite now depends on) are NOT in `d50de05`. A
dispatch today would run stale code and its invoice specs would fail
for reasons already fixed locally. Dispatch stays blocked until (a)
the 8 files are reviewed, committed, and pushed under a separate
explicit authorization, and (b) the operator confirms the exact
revision and approves the dispatch. Upstash outage specs remain
BLOCKED regardless.

## J. Prompt 53 addendum — remote CI on 21c9335 is RED (pre-existing causes, 2026-10-11)

Push `21c9335` (parent `d50de05`) ran CI run `38172109214`
(`github.com/Nik-coder-10/whatsapp_automation/actions/runs/38172109214`):
**lint / typecheck / security success**; **unit / build / e2e failure**.
The parent `d50de05` run (`38167092887`) shows the **identical**
3-green / 3-red pattern, so none of this is caused by `21c9335`.

Root causes (from check-run annotations + a Linux-container repro of
the build; no code changed, nothing retried):

1. **unit** — `tests/staging-workflow.test.ts:80` reads
   `.env.example` repo-relative, but that file is gitignored and has
   **never been committed** (`git log -- .env.example` empty), so any
   fresh checkout hits ENOENT. Smallest fix: track the names-only
   `.env.example` (operator decision + commit).
2. **build** — `package-lock.json` lists only
   `lightningcss-win32-x64-msvc`; Linux runners install no native
   Tailwind binding and `next build` crashes in seconds (reproduced
   in a local Linux container with the CI placeholder env).
3. **e2e** — hermetic webServer (`npm run dev`) needs the same CSS
   pipeline, so the app never becomes ready → 120 s webServer
   timeout. Same lockfile fix as (2); e.g. regenerate the lock to
   include all platforms and re-verify `npm ci` on Linux.

Consequence: local gates (§A) still pass on this machine, but the
pushed revision is **not CI-green**. Do not dispatch `staging-e2e.yml`
as a release signal until CI is green on the dispatched revision;
do not retry or fix without a separate authorization (fix = new
commit, not a re-run).

## What an agent may NOT do

Do not manufacture credentials, GST/UPI details, test results, or owner
approvals. Do not deploy, apply migrations to production, or delete
databases. Sections C–E stay BLOCKED/NOT RUN until a human supplies
the inputs and authorizes the actions.
