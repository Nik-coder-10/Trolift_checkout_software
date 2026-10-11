# Backup & restore — strategy, targets, and drill record

## What must survive an incident

| Data | Where it lives | Backed up by | Notes |
| --- | --- | --- | --- |
| Orders, order_items, payments, invoices | Supabase Postgres | DB backups + PITR | Money and tax records — highest priority. Order rows are append-mostly; invoices snapshot their data at issue time. |
| Customers, profiles | Supabase Postgres | DB backups + PITR | PII — restores must respect RLS (policies travel with the schema dump). |
| Products, delivery partners/rates/slabs/rules | Supabase Postgres | DB backups + PITR | Also re-derivable from admin CSV exports (see below), which makes them the cheapest thing to reconstruct. |
| Order events, shipments, staff notes, audit log | Supabase Postgres | DB backups + PITR | Operational history. |
| Product images | Supabase Storage (`product-images/`) | **Not covered by DB backups** | See "Storage" below. |
| Configuration | Environment variables (host secret manager) | Host-level; not in Git | See environment-variables.md — a restore checklist item, not a dump. |
| Migrations | `supabase/migrations/` in Git | Git | The schema is always reconstructible from the repo + applied-migrations table. |

## Realistic backup posture (actual plan, not the dashboard ideal)

- **Free/Starter Supabase plan**: daily automated backups (retention
  ~7 days), **no PITR**. PITR requires Pro and is a paid add-on.
- **Recommended baseline for launch**: enable PITR ( Pro ) *or* accept
  up to 24 h of RPO with daily backups and add a scheduled logical
  dump (below) as a second, independent copy.
- A dashboard tile saying "Backups: enabled" is NOT verification —
  see the drill section: a backup is verified only when it has been
  **restored and queried**.

### RPO / RTO targets (proposed, owner ratifies)

| Scenario | RPO | RTO |
| --- | --- | --- |
| With PITR enabled (recommended) | ≤ 5 minutes | ≤ 2 hours (targeted table restore) / ≤ 6 hours (full project) |
| Daily backups only (free plan) | ≤ 24 hours | ≤ 6 hours |

Restoring individual tables from a logical dump (what the drill below
exercises) is the fastest realistic path for the most likely
incident — a bad migration or a botched admin import — because it
does not require taking the whole project offline.

### Second copy: scheduled logical dump

`supabase db dump --db-url $SUPABASE_DB_URL` (data + schema) to an
off-Supabase location (object storage outside the project, or the
operator's machine) at least daily while PITR is unavailable. The
dump is encrypted at rest by whatever stores it; it contains PII and
customer payment references — treat it like a production secret.

### Storage (product images)

DB backups do not include Storage objects. Options, cheapest first:
1. Rely on Supabase's own Storage snapshots (plan-dependent — verify
   in the dashboard that the bucket is included before trusting it).
2. Periodic `supabase storage dump` / S3-compatible sync of the
   `product-images` bucket to independent object storage.
3. Accept re-upload: images are re-derivable from the supplier
   catalogue, so acceptable RPO here can be looser than the DB — but
   say so explicitly rather than by accident.

### Configuration backup

Every variable in environment-variables.md is documented; the
*values* live in the host's secret manager. A restore runbook step
is "verify all required env vars are present" — which `/api/ready`
now also enforces in production (critical settings fail readiness).

## Restore procedure (documented, tested)

**Never restore over production without an explicit authorization
and a fresh pre-restore dump of the CURRENT state.**

Targeted table restore (typical incident: bad migration / bad import):

```bash
# 1. Dump schema + data from the LIVE project (or take the latest scheduled dump)
supabase db dump --db-url "$SUPABASE_DB_URL" -f schema.sql
supabase db dump --db-url "$SUPABASE_DB_URL" --data-only -f data.sql

# 2. Restore into a DISPOSABLE Postgres first (never straight into prod)
#    Prerequisites the dump assumes (Supabase provides these natively):
#      create extension pg_trgm;
#      roles: anon, authenticated, service_role;
#      schema auth with table auth.users and function auth.uid();
docker run -d --name restore-target -e POSTGRES_PASSWORD=x postgres:16-alpine
psql "$TARGET_URL" -f schema.sql     # ON_ERROR_STOP=1, ONE pass — re-running
psql "$TARGET_URL" -f data.sql       # over a partial restore causes duplicate-PK errors

# 3. Verify BEFORE promoting: per-table row counts + content checksums
#    must equal the source (see drill record below for the exact queries)

# 4. Promote: apply the verified dump to production during a announced
#    low-traffic window, re-verify counts, run /api/ready + smoke items.
```

Full-project restore (Supabase dashboard "Restore" / CLI) reverts the
whole project to the backup point — it loses all writes after the
point in time. Announce, coordinate with any admin activity, and take
a pre-restore dump first.

## Restore drill record — 2026-10-10 (COMPLETED, PASS)

Performed against the **local disposable staging stack** (never
production). Source: Supabase local project `automation`
(`supabase_db_automation`, the database the staging E2E suite runs
against). Target: throwaway `postgres:16-alpine` container on port
15599, removed after the drill.

Steps executed and results:

1. `supabase db dump` → `schema.sql` (2690 lines) + `data-only` →
   `data.sql` — **OK**.
2. Target container prerequisites: `pg_trgm`, roles
   `anon`/`authenticated`/`service_role`, `auth.users` +
   `auth.uid()` stubs — **documented as runbook steps** (learned the
   hard way: without them the restore fails on grants/RLS).
3. Schema restore with `ON_ERROR_STOP=1`: **exit 0**, 18 tables
   created. (First attempt failed with duplicate-PK because the
   restore had been re-run over a partial load — the runbook now says
   ONE pass only, reset with `DROP SCHEMA public CASCADE` first.)
4. Data restore: **exit 0**.
5. Verification: per-table `count(*)` for all 18 tables — **18/18
   match** (products 8, delivery_partners 5, delivery_pincode_rates
   16, delivery_weight_slabs 3, delivery_category_rules 1, profiles
   20; transactional tables 0 = correct, staging is swept clean
   between runs).
6. Content checksums (`md5(string_agg(row::text, '|'))`) for the six
   seeded tables (products, partners, rates, slabs, rules, profiles):
   **6/6 match** source.
7. Target container destroyed; no production system was contacted at
   any point.

**Drill verdict: the documented procedure restores a faithful copy
and the verification queries detect any divergence.** Order/payment/
invoice tables carried 0 rows at drill time (staging sweeps), so
those tables' *restore mechanics* are proven but their *volume
behaviour* (large dumps, TOASTed JSONB) has not been exercised —
re-run the drill against a staging copy containing fixture orders
before the first production migration (migrations.md step 2).

## Restore drill record — 2026-10-11 (transactional fixtures) — PASS

This drill closes the limitation above: the source was populated with
realistic, synthetic transactional data **before** backup, so the
tables that carry money and tax were actually exercised.

### Environment classification (no secrets)

| | Value |
| --- | --- |
| Source | **Local disposable** Supabase stack `automation` — container `supabase_db_automation`, db `postgres`, `127.0.0.1:54322`, PostgreSQL 15.8.1.085. Not staging-as-a-service, not production. |
| Target | **Throwaway** container `drdrill-target`, `postgres:15-alpine` (PostgreSQL 15.19), `127.0.0.1:15599`, removed after the drill. |
| Scope | **Local disposable PostgreSQL restore only.** Managed Supabase staging recovery and production recovery were **NOT** tested and remain unverified. |

### Fixtures populated (all synthetic, `DRDRILL`-namespaced)

`scripts/backup-restore/fixtures.sql` (deterministic valid-hex UUIDs,
applied once to a clean fixture DB):

| Table | Rows | Table | Rows |
| --- | --- | --- | --- |
| customers | 2 | payments | 2 |
| products | 2 | invoices | 1 |
| delivery_partners | 1 | stock_reservations | 2 |
| delivery_pincode_rates | 1 | inventory_events | 3 |
| delivery_weight_slabs | 2 | shipments | 1 |
| delivery_category_rules | 1 | order_events | 10 |
| orders | 2 | order_access_tokens | 2 |
| order_items | 2 | staff_notes | 2 |
| admin_audit_log | 1 | | |

O1 is intra-state (state 27): subtotal 1000 + delivery 60 + CGST 90 +
SGST 90 = total 1240, paid + delivered, with an invoice. O2 is
inter-state (29): subtotal 2400 + delivery 80 + IGST 432 = total 2912,
payment submitted, stock reserved. Tax, totals, frozen item snapshots
and the invoice JSON snapshot are internally consistent.

### Exact commands

```bash
# Fixtures → source (local disposable stack)
docker exec -i supabase_db_automation \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - \
  < scripts/backup-restore/fixtures.sql                     # exit 0

# Backup (documented procedure)
supabase db dump --db-url "$SOURCE_URL" -f schema.sql         # exit 0 (3184 lines)
supabase db dump --db-url "$SOURCE_URL" --data-only -s public \
  -f data.sql                                                # exit 0 (255 lines)

# Disposable target + prerequisites (documented stubs)
docker run -d --name drdrill-target -e POSTGRES_PASSWORD=... \
  -p 15599:5432 postgres:15-alpine
#   roles anon/authenticated/service_role; extension pg_trgm;
#   schema auth + table auth.users(id uuid); functions auth.uid(),
#   auth.role(), auth.jwt()

# Stage 1 — schema, then Stage 2 — data (separate, independently verified)
docker exec -i drdrill-target psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -f - < schema.sql                       # exit 0, 18 tables
ocker exec -i drdrill-target psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -f - < data.sql                         # exit 0

# Verification (identical read-only script on both sides)
docker exec -i <db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -At -f - < scripts/backup-restore/verify.sql               # exit 0 both
```

### Results

- Schema restore **exit 0**, 18/18 application tables created, no
errors or warnings. Data restore **exit 0**, no errors.
- `verify.sql` ran **exit 0** on source and target; the two outputs
diff to **zero lines** (identical).
- **Per-table counts + md5 checksums** matched for all 18 tables,
including the populated transactional tables (orders 2, order_items 2,
payments 2, invoices 1, shipments 1, order_events 10,
stock_reservations 2, inventory_events 3, staff_notes 2,
order_access_tokens 2, admin_audit_log 1). Deterministic
`md5(string_agg(row::text, E'\n' order by id))` per table; no
business-critical column excluded. Generated/platform values
(`gen_random_uuid`, `now()`) are captured as literals in the dump, so
no time- or id-specific fields had to be masked.
- **Relationship integrity:** all 17 foreign keys plus the
`staff_notes` entity-consistency check returned **0 violations** on
both sides (orders↔customers, items↔orders/products, payments/
invoices/shipments/events/tokens↔orders, reservations↔orders/products,
inventory_events↔products/orders, delivery rate/slab↔partner,
profiles↔auth.users).
- **Financial + operational invariants:** all 0 — order-total identity
(`total = subtotal + delivery + cgst + sgst + igst`), line-total math,
line GST base, invoice-total vs order, paid-order⇒verified-payment,
paid-payment amount vs order, invoice subtotal vs order,
reserved-stock⇒held-reservation, active-reservation⇒inventory event,
shipment delivered⇒order delivered, valid event type/actor.
- **Schema-object fingerprint:** identical — indexes 83, check
constraints 86, foreign keys 17, unique constraints 12, triggers 13,
public functions 51, RLS-enabled tables 18, RLS policies 22, table
grants 497, and a definition hash over constraint/trigger/policy
definitions (`d970820a445989c7007ef8436383ba92`). Bootstrapped
`orders.order_number` values (`TS-261011-0209`, `TS-261011-0210`) and
trigger-assigned identity were preserved exactly.

### Integrity checks that needed interpretation (reported, not hidden)

1. **`profiles → auth.users` is cross-schema.** `auth.users` is
   Supabase-managed and is **not** in the `public`-schema backup, so a
   public-only restore into a bare target left **20 dangling**
   `profiles` references (0 in the source). Seeding the 20 auth user
   ids from the source into the target — simulating the platform's own
   auth restore — brought this to **0**. Implication: the application
   data restore is complete, but a faithful *managed* recovery also
   depends on the platform restoring `auth`; that path is untested here.
2. **`SET session_replication_role = replica`** appears in pg_dump's
   data output, so triggers/FKs are not enforced *during* the load.
   Every constraint was re-validated read-only **after** the restore
   (above), which is what makes this acceptable rather than a bypass.

### Tooling findings that changed the runbook

- `supabase db dump --data-only` **without** `-s public` includes
  Supabase-managed `auth`/`storage` data and failed to restore on
  schema drift (`auth.audit_log_entries.ip_address`). **Use
  `--data-only -s public` for application data.**
- The **schema** dump must be taken **without** a schema scope: a
  `-s public` schema dump is not self-contained — it omits
  `pg_graphql`'s `graphql.seq_schema_version`, so its DDL event trigger
  fails on restore. Take the full schema dump; scope only the data
  dump.
- The Supabase Postgres image (`public.ecr.aws/supabase/postgres`) is
  **not runnable standalone** — its init migrations reference internal
  roles and the container exits. Use a plain `postgres:15-alpine`
  target with the stubbed prerequisites above (roles, `auth` schema,
  `auth.uid()`), as this drill did.

### Cleanup (verified)

- Target container `drdrill-target` removed; `docker ps -a` shows no
  `drdrill-target`, port 15599 free.
- All `DRDRILL` fixture rows deleted from the source; counts returned
  to the exact pre-drill baseline (products 8, partners 5, pincode
  rates 16, weight slabs 3, category rules 1, all transactional 0,
  customers 0). Zero `DRDRILL` residue in products/customers/partners.
- Temporary dumps/identity lists under the OS temp dir were created
  for the drill and are not required after this record.

### Known limitations / follow-ups

- **Local disposable only.** Managed Supabase staging recovery and
  production backup/restore are still unverified; do not upgrade the
  release classification on the strength of this drill.
- `auth`/`storage` recovery is the platform's responsibility and was
  only *simulated* (stub ids). Verify the platform's auth restore on
  a staging copy before trusting a full recovery.
- Fixtures are small (2 orders). Large-dump volume, TOAST/JSONB
  behaviour at scale, and `--use-copy` restore performance are not
  exercised; consider a scaled fixture set before the first production
  migration.
- The drill does not cover point-in-time recovery (PITR); see the
  RPO/RTO section — PITR remains a paid, owner-ratified decision.
