# Trolift Solutions — B2B Ordering Platform

Industrial material-handling equipment, ordered simply. A production-oriented
**Next.js + Supabase** platform for browsing equipment, ordering by pincode
with automated delivery calculation, redeem-code discounts, and paying on UPI
via a per-order dynamic QR — with a full admin backend for products, orders,
payments, coupons, customers, invoices, quotations, shipments and site
settings.

> **Status: live in production** — deployed on Vercel
> (https://troliftsolutions.vercel.app/) with auto-deploy from `main`,
> backed by the production Supabase project. 927 unit tests across 52 files
> pass; lint/typecheck/build are clean on every push.

---

## What is this?

Trolift Solutions sells warehouses and workshops what they run on: telescopic
and A-type ladders, metal and HDPE platform trolleys, finger-protect
solutions and more. This platform lets B2B customers:

- Browse equipment with transparent, all-inclusive pricing (GST & delivery included)
- Search, filter and sort the catalogue to find the right machine
- Check delivery serviceability by pincode *before* paying
- See delivery included in every catalogue price; apply redeem codes at checkout
- Pay the owner directly over UPI — the QR encodes the order's exact frozen
  total and order number (`am` + `tn`), then submit the UTR reference with an
  optional payment screenshot. The claim is validated server-side
  (authoritative total, VPA shape, UTR format + uniqueness) and an admin
  manually verifies it before the order is marked paid. There is no
  automatic bank/UPI settlement.
- Download GST invoices and provisional quotations as PDFs
- Track order status via a token-linked guest view

…and lets Trolift staff manage everything from an authenticated admin
command center: products, orders, payments, coupons, customers, delivery
partners/rates, shipments, site settings and the audit log.

## Tech stack

| Layer      | Choice                                              |
| ---------- | --------------------------------------------------- |
| Framework  | Next.js 16 (App Router) + React 19 + TypeScript     |
| Styling    | Tailwind CSS v4, industrial navy/amber design system|
| Database   | PostgreSQL via Supabase, UUID keys, RLS everywhere  |
| Search     | `pg_trgm` + `search_products()` RPC (no extra infra)|
| Auth       | Supabase Auth (`profiles.is_admin` for admin gates) |
| Documents  | PDFKit (invoices + quotations), QR codes on invoices |
| Payments   | Manual UPI with per-order dynamic QR (`qrcode`), UTR claims |
| API        | Route Handlers with a standard `{ ok, data\|error }` envelope |
| Rate limit | In-memory or Upstash Redis, per-endpoint config     |
| Security   | Edge security proxy (CSP + cross-origin write guard), hardening headers |
| Tests      | Vitest (unit), Playwright (E2E), ESLint, `tsc`      |

## Getting started

```bash
cp .env.example .env.local   # fill in real values — never commit secrets
npm install
npm run dev                  # http://localhost:3000
```

| Command           | Purpose                              |
| ----------------- | ------------------------------------ |
| `npm run dev`     | Start the development server         |
| `npm run build`   | Production build                     |
| `npm run lint`    | ESLint                               |
| `npm run typecheck` | Strict TypeScript check            |
| `npm test`        | Vitest unit tests (single run)       |
| `npm run test:e2e` | Playwright E2E (requires dev server)|

Health check: `GET /api/health` → `{ ok: true, data: { status: "ok", … } }`.
Readiness: `GET /api/ready` reports configuration/environment issues.

### Environment

`.env.example` lists every variable by name only — no real values. Copy it to
`.env.local` and fill in actual credentials. Key groups:

- **Public:** `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **Server-only:** `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, owner UPI config, GST/seller block, invoice prefix, bank details, signatory
- **Rate limiting:** per-endpoint RPM limits + `RATE_LIMIT_BACKEND` (memory or Upstash)
- **Ops:** `BUSINESS_TIMEZONE`, `PAYMENT_WINDOW_HOURS`

Full per-environment matrix: `docs/operations/environment-variables.md`.

## Project structure

```text
app/                  homepage, /products/[slug], /cart, /checkout,
                      /orders/[id] (guest tracking), /orders/[id]/pay,
                      /api (health, delivery, orders, payments, coupons,
                      admin, invoices, quotations, shipments, settings)
app/admin/(protected) command center, products, customers, orders, coupons,
                      deliveries, shipments, settings + login
components/ui         Button, Input, Select, Card, Badge, Alert, Modal,
                      Dropdown, Toast, Skeleton, Breadcrumbs,
                      QuantitySelector, PriceDisplay, StatusBadge, ProductImage
components/layout     Navbar, Footer, SiteShell + admin shell
components/home       Hero, ProofBand, TrustSection, VideoShowcase,
                      FeaturedProducts, ContactCTA
components/products   ProductCard, ProductGrid, CategoryFilter, FilterBar,
                      Pagination, ProductGallery, RelatedProducts
components/cart       CartView, CartProvider, AddToCartButton
components/checkout   CheckoutForm
components/payments   ClaimForm, payment provider
components/orders      OrderActions, GuestKeyExchange
components/admin      ProductForm, CustomerForm, SettingsForm, StockCell,
                      ActiveToggle, DeleteOrderButton, StatusActions,
                      PaymentActions, ShipmentActions, DocumentActions,
                      BulkImportDialog, NotesSection
lib/supabase          browser / RLS-server / service-role (server-only) clients
lib/auth              session + admin gates
lib/catalog           catalogue types, params, live queries + static fallback
lib/coupons           redeem-code validation + redemption
lib/settings          site settings (UPI id, payee name, invoice prefix, …)
lib/validations       pincode / GSTIN / phone / email
lib/delivery          pincode serviceability + rate resolution (server-side)
lib/orders            integer-paise money helpers, creation, events, transitions
lib/payments          UPI config, per-order dynamic QR intent, claims, proofs
lib/invoices          invoice data, PDF generation, numbering, tax integrity
lib/quotations        quotation data, PDF, numbering, config
lib/documents         document availability rules
lib/shipments         shipment service + types
lib/storage           product images + payment-proof storage helpers
lib/tax               GST computation (inclusive pricing, state split)
lib/rate-limit        in-memory + Upstash distributed rate limiting
lib/notifications     email transport (Gmail SMTP) + order notification copy
lib/observability     correlation IDs, structured logging, reference
lib/admin             orders, products, customers, delivery, import/export,
                      dashboard, audit, notes, order-documents
proxy.ts              edge security proxy: CSP + cross-origin write guard
supabase/migrations   0001–0040: schema, RLS, hardening, search, orders,
                      payments, invoices, inventory, delivery rules, bulk ops,
                      shipments, staff notes, guest tokens, quotations, HSN,
                      payment proofs, shipping address, coupons, site settings,
                      product images
supabase/seed         deterministic dev data (partners, products, rates)
types/                domain, API envelope, database rows
tests/                52 files / 927 tests — validations, pricing, catalogue,
                      cart, checkout, orders, payments, coupons, invoices,
                      quotations, shipments, admin, security proxy, rate
                      limits, guest access, migrations, config
```

## Database

- **21 active tables** (23 created across migrations; 2 WhatsApp tables
  dropped in `0009`): `profiles`, `customers`, `products`,
  `delivery_partners`, `delivery_pincode_rates`, `orders`, `order_items`,
  `payments`, `order_events`, `invoices`, `stock_reservations`,
  `inventory_events`, `delivery_weight_slabs`, `delivery_category_rules`,
  `admin_audit_log`, `shipments`, `staff_notes`, `order_access_tokens`,
  `quotations`, `coupons`, `site_settings`.
- **40 migrations** (`0001`–`0040`) — applied via `supabase db push`.
- **Money** is `NUMERIC(12,2)`; the app works in integer paise.
- **History is immutable**: orders snapshot totals/GSTIN/partner name/shipping
  address, items snapshot name/price — DB CHECKs enforce
  `total = subtotal + delivery` and `line_total = qty × price`.
- **Order numbers** are display-only (`TS-YYMMDD-SEQ`); UUIDs are the
  primary keys.
- **Invoice numbers** use a financial-year format (`PREFIX/FY-YY/SEQ`), with
  per-invoice GST snapshot freezing.
- **UTR uniqueness**: a partial unique index on `payments.transaction_reference`
  rejects duplicate references at the database level.
- **RLS**: public reads only active products/partners/rates; orders and
  payments are admin + service-role only; guest order access uses per-order
  tokens.

```bash
supabase db push                                     # apply migrations
psql "$SUPABASE_DB_URL" -f supabase/seed/seed.sql    # dev data only
```

## Customer journey

1. **Browse** — glassmorphism homepage with hero, proof band and a
   product-video showcase; `/products` grid with search/filter/sort; product
   detail pages with gallery, specifications and related products.
2. **Cart** — add/remove/update quantities; optional GSTIN, required pincode;
   redeem codes apply server-validated discounts.
3. **Checkout** — customer details + delivery pincode + shipping address;
   server re-validates serviceability, delivery rules and recomputes totals;
   order created with status `pending_payment`.
4. **Payment** — `/orders/[id]/pay` renders a per-order UPI QR encoding the
   exact total and order number; the customer pays, then submits the UTR
   reference (and optional screenshot) as a claim; an admin verifies it in
   the dashboard and marks the order `paid`. Invoices become available once paid.
5. **Documents** — GST invoice PDF (with QR) and provisional quotation PDF.
6. **Tracking** — guest token (set at order creation) grants read-only access
   to order status and timeline.

## Admin dashboard

Authenticated via Supabase Auth (`profiles.is_admin`). The command center
shows attention queues (payment claims, newly confirmed orders, dispatch,
delayed shipments, low stock, failed payments), today's operations, business
summary and the recent-orders table with inline delete. Dedicated pages manage:

- **Products** — full CRUD with edit of name, slug, description, price,
  specifications (JSON), image paths, GST rate, shipping weight, HSN code,
  stock (reserve-aware quick edit), low-stock threshold and active toggle;
  inventory alerts; bulk CSV import/export; recent bulk-operations audit.
- **Orders** — searchable/filterable/sortable list; detail with status
  transitions, payment verification, invoice + quotation downloads, staff
  notes, shipment tracking and a delete action (guarded: dispatched/delivered
  orders are permanent; deletion restores held/sold stock and writes to the
  audit log).
- **Payments** — verification inbox for submitted UTR claims with proof
  screenshot streaming; approve → paid/confirmed, reject → failed.
- **Coupons** — redeem-code management.
- **Customers** — list + detail with order history and aggregates.
- **Delivery** — partners, pincode rates, weight slabs, category rules.
- **Shipments** — create and track shipments against orders.
- **Settings** — UPI id/payee name, invoice prefix, business email and other
  site settings (validated, DB-backed with env fallbacks).

## Security model

- Service-role key and UPI config are **server-only**
  (`server-only` import = build error if ever bundled client-side).
- Prices, charges and totals are **recomputed server-side**; browser values
  are never trusted. No client-side payment verification.
- **Per-order dynamic UPI QR** embeds the frozen total and order number —
  customers cannot underpay by editing the amount.
- **UTR claims** are format-validated (6–30 alphanumerics), deduplicated by a
  DB unique index, lifecycle-gated (legal transitions only), IDOR-guarded
  (claimant must know the order's customer mobile) and optimistic-concurrency
  checked. Payment screenshots are magic-byte sniffed, size-capped and served
  from a private bucket, admin-only.
- **Edge security proxy** (`proxy.ts`): baseline Content-Security-Policy
  pinned to first-party origin (`frame-ancestors 'none'`, `object-src 'none'`,
  no third-party scripts) plus a cross-origin write guard — API mutations
  whose `Origin`/`Referer`/`Sec-Fetch-Site` contradict the site's own origin
  are rejected 403 before auth or the database is touched.
- **Hardening headers**: HSTS (preload), `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy`, locked-down `Permissions-Policy`; `/admin` is noindexed
  and disallowed in `robots.txt`.
- **Rate limiting** on all endpoints with per-category budgets; financial
  mutations fail **closed** (429) when the shared backend is unavailable;
  Upstash Redis shares one budget across instances.
- **Reserve-aware inventory**: checkout holds stock, verification consumes it,
  cancellation/deletion restores it — exactly-once via DB RPCs gated on
  `orders.stock_state`.
- **Append-only audit trails**: `order_events` for every order mutation and
  `admin_audit_log` for high-impact admin operations.
- **Admin safety**: Supabase Auth + `profiles.is_admin` (writable only via
  service role), RLS policies on every table, admin rate limits, dispatched/
  delivered orders are delete-protected, guarded (optimistic-concurrency)
  updates on every mutation.
- **Guest order access** uses per-order tokens; no session required for
  customers to track orders.
- **Structured logging** with correlation IDs for request tracing — no IPs,
  tokens or keys in logs.

## Deployment

- **Hosting:** Vercel, connected to this GitHub repo — every push to `main`
  auto-deploys to production.
- **Database:** Supabase (Sydney region) — migrations in `supabase/migrations`
  applied with `supabase db push`; secrets live in Vercel environment
  variables only.
- **Live URL:** https://troliftsolutions.vercel.app/

## Roadmap

- [x] Foundation (architecture, conventions, homepage shell)
- [x] Database (schema, RLS, seed, live-Postgres validated)
- [x] Design system (industrial UI kit, responsive homepage)
- [x] Foundation audit (tests, hardening)
- [x] Product catalogue + product pages + search
- [x] Cart (GSTIN optional, pincode mandatory)
- [x] Checkout with pincode serviceability + delivery calculation
- [x] UPI payment claims + manual admin verification (server-side)
- [x] Order management + admin dashboard CRUD
- [x] Invoices (PDF, numbering, tax integrity)
- [x] Quotations (PDF, provisional → frozen lifecycle)
- [x] Shipments (create, track, milestones)
- [x] Rate limiting (in-memory + Upstash)
- [x] Bulk import/export (products + delivery rates)
- [x] Redeem codes (coupons) + site settings
- [x] Glassmorphism homepage + product video showcase
- [x] Admin order deletion with stock restore + audit
- [x] Security hardening: CSP proxy, cross-origin write guard, HSTS headers
- [ ] Payment-gateway PSP integration (server-to-server webhooks, auto-verification)
- [ ] Customer accounts portal (order history without guest tokens)
- [ ] WhatsApp order notifications
- [ ] Analytics dashboards (sales trends, stock forecasting)

---

Built with Next.js, Supabase, PDFKit and TypeScript. GST invoice on every
paid order.
