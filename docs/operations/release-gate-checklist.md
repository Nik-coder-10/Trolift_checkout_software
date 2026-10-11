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
| D7 | Release-critical files are untracked — commit them before any gate can run from a fresh checkout | **RESOLVED (verify)** | Consolidation commit `1940628` now tracks `supabase/config.toml`, migrations `0001–0029`, `playwright.staging.config.ts`, `e2e/staging/`, and both workflows (`git ls-files` confirms; `git status` clean; old `e2e.yml` stays deleted). Operator to re-verify from a fresh checkout before relying on it. New migration `0030` (Prompt 49) is *uncommitted local work* until reviewed and committed — same rule applies. |

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

## What an agent may NOT do

Do not manufacture credentials, GST/UPI details, test results, or owner
approvals. Do not deploy, apply migrations to production, or delete
databases. Sections C–E stay BLOCKED/NOT RUN until a human supplies
the inputs and authorizes the actions.
