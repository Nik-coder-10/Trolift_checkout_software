# Supabase — Trolift Solutions

## Migrations

| File | Contents |
| ---- | -------- |
| `0001_init_placeholder.sql` | No-op baseline (Prompt 1). |
| `0002_extensions_helpers.sql` | `pgcrypto`, `set_updated_at()` trigger fn, `order_number_seq` + `generate_order_number()` (`TRL-YYYY-NNNNNN`). |
| `0003_identity_catalog.sql` | `profiles`, `customers`, `products`, `delivery_partners`, `delivery_pincode_rates` + indexes + `updated_at` triggers. |
| `0004_orders.sql` | `orders` (auto order number, snapshot totals with `total = subtotal + delivery` CHECK), `order_items` (name/price/line-total snapshots, `line_total = qty × price` CHECK), `payments` (unique UTR where present). |
| `0005_messaging.sql` | Historical only — created `whatsapp_*` tables, removed again in `0009`. |
| `0009_drop_whatsapp.sql` | Drops `whatsapp_leads` + `whatsapp_messages` (messaging out of scope). |
| `0010_partner_priority.sql` | `delivery_partners.priority` (lower wins; default 100) + index for engine selection. |
| `0011_order_creation.sql` | Atomic `create_order()` RPC (customer upsert + order + items + pending payment, idempotent). |
| `0012_payment_states.sql` | Payment lifecycle (`pending→submitted→paid/failed/cancelled/refunded`) + order states (`payment_submitted`, `processing`, `dispatched`). |
| `0013_admin_dashboard.sql` | Self-guarding `get_admin_dashboard()` RPC (counts, paid revenue, claims, recent orders). |
| `0014_order_events.sql` | Append-only `order_events` audit log (admin read/insert, no updates). |
| `0015_customer_aggregates.sql` | `get_admin_customers()` + `get_admin_customer()` aggregate RPCs (repeat-buyer signals). |
| `0016_gst_billing.sql` | B2B GST: `products.gst_rate`, customer billing master, order billing + tax snapshots, per-line tax, widened total CHECK, `create_order()` replacement. |
| `0017_invoices.sql` | Invoices: order-time customer snapshots (backfilled, then NOT NULL), `invoices` frozen records (UNIQUE number + freeze trigger), `INV/FY/SEQ` numbering (`invoice_financial_year()` + sequence), `create_order()` replacement. |
| `0018_inventory.sql` | Inventory: `products.low_stock_threshold`, `orders.stock_state` gate, `stock_reservations` holds (TTL + sweep), `inventory_events` audit, `product_availability()` RPC, reserve-in-`create_order()`, `consume_`/`restore_reservation()` RPCs, `search_products()` threshold column. |
| `0019_delivery_rules.sql` | Delivery rules: `products.weight_kg`, pincode `remote_surcharge`, `delivery_weight_slabs` (per-partner bands replacing base), `delivery_category_rules` (flat per-order handling), order `delivery_weight_kg` + `delivery_rule_summary` snapshots, `create_order()` replacement. |
| `0020_bulk_operations.sql` | Bulk ops: append-only `admin_audit_log` + atomic `import_products()` (slug-matched) / `import_rates()` (pair-matched) RPCs — any failure rolls the whole file back. |
| `0021_order_event_types.sql` | Canonical events: `order_events.event_type` (closed CHECK) + `actor_type` + `metadata` JSONB, backfilled from legacy actions (STATUS_CHANGED bucket for unknowns), new `created_at`/`event_type` indexes, `create_order()` replacement emitting in-transaction `ORDER_CREATED`. |
| `0022_performance_indexes.sql` | Query-pattern indexes (orders/customer/status, rates, products, events, reservations, payments, customer trigrams). |
| `0023_shipments.sql` | `shipments` 1:1 dispatch table + admin-only RLS + `updated_at` trigger. |
| `0024_admin_command_center.sql` | Self-guarding `get_admin_command_center()` RPC (admin dashboard in one round-trip). |
| `0025_staff_notes.sql` | `staff_notes` (admin-only RLS; anon has no grant at all). |
| `0026_guest_order_tokens.sql` | `order_access_tokens` (SHA-256 hashes only, one-active index, RLS, no grants). Replaces the removed `0024_order_access_tokens.sql`, which shared its version prefix with `0024_admin_command_center.sql` and halted fresh databases (`schema_migrations_pkey (0024)`). |
| `0027_command_center_total_fix.sql` | Forward fix: `sum(value::integer)` in `get_admin_command_center()` — the 0024 form (`sum(text)`) errored on every call on live PostgreSQL. |
| `0028_revoke_anon_rpc.sql` | Forward fix: explicit `revoke execute ... from anon` on order/inventory/import/invoice/admin RPCs. Supabase default privileges leave `anon=X` on new functions, so the earlier `revoke ... from public` clauses did not stop anonymous RPC execution. |
| `0006_rls.sql` | Grants + `is_admin()` helper + RLS policies (see below). |
| `0007_hardening.sql` | Missing FK indexes, `TS-YYMMDD-SEQ` order numbers + format CHECK, `order_items` timestamps. |
| `0008_search.sql` | `pg_trgm` + trigram index + `search_products()` RPC (ILIKE recall, similarity ranking, price/category windows, clamped pagination). |

`is_admin()` lives in `0006` deliberately: SQL-language function bodies
are validated at `CREATE` time, so it must be defined after `profiles`
exists (a real failure caught during local validation).

Order numbers are display-only (`TS-261001-0001` form: `TS-` + YYMMDD +
a zero-padded global sequence, enforced by
`orders_number_format_check`). UUIDs are the primary keys. The sequence
is global (never reset daily) so concurrent checkouts cannot collide.

No customer authentication exists yet by design: orders and payments
are admin + service-role only. When customer accounts
arrive, link `customers` to `auth.users` and add own-order RLS
policies — the `customer_id` FKs are already in place for that.

## Money & snapshots

- All money is `NUMERIC(12,2)` rupees — never float. App code works in
  integer paise and converts at the boundary.
- Orders snapshot `subtotal / delivery_charge / total_amount`, the GSTIN,
  the billing profile and the tax split (`taxable_amount`, `cgst/sgst/igst_amount`);
  items snapshot product name + unit price + `gst_rate_percent` + `line_tax_amount`.
- DB CHECKs enforce `total_amount = subtotal + delivery_charge + cgst + sgst + igst`
  (zeros for pre-GST/non-GST rows) and `line_total = quantity * unit_price`,
  so history cannot drift when catalogue prices or rates change.
- Catalogue prices are GST-INCLUSIVE; checkout reverse-computes the
  taxable `unit_price` / `line_total` and stores the complement in
  `line_tax_amount`. `products.gst_rate` NULL means 0%.

## Inventory policy (enforced in 0018, not just app code)

- `stock_quantity` is on-hand units (admin-managed, never negative).
  Sellable units = on-hand minus live `stock_reservations` holds.
- RESERVE at order creation (atomic, inside `create_order()`): holds
  expire after the payment window (`p_reservation_hours`, passed by the
  app from `PAYMENT_WINDOW_HOURS`, default 24); every order attempt
  sweeps expired holds first — no scheduler, and abandoned carts never
  strand stock.
- CONSUME at payment verification (`consume_reservation()`): holds turn
  into real decrements only when money is verified. Idempotent.
- RESTORE on cancellation (`restore_reservation()`): held units are
  released, consumed units returned — exactly once via
  `orders.stock_state` (`none`/`reserved`/`consumed`/`restored`).
- Storefront shows status only (in/low/out of stock, threshold-based);
  counts are re-checked server-side at order time, where races fail
  safe with the item named instead of overselling.
- Every movement lands in `inventory_events` (signed on-hand delta +
  resulting balance) for debugging.

## Access model (RLS)

- `anon, authenticated`: `SELECT` active `products`, active
  `delivery_partners`, all `delivery_pincode_rates` (storefront +
  serviceability checks need these).
- `authenticated` + `profiles.is_admin`: full access everywhere.
- Everything else (customers, orders, items, payments): admins +
  service-role key only. The service role bypasses RLS and is used by
  server Route Handlers.
- `profiles.is_admin` has no public write policy — flip only via the
  service-role key.

## Seed

`seed/seed.sql` is deterministic (fixed UUIDs) and idempotent
(`ON CONFLICT DO NOTHING`): 5 fictional delivery partners, 8 realistic
products, 16 pincode-rate rows across 7 pincodes — including
multi-partner pincodes with different charges, a minimum-order freight
row, and non-serviceable scenarios (`600001` × BlueDart, remote
`799001`).

## Applying

Against a linked project (Supabase CLI unblocked):

```bash
supabase db push        # applies supabase/migrations in order
psql "$SUPABASE_DB_URL" -f supabase/seed/seed.sql   # dev data only
supabase gen types typescript --linked > types/database-generated.ts
```

Validated locally on PostgreSQL 16 (docker): full ordered apply +
30+ behavioural checks (constraint rejections, snapshot immutability,
RESTRICT/CASCADE, trigger firing, anon/authenticated RLS behaviour).

## Staging verification (Prompt 43, live disposable Supabase)

Run against a local disposable stack (`supabase start`, 127.0.0.1 —
never production), then execute the checks below (55/55 green on
2026-10-09; harness kept outside the repo, uses `STG43`-prefixed data
only and cleans up after itself):

```bash
supabase db reset --version <latest>   # NOTE: CLI v2.26.0 on Windows
                                       # silently skips the last migration
                                       # file; --version forces the target
node staging-verify.mjs                # RLS + RPC + transactional suite
```

Proven live: ordered history 0001–0028; RLS denies anon/non-admin on
all sensitive tables (staff_notes: hard 403, no anon grant); admin
RPCs deny non-admins and serve admins (post-0027); `create_order`
snapshots + idempotency + exactly-one-winner concurrency with no
negative stock; restore/consume exactly-once; invoice UNIQUE + freeze
trigger; CHECK-level rollback with no partial rows; anon RPC execution
revoked (post-0028). Known CLI quirk and the two fixed migration bugs
are detailed in the staging report.
