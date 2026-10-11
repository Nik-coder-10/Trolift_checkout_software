# Migration release process — forward-only, verified at every step

Migrations live in `supabase/migrations/NNNN_name.sql` and are applied
by the Supabase CLI (`supabase db push`), which records them in
`supabase_migrations.schema_migrations`. They are **forward-only**:
this codebase does not ship `down` migrations, and several changes
(drop table, tighten NOT NULL) cannot be reversed losslessly. Do not
pretend otherwise — recovery is *a tested corrective forward
migration* or *a point-in-time restore* (see backup-restore.md), never
a blind rollback.

## The release gate (7 steps, in order, no skipping)

1. **Migration inspection** — every new `.sql` file is reviewed for
   the risky patterns in the inventory below. `supabase db diff` (or
   `supabase db lint`) must show the schema after migration matches
   what the app expects. CI runs lint/typecheck/tests/build, but SQL
   is NOT executed in CI (no disposable Postgres in the pipeline) —
   inspection is a human gate plus the checklist in this document.
2. **Backup verification** — take/confirm a fresh backup or PITR
   window BEFORE the staging push (step "Backup verification" in
   backup-restore.md: existence AND restorability, not a dashboard
   tick). A migration without a verified restore point is gambling.
3. **Staging migration** — `supabase db push --db-url $STAGING_DB_URL`
   against the staging/disposable stack. Never run an unapplied
   migration against production first.
4. **Staging smoke tests** — run the staging E2E suite
   (`npm run test:e2e:staging`, or the manual `staging-e2e` GitHub
   workflow) plus the checklist items in production-smoke-test.md
   relevant to the change (catalogue, checkout, invoice if touched).
   The suite must be run WHOLE — startup sweeps remove stale synthetic
   rows, so a partial re-run of one spec is not a valid signal.
5. **Production approval** — a human explicitly authorizes the
   production migration (and separately, the deploy). CI has no
   deploy/migrate job by design; approval is recorded in the release
   report (release-readiness.md) or the PR that carries it.
6. **Production migration** — `supabase db push --db-url
   $PROD_DB_URL` (or the dashboard SQL editor for a one-off). Run in
   a low-traffic window. Migration application is transactional per
   file in Postgres, but multi-file pushes are NOT atomic as a set —
   if file 3 of 5 fails, files 1–2 remain applied.
7. **Post-migration verification** — `/api/ready` returns 200 (it now
   also verifies critical production configuration), spot-check the
   smoke items the migration could affect, and watch the alertable
   log signals in monitoring.md for elevated 5xx for at least one
   business cycle.

## Forward-only recovery policy

- **Mistaken data written by a migration**: write a NEW migration
  that corrects the data (with a WHERE clause scoped to the affected
  rows), tested on staging against a copy of the pre-migration data.
- **Migration that breaks the running app**: fix-forward with a
  corrective migration; the previous app deploy can only be rolled
  back if the schema change is additive and backward-compatible with
  the old code (see additive rule below).
- **Catastrophic/irreversible damage**: PITR/restore per
  backup-restore.md. Restoring means losing writes after the restore
  point — announce, coordinate, and re-verify.

**Additive-first rule** (what makes a code rollback safe): new column
is nullable or has a default; new table; new index (CONCURRENTLY
where table is large); relaxed constraint. Dropping a column,
tightening NOT NULL, changing a constraint's CHECK, or rewriting a
function the old code calls are all code-rollback BREAKING — they
require the new app deploy to go out in the same window and cannot be
undone by redeploying old code.

## Risky-migration inventory (audited from the actual files)

| Migration | Change | Risk | Recovery strategy |
| --- | --- | --- | --- |
| `0009_drop_whatsapp.sql` | `DROP TABLE whatsapp_messages, whatsapp_leads` | **Irreversible data loss** if run against a DB that still has rows (out-of-scope tables; fine when genuinely empty). | Pre-check: `SELECT count(*)` on both tables must be 0 before push. If pushed in error, data is gone — only restore from backup recovers it. |
| `0012_payment_states.sql` | drops/recreates CHECK constraints on payments + orders status columns | Existing rows may violate the new CHECK; constraint rebuild fails mid-file. | Pre-check rows against new allowed values; corrective UPDATE first, then the constraint. If it fails, fix data, re-push (already-applied statements are skipped only if the file is split — otherwise edit forward with `IF EXISTS`). |
| `0016_gst_billing.sql` | drops `orders_total_check`, adds GST columns | Additive columns are safe; dropping the total check removes a money invariant until the new one lands in the same file. | Ship as one file (it is). Verify the new total identity constraint holds on existing rows before push. |
| `0017_invoices.sql` | `ALTER COLUMN ... SET NOT NULL` on snapshot columns | **Breaking for old code + fails if any NULL exists.** | Backfill UPDATE first inside the same migration; only then SET NOT NULL. Code deploy must follow immediately (old code writing NULLs would now fail). |
| `0018_inventory.sql` | drops/recreates `search_products()`; `DELETE FROM stock_reservations` inside functions | Function rewrite changes RPC behaviour for every caller; deletes are deliberate releases but destructive if the function is invoked wrongly. | Recreate is versioned in-file; stage on staging and exercise reserve/release paths (smoke items 9–10). Old function is lost — fix-forward by re-running the file's CREATE. |
| `0019_delivery_rules.sql` | drops old rate machinery; `DELETE FROM stock_reservations` in functions | Same class as 0018: large destructive rewrite. | Staging copy first; verify quotes + slab resolution end-to-end before prod. |
| `0021_order_event_types.sql` | `ALTER COLUMN event_type/actor_type SET NOT NULL`; deletes in functions | NOT NULL tightening fails on legacy NULL rows. | Backfill before SET NOT NULL (file does this); verify counts on staging. |
| `0029_order_status_milestones.sql` | drops/recreates orders status CHECK; adds milestone columns | Status CHECK change: legacy statuses must satisfy new CHECK. | Pre-check `SELECT DISTINCT order_status`; corrective UPDATE for stragglers; additive columns are code-rollback-safe. |
| `0030_invoice_tax_integrity.sql` | revokes invoice-numbering function + sequence from `authenticated`/`anon` (service role keeps both); adds `orders_tax_split_check` (intra/inter exclusivity + non-GST zero-tax) | Revokes are code-rollback-safe (old code calls through the service role). The CHECK fails the push if any existing row mixes splits or taxes a `non_gst` order. | Verified on the disposable stack (Prompt 50): `db reset` + `migration up` applied cleanly; pre-0016 all-zero rows satisfy the CHECK; 5 live accept/reject cases all correct. Pre-check on staging: `SELECT count(*) FROM public.orders WHERE (cgst_amount + sgst_amount <> 0 AND igst_amount <> 0) OR (tax_treatment = 'non_gst' AND (cgst_amount <> 0 OR sgst_amount <> 0 OR igst_amount <> 0));` must be 0. |

General pre-flight for ANY migration touching constraints or NOT
NULL (run against the TARGET database, read-only):

```sql
-- adapt per migration; must return 0 rows / expected values
SELECT count(*) FROM public.orders WHERE customer_name_snapshot IS NULL;
SELECT DISTINCT order_status FROM public.orders;  -- compare to new CHECK
```

## File conventions

- One concern per file; forward-only; `IF EXISTS`/`IF NOT EXISTS`
  where it does not weaken the change.
- Data backfills live in the SAME file as the constraint they enable.
- Functions are full `CREATE OR REPLACE` definitions, never patches.
- No destructive statement without a preceding read-only pre-check
  documented in the PR and, for the risky ones, in the table above.
