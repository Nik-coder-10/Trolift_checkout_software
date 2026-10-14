# Trolift Solutions — B2B Ordering Platform

Industrial material-handling equipment, ordered simply. A production-oriented
**Next.js + Supabase** platform for browsing equipment, ordering by pincode
with automated delivery calculation, and paying on UPI — with an admin
backend for products, customers, orders, payments, invoices, quotations and
shipments.

> **Status:** implemented locally — catalogue, search, cart, checkout, orders,
> UPI payment claims, invoices, quotations, shipments and the admin dashboard
> are all built and covered by unit tests. Managed-staging verification and
> production deployment are separate gates (see below).

---

## What is this?

Trolift Solutions sells warehouses and workshops what they run on: hydraulic
pallet trucks, stackers, scissor tables, trolleys, drum handlers, dock
levelers and more. This platform lets B2B customers:

- Browse equipment with transparent, ex-GST pricing
- Search, filter and sort the catalogue to find the right machine
- Check delivery serviceability by pincode *before* paying
- See automated delivery charges per partner
- Pay the owner directly over UPI, then submit the UTR reference — the
  claim is validated server-side (authoritative total, VPA shape) and an
  admin manually verifies it before the order is marked paid. There is no
  automatic bank/UPI settlement.
- Track order status via a token-linked guest view

…and lets Trolift staff manage everything from an authenticated admin
dashboard: products, customers, orders, payments, delivery partners/rates,
invoices, quotations and shipments.

## Tech stack

| Layer      | Choice                                              |
| ---------- | --------------------------------------------------- |
| Framework  | Next.js 16 (App Router) + React 19 + TypeScript     |
| Styling    | Tailwind CSS v4, industrial navy/amber design system|
| Database   | PostgreSQL via Supabase, UUID keys, RLS everywhere  |
| Search     | `pg_trgm` + `search_products()` RPC (no extra infra)|
| Auth       | Supabase Auth (`profiles.is_admin` for admin gates) |
| Documents  | PDFKit (invoices + quotations), QR codes on invoices |
| API        | Route Handlers with a standard `{ ok, data\|error }` envelope |
| Rate limit | In-memory or Upstash Redis, per-endpoint config     |
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
                      /api (health, delivery, orders, payments, admin,
                      invoices, quotations, shipments)
app/admin/(protected) command center, products, customers, orders,
                      deliveries, shipments + login
components/ui         Button, Input, Select, Card, Badge, Alert, Modal,
                      Dropdown, Toast, Skeleton, Breadcrumbs,
                      QuantitySelector, PriceDisplay, StatusBadge, ProductImage
components/layout     Navbar, Footer, SiteShell + admin shell
components/products   ProductCard, ProductGrid, CategoryFilter, FilterBar,
                      Pagination, ProductGallery, RelatedProducts
components/cart       CartView, CartProvider, AddToCartButton
components/checkout   CheckoutForm
components/payments   ClaimForm, payment provider
components/orders      OrderActions, GuestKeyExchange
components/admin      DocumentActions, PaymentActions, StatusActions,
                      BulkImportDialog, NotesSection
lib/supabase          browser / RLS-server / service-role (server-only) clients
lib/auth              session + admin gates
lib/catalog           catalogue types, params, live queries + static fallback
lib/validations       pincode / GSTIN / phone / email
lib/delivery          pincode serviceability read (server-side)
lib/orders            integer-paise money helpers, creation, events, transitions
lib/payments          UPI config, claims, provider, order access
lib/invoices          invoice data, PDF generation, numbering, tax integrity
lib/quotations       quotation data, PDF, numbering, config
lib/documents         document availability rules
lib/shipments         shipment service + types
lib/rate-limit        in-memory + Upstash distributed rate limiting
lib/observability     correlation IDs, structured logging, reference
lib/admin             orders, products, customers, delivery, import/export,
                      dashboard, audit, notes, order-documents
supabase/migrations   0001–0032: schema, RLS, hardening, search, orders,
                      payments, invoices, inventory, delivery rules, bulk ops,
                      shipments, staff notes, guest tokens, quotations, HSN
supabase/seed         deterministic dev data (partners, products, rates)
types/                domain, API envelope, database rows
tests/                43 files — unit tests covering validations, pricing,
                      catalogue, cart, checkout, orders, payments, invoices,
                      quotations, shipments, admin, security, rate limits,
                      guest access, migrations, config
```

## Database

- **19 active tables** (21 created across migrations; 2 WhatsApp tables
  dropped in `0009`): `profiles`, `customers`, `products`,
  `delivery_partners`, `delivery_pincode_rates`, `orders`, `order_items`,
  `payments`, `order_events`, `invoices`, `stock_reservations`,
  `inventory_events`, `delivery_weight_slabs`, `delivery_category_rules`,
  `admin_audit_log`, `shipments`, `staff_notes`, `order_access_tokens`,
  `quotations`.
- **32 migrations** (`0001`–`0032`) — applied via `supabase db push`.
- **Money** is `NUMERIC(12,2)`; the app works in integer paise.
- **History is immutable**: orders snapshot totals/GSTIN/partner name, items
  snapshot name/price — DB CHECKs enforce `total = subtotal + delivery` and
  `line_total = qty × price`.
- **Order numbers** are display-only (`TS-YYMMDD-SEQ`); UUIDs are the
  primary keys.
- **Invoice numbers** use a financial-year format (`PREFIX/FY-YY/SEQ`), with
  per-invoice GST snapshot freezing.
- **RLS**: public reads only active products/partners/rates; orders and
  payments are admin + service-role only; guest order access uses per-order
  tokens.

```bash
supabase db push                                     # apply migrations
psql "$SUPABASE_DB_URL" -f supabase/seed/seed.sql    # dev data only
```

## Customer journey

1. **Browse** — homepage, `/products` grid with search/filter/sort, product
   detail pages with gallery and related products.
2. **Cart** — add/remove/update quantities; GSTIN optional, pincode required
   at checkout.
3. **Checkout** — customer details + delivery pincode; server re-validates
   serviceability and recomputes totals; order created with status
   `pending_payment`.
4. **Payment** — customer submits UPI payment on `/orders/[id]/pay`; admin
   verifies and marks the order `paid`. Invoices become available once paid.
5. **Tracking** — guest token (set at order creation) grants read-only access
   to order status and timeline.

## Admin dashboard

Authenticated via Supabase Auth (`profiles.is_admin`). The command center
shows order/payment/recent-audit summaries. Dedicated pages manage:

- **Products** — CRUD, active/inactive toggle, bulk CSV import/export
- **Customers** — list + detail with order history and aggregates
- **Orders** — list + detail with status/payment transitions, invoice and
  quotation downloads (PDF), staff notes, shipment tracking
- **Delivery** — partners, pincode rates, weight slabs, category rules
- **Shipments** — create and track shipments against orders
- **Payments** — verify submitted UPI claims

## Security model

- Service-role key and UPI config are **server-only**
  (`server-only` import = build error if ever bundled client-side).
- Prices, charges and totals are **recomputed server-side**; browser values
  are never trusted. No client-side payment verification.
- Secrets stay in server environment variables, never in tables.
- **Rate limiting** on all mutating endpoints (orders, claims, imports,
  invoices, admin auth); in-memory by default, Upstash Redis for multi-instance.
- **Guest order access** uses per-order tokens; no session required for
  customers to track orders.
- **CSRF protection** on mutating API routes.
- **Structured logging** with correlation IDs for request tracing.

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

---

### Local vs staging vs production

| Layer          | Status                                                |
| -------------- | ----------------------------------------------------- |
| Local code     | Implemented, lint/typecheck/build/test passing         |
| Managed staging| Separate verification gate — not part of local testing |
| Production     | Owner decision — requires staging validation + config  |

Local test results are **not** a signal of staging or production readiness.
Managed-staging E2E requires its own environment, credentials and CI pipeline.

---

Built with Next.js, Supabase, PDFKit and TypeScript. GST invoice on every
paid order.
