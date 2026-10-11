# Production smoke-test checklist

Run after every production deploy and after every production
migration (migrations.md step 7). Each item names the check and the
pass signal. Use a controlled test transaction: one order on a real
product with a nominal quantity, using the store's own authorized
test procedure. **Never claim a real payment succeeded without
verifying it through the actual authorized payment process** — for
UPI that means the owner confirms the credit in their bank/UPI app
against the exact test UTR, and payment verification is then run in
the admin dashboard.

Baseline: the staging E2E suite (40 passed / 2 skipped on Desktop
Chrome + Pixel 7) already proves these journeys end-to-end on
staging. This checklist re-proves the *production* environment's
configuration, data, and integrations — it is not optional because
staging passed.

## 1. Platform health

- [ ] `GET /api/health` → 200 `{ status: "ok" }`.
- [ ] `GET /api/ready` → 200, `checks.database.status = "ok"` AND
      `checks.config.status = "ok"`. A 503 here names missing
      critical config (UPI, invoice identity, rate-limit store) —
      fix before anything below.
- [ ] `robots.txt` serves disallow rules for admin/cart/checkout;
      `sitemap.xml` lists product pages.
- [ ] No unexpected `level=error` log lines during the smoke window
      (monitoring.md signals).

## 2. Catalogue & customer data protection

- [ ] `/products` lists the seeded products with images and prices.
- [ ] Product search + price filter return correct results.
- [ ] `/products/[slug]` renders price ex-GST, availability, GSTIN
      field.
- [ ] **Customer data protection**: anonymous browser sees no admin
      UI; calling an admin API without a session returns 401/403;
      `/api/admin/*` returns 401 unauthenticated; a customer's order
      page is only reachable with its guest token (verify a random
      order UUID without token does NOT render).

## 3. Checkout & delivery

- [ ] Add to cart, open checkout; pincode serviceability check
      returns the correct partner + charge for a known-serviced
      pincode and rejects a non-serviced one.
- [ ] Delivery quote on the checkout matches the rate card.
- [ ] Order creation succeeds; order number `TS-…` shown; DB row
      exists with correct totals (total = subtotal + delivery).
- [ ] Inventory: reservation row created; product availability
      reflects it; cancelling the test order restores it.

## 4. Payment (controlled test transaction)

- [ ] Payment page shows the configured owner UPI id + payee name +
      exact amount + QR (scan-verify the VPA string matches
      production `OWNER_UPI_ID`).
- [ ] Submit a test UTR through the customer flow; claim recorded.
- [ ] Admin verifies the payment **after the owner confirms the
      credit through the real UPI app** — only then does
      `payment_status` become `verified`.

## 5. Admin

- [ ] Admin login works (Supabase auth; `profiles.is_admin` gate).
- [ ] Command center loads: today's orders, claims, delayed
      shipments (business timezone boundaries correct).
- [ ] Order list/detail render the test order with correct status.
- [ ] Status transition works (e.g. confirmed → packed) and writes
      an order event.
- [ ] Shipment: mark ready/dispatched; tracking timeline updates.

## 6. Invoice (tax document)

- [ ] Customer invoice download returns a real PDF (starts with
      `%PDF`), seller block = production business identity, GST
      split correct for the test order's state (CGST+SGST vs IGST
      per `TROLIFT_STATE_CODE`).
- [ ] Admin invoice print matches the customer invoice.
- [ ] An invoice for an order with a GSTIN shows line-level GST.

## 7. Data verification & cleanup

- [ ] The test order exists end-to-end: order → items → payment →
      events → invoice, all with consistent money values.
- [ ] Delete or mark the test order per the store's procedure
      (cancelled + note "SMOKE TEST"); do not leave a fake order in
      a `verified` state that could be dispatched.

## 8. Logs & alerts

- [ ] Each smoke step produced correlated log lines with the same
      request id (spot-check one).
- [ ] External uptime check on `/api/ready` is green and was green
      through the deploy window.
- [ ] Trigger-check: one intentional bad request (e.g. POST
      `/api/orders` with empty body) logs a 4xx warn — confirms the
      pipeline is live without faking an outage.

## Recording the result

Append the date, commit SHA, tester, and per-item outcome to the
release report (release-readiness.md). Any failed item downgrades
the classification; only a fully-passed run on the *production*
origin, performed with authorized access, supports
`PRODUCTION VERIFIED`.
