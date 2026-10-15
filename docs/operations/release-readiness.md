# Release readiness report — 2026-10-10

Scope: production deployment, backup & recovery gate (Prompt 45).
Verification of Prompts 41–44 outcomes is included where they feed
the release decision.

## Classification

> **STAGING VERIFIED — PRODUCTION NOT YET VERIFIED**

Staging E2E passes end-to-end (customer + admin journeys, desktop +
mobile, real Postgres). No production project has been provisioned,
deployed, or smoke-tested, so `PRODUCTION VERIFIED` is not available
by definition. `READY WITH KNOWN RISKS` is not used either: the
production environment itself — its Supabase project, host, secrets,
DNS — does not yet exist to be verified.

## 1. Implemented safeguards (this gate)

- **Fail-safe production configuration** — new
  `lib/config/production.ts`, wired into `GET /api/ready`: in
  production, missing `OWNER_UPI_ID`, invoice seller block or Supabase
  credentials returns **503** with
  variable *names* only (values never leave the process; unit-tested
  for leakage). Tax/timezone misconfiguration, and a missing shared
  rate-limit store (budgets then fall back to per-instance memory), are
  surfaced as warnings: an invalid `TROLIFT_STATE_CODE` is treated as unset
  (IGST everywhere — never a narrower split), an invalid
  `BUSINESS_TIMEZONE` is flagged rather than silently shifting day
  boundaries to UTC. 8 new unit tests (609 total, all passing).
- **Environment separation documented** —
  `docs/operations/environment-variables.md`: every variable read by
  the code, public/secret classification, and a local/test/staging/
  production requirement matrix; `.env.example` updated to match and
  cross-reference it.
- **CI/CD** — `.github/workflows/e2e.yml` replaced by `ci.yml`:
  six parallel jobs (lint, typecheck, unit, production build with
  placeholder public env, `npm audit --omit=dev --audit-level=high`
  security gate, hermetic Playwright). No step pipes through log
  filters; every `run` inherits Actions' `bash -eo pipefail`. **No
  deploy job exists** — deployment stays a manual, authorized act.
  New `staging-e2e.yml`: manual `workflow_dispatch` only, fails closed
  (names, not values) if any staging secret is absent, never runs on
  push/PR/forks, uploads traces on failure.
- **Rate-limit coverage completed (Prompt 48)** — every API route
  except the liveness probe now enforces a budget (`denyIfLimited`;
  statically asserted in `tests/staging-workflow.test.ts`, which fails
  if any route handler lacks one). Previously unguarded admin
  mutations/lookups (order status, fulfillment, payment verification,
  shipments, products, delivery config, notes, order/customer detail)
  share the generous `admin` bucket; admin sign-in has a dedicated
  tight `auth` bucket (fail-closed) wired through `next/headers`
  since server actions receive no `Request`. `supabase/seed/seed.sql`
  path fixed in `supabase/config.toml` (was pointing at a nonexistent
  `./seed.sql`, silently skipping seeding on reset).
- **Migration release gate** — `docs/operations/migrations.md`: the
  7-step process (inspect → backup-verify → staging migrate → staging
  smoke → prod approval → prod migrate → post-verify), an honest
  forward-only recovery policy (corrective forward migrations or
  PITR; no pretend rollbacks), the additive-first rule for what makes
  a code rollback safe, and a per-migration risky-change inventory
  audited from the actual SQL files (0009, 0012, 0016, 0017, 0018,
  0019, 0021, 0029) with recovery strategies.
- **Backup & restore** — `docs/operations/backup-restore.md`: data
  inventory (DB, images, config), RPO/RTO targets (≤5 min with PITR,
  ≤24 h without), the free-plan reality (daily backups, no PITR), a
  scheduled logical-dump second copy, and a full restore procedure.

## 2. Verified CI checks (all on the final tree, real exit codes)

| Check | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0 — **609/609 passed** |
| `npm run build` | exit 0 |
| `npm run test:e2e` (hermetic) | exit 0 — **56/56 passed** |
| `npm audit --omit=dev` | 0 vulnerabilities (production deps) |

## 3. Migration status

29 forward-only migrations (0001–0029). All are applied on the
local/staging stack the E2E suite exercises. No production database
exists yet; the first production migration is `supabase db push` of
the full set, which must follow migrations.md steps 1–7 including a
verified restore point. Special-care list in migrations.md; the two
irreversible ones (0009 drop-table; the NOT NULL tightenings in
0017/0021) have documented pre-checks.

## 4. Staging results

`npm run test:e2e:staging` against the disposable loopback stack:
**38 passed / 2 skipped / 0 failed** on Desktop Chrome and Pixel 7.
Customer journey (16 steps incl. real `%PDF` invoice download), admin
journey (10 steps), authorization matrix, failure/retry paths. The 2
skips are the backend-outage scenarios that require real Upstash
credentials — reported as blocked, never as passes. Loopback-only
guards, per-run synthetic identities (`stge2e-*`), tracked-record-only
cleanup: verified by construction. (An earlier 40/40 count included a
now-removed assertion-free probe spec.)

## 5. Backup/restore drill — 2026-10-11, transactional fixtures, PASS

**Scope: local disposable PostgreSQL restore only.** The earlier
drill (2026-10-10) proved the restore *mechanics* but on empty
transactional tables. This drill first populated the disposable
source with realistic synthetic business data
(`scripts/backup-restore/fixtures.sql`: 2 orders, 2 items, 2 payments,
1 invoice, 2 reservations, 3 inventory events, 1 shipment, 10 order
events, 2 tokens, 2 notes, 1 audit row), then backed it up with the
documented procedure and restored it into a throwaway
`postgres:15-alpine` container.

Results: schema restore **exit 0** (18 tables), data restore **exit 0**,
and the identical read-only `verify.sql` run on both source and target
**diffed to zero lines** — all 18 tables' counts+md5 checksums match,
all 17 foreign keys plus the `staff_notes` entity check are 0
violations, every financial/operational invariant is 0 (order-total
identity, line-total math, invoice-vs-order totals, paid⇒verified
payment, reservation consistency, shipment/event consistency), and the
schema-object fingerprint is identical (indexes 83, checks 86, FKs 17,
triggers 13, functions 51, RLS tables 18, policies 22, grants 497, and
a definition hash). Full record, exact commands and the runbook fixes
(pg_graphql/platform-schema requirements, `--data-only -s public`,
Supabase image not runnable standalone) are in
[backup-restore.md](backup-restore.md).

Container removed and verified gone; fixtures deleted from the source
and counts returned to the pre-drill baseline.

**Explicitly NOT proven by this drill:** managed Supabase staging
recovery and production backup/restore. `profiles → auth.users` is
cross-schema (`auth` is platform-managed and excluded from the
`public` data dump); seeding the 20 auth ids simulated the platform's
auth restore and cleared it, but the real platform auth-recovery path
is untested. Do not raise the release classification on this drill.

## 6. Monitoring status

- `/api/health` (liveness) and `/api/ready` (DB + config readiness,
  503 in production on critical failures) verified live.
- Structured JSON logs with automatic severity, request correlation
  ids, and a fixed redaction list.
- `docs/operations/monitoring.md` maps every requested failure class
  (order creation, DB, payment verification, invoice, rate-limit
  backend, migrations, API error spikes) to a concrete alertable log
  signal, plus free-tier wiring (external uptime check on
  `/api/ready`, log-error-rate alert).
- **`ADMIN_ALERT_EMAIL` removed** from `.env.example`: it was
  documented but never read by any code; a dead knob invites false
  confidence that alerts are being sent. Rationale and the
  log-signature-based replacement documented in monitoring.md.

## 7. Missing environment configuration (production blockers)

No production project exists; before one goes live the operator must
provide (all names in environment-variables.md): production Supabase
project + keys, `OWNER_UPI_ID` (and payee name), invoice seller
block (`TROLIFT_BUSINESS_NAME/ADDRESS`, GSTIN once confirmed),
`TROLIFT_STATE_CODE` once Trolift confirms its home state, Upstash
REST URL/token (or a conscious single-instance `RATE_LIMIT_BACKEND=
memory`), `NEXT_PUBLIC_SITE_URL` = production origin, and host secret
management. `/api/ready` fails 503 until the critical ones are set —
by design.

## 8. Unresolved security risks

1. **TROLIFT_STATE_CODE unconfirmed** — GST orders currently compute
   IGST for everything. Wider tax, never narrower, so no
   under-collection risk; but invoices are wrong for same-state
   customers until confirmed. Readiness warns.
2. **Staging E2E skips backend-outage specs** without real Upstash
   creds — the fail-closed behaviour is unit-tested but not
   exercised end-to-end.
3. **Rate-limit egress on Vercel** — Upstash REST calls add latency
   to mutations; acceptable at this scale, revisit if checkout p95
   matters.
4. **No PITR yet** — free-plan RPO ≤ 24 h. Enabling PITR (paid) is
   the single highest-value production purchase; until then the
   scheduled logical dump (backup-restore.md) is the mitigation.
5. **Supply-chain** — `npm audit` clean today; the CI security job
   keeps it honest going forward, but no lockfile-signature or
   provenance checks are enabled.

## 9. Rollback / recovery plan

- **App deploy**: revert to the previous build on the host — safe
  only for additive schema changes (additive-first rule,
  migrations.md). Otherwise fix-forward.
- **Bad migration**: corrective forward migration (tested on staging
  against a data copy) or targeted table restore from a logical dump
  (procedure drill-verified today) — never a blind rollback.
- **Catastrophic**: PITR/full restore per backup-restore.md; RPO as
  above; requires announced downtime and re-verification via the
  smoke checklist.
- **Config drift**: `/api/ready` 503 names the missing variable;
  fix in the host secret manager and redeploy/restart.

## 9b. Release-gate checklist (2026-10-11 audit; Prompt 48 resolutions applied)

Item-level status, evidence, and exact commands now live in
`docs/operations/release-gate-checklist.md` (PASS / FAIL / BLOCKED /
NOT RUN). The two staging-workflow defects confirmed in that audit
are now **resolved**:

1. `staging-e2e.yml` ran on a GitHub-hosted runner while
   `playwright.staging.config.ts` requires loopback URLs. **Fixed by
   inverting the dependency**: the workflow boots a disposable local
   Supabase stack on the runner (`start` → `db reset` → `migration
   up` → migration-parity check → health + seed smoke checks) and
   points Playwright at loopback services only. The loopback guard is
   unchanged — it is what prevents accidental production targeting.
   A CLI quirk found while verifying (`db reset` silently capping at
   a stale newest-migration file) is closed by the `migration up` +
   parity-check steps.
2. `if: github.repository_owner != ''` was always true. **Removed**;
   fork safety now follows from the design (manual dispatch, zero
   secrets, disposable local state).

Re-verified on the current tree this session: lint 0, typecheck 0,
609/609 unit tests, production build 0, hermetic E2E 56/56, staging
E2E 38/2/0. Nothing was deployed or migrated.

Prompt 49 follow-up (2026-10-11, uncommitted local work): tax state
list corrected (37 Andhra Pradesh, 38 Ladakh), seller-GSTIN format
warning + invoice-prefix critical + UPI-shape critical added to
`verifyProductionConfig()`, `/api/ready` now surfaces
`checks.config.warnings`, invoice builder enforces paid-only and
GST⇔GSTIN coherence, GSTIN/billing-state match enforced at order
time, exact decimal→paise parsing on the invoice path, and migration
`0030` locks invoice numbering to the service role plus a DB-level
tax-split CHECK. Full unit suite is now **621/621** (38 files); lint
0/18, typecheck 0, placeholder-env production build 0. Details and
the unchanged BLOCKED/NOT RUN items are in
`release-gate-checklist.md` §G. Nothing was deployed or migrated.

Prompt 50 follow-up (2026-10-11, uncommitted local work): full
customer-to-admin journey executed against the disposable loopback
stack — staging E2E **38 passed / 2 skipped / 0 failed** (skips are
the pre-existing Upstash-blocked placeholders). The journey caught
one real Prompt-49 regression: the exact paise parser assumed
string-shaped NUMERICs while live PostgREST serves JSON numbers, so
real invoice downloads 500'd — fixed (`toPaise` + GST-rate types
accept both shapes) with a regression test; unit suite now
**622/622**. Migration `0030` verified locally only: parity
tree-max = DB-max `0030`, clean `reset`→`up` apply, 5/5 tax-split
constraint cases, per-role numbering grants confirmed with live
denied calls (residue 0, no numbers burned). Managed-staging and
production gates remain NOT RUN / BLOCKED. Full matrix and commands
in `release-gate-checklist.md` §H. Nothing was deployed, no
production system touched, nothing committed (per this prompt's
rules).

Prompt 51 follow-up (2026-10-11, uncommitted local work): the
managed-staging 0030 gate was prepared but NOT executed — no
authorization, no identified staging target, and no staging
connection mechanism exist in this context, so zero
managed-environment commands ran (details + ready-to-use operator
handoff in `release-gate-checklist.md` §I). The first
`staging-e2e.yml` dispatch was also withheld: the workflow tests the
committed revision, which lacks the 8 uncommitted Prompt 50 files.
No production system touched, configured, or probed; nothing
committed or pushed.

## 10. Path to `PRODUCTION VERIFIED`

1. Provision production Supabase + host; set the env vars in §7;
   confirm `TROLIFT_STATE_CODE` and GSTIN with the owner.
2. Enable PITR (or accept + document the 24 h RPO).
3. First `supabase db push` per migrations.md (with pre-migration
   backup verification).
4. Deploy the app build; run production-smoke-test.md in full,
   including the authorized controlled test transaction.
5. Verify a **managed** recovery: confirm the platform protects
   `auth`/`storage`, then repeat the backup/restore drill against a
   staging copy (the local disposable drill with fixture orders is
   done — §5 — but local ≠ managed).
6. Record results here; classification can then be upgraded by the
   authorized operator.

## Artifacts

`lib/config/production.ts`, `tests/config-production.test.ts`,
`app/api/ready/route.ts`, `.github/workflows/ci.yml`,
`.github/workflows/staging-e2e.yml` (replaces `e2e.yml`),
`.env.example` (updated), `docs/operations/environment-variables.md`,
`docs/operations/migrations.md`, `docs/operations/backup-restore.md`,
`docs/operations/monitoring.md`,
`docs/operations/production-smoke-test.md`,
`docs/operations/release-gate-checklist.md`,
`scripts/backup-restore/fixtures.sql`,
`scripts/backup-restore/verify.sql`,
`supabase/migrations/0030_invoice_tax_integrity.sql`, this report.
