import { expect, test, type Page } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  adminLogin,
  asStoredPhone,
  cleanupRun,
  createFixtureOrder,
  loadIdentities,
  seedProductId,
  serviceHeaders,
  supabaseRest,
  mustBase,
  trackPhone,
  trackedProductIds,
  uniquePhone,
  uniqueUtr,
} from "./helpers";

/**
 * STAGING failure/retry journeys (live backend, disposable).
 *
 * Duplicate submission, refresh persistence, stale carts, mid-checkout
 * price moves, unserviceable pincodes, double claims, illegal
 * transitions, session expiry + recovery, and retry-after-failure —
 * asserted against both rendered UI and persisted backend rows.
 * Final cleanup (own fixtures + the shared journey order) runs here.
 */

async function countOrdersByPhone(phone: string): Promise<number> {
  const headers = serviceHeaders();
  const stored = asStoredPhone(phone);
  const custRes = await fetch(
    `${supabaseRest()}/customers?phone=eq.${encodeURIComponent(stored)}&select=id`,
    { headers },
  );
  const custs = (await custRes.json()) as Array<{ id: string }>;
  let n = 0;
  for (const c of custs) {
    const oRes = await fetch(`${supabaseRest()}/orders?customer_id=eq.${c.id}&select=id`, { headers });
    n += ((await oRes.json()) as Array<unknown>).length;
  }
  return n;
}

async function fillCheckout(page: Page, phone: string, pincode: string) {
  await page.getByLabel("Full name").fill("STGE2E Retry");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByLabel("Delivery Pincode").fill(pincode);
  await page.getByRole("button", { name: /check delivery/i }).click();
}

test.describe("staging failure journeys", () => {
  test.afterAll(async () => {
    // Final sweep: own fixtures plus the shared customer-journey order,
    // which every other cleanup deliberately leaves in place.
    await cleanupRun({ includeJourney: true });
  });

  test("duplicate rapid submissions create exactly one order", async ({ page }) => {
    const phone = trackPhone(uniquePhone());
    await page.goto("/products/tmst-300");
    await page.getByRole("button", { name: "Add to Cart" }).first().click();
    await page.goto("/checkout");
    await fillCheckout(page, phone, "400001");
    await expect(page.getByText(/delivery available/i)).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /place order/i }).dblclick();
    await expect(page.getByText(/^order placed$/i)).toBeVisible({ timeout: 30_000 });
    expect(await countOrdersByPhone(phone)).toBe(1);
  });

  test("reopening the authorized order survives refresh, once", async ({ page }) => {
    // The checkout confirmation is client state (correctly ephemeral);
    // the ORDER session (HttpOnly cookie) is what must survive refresh.
    const phone = trackPhone(uniquePhone());
    await page.goto("/products/tmst-300");
    await page.getByRole("button", { name: "Add to Cart" }).first().click();
    await page.goto("/checkout");
    await fillCheckout(page, phone, "400001");
    await expect(page.getByText(/delivery available/i).first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /place order/i }).click();
    await expect(page.getByText(/^order placed$/i)).toBeVisible({ timeout: 30_000 });
    const payHref = await page.getByRole("link", { name: /pay now/i }).getAttribute("href");
    const orderId = payHref!.split("/")[2]!;
    await page.goto(`/orders/${orderId}`);
    await expect(page.getByRole("heading", { name: /order TS-/i })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: /order TS-/i })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: /order TS-/i })).toBeVisible();
    expect(await countOrdersByPhone(phone)).toBe(1);
  });

  test("stale cart (over-stock quantity) names the item, creates nothing", async ({ page }) => {
    const phone = trackPhone(uniquePhone());
    await page.goto("/products/tmst-300");
    await page.getByRole("button", { name: "Add to Cart" }).first().click();
    await page.goto("/cart");
    // Seed stock is 120: requesting 999 must fail safe server-side.
    await page.getByRole("spinbutton", { name: /quantity for/i }).fill("999");
    await page.goto("/checkout");
    await fillCheckout(page, phone, "400001");
    await expect(page.getByText(/delivery available/i).first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /place order/i }).click();
    await expect(page.getByText(/trolley/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/checkout/);
    expect(await countOrdersByPhone(phone)).toBe(0);
  });

  test("mid-checkout price moves are repriced server-side", async ({ page }) => {
    const slug = `stge2e-price-${Date.now().toString(36)}`;
    const created = await fetch(`${supabaseRest()}/products`, {
      method: "POST",
      headers: { ...serviceHeaders(), Prefer: "return=representation" },
      body: JSON.stringify({
        name: "STGE2E Price Probe",
        slug,
        category: "STGE2E",
        price: "100.00",
        stock_quantity: 50,
        is_active: true,
      }),
    });
    const rows = (await created.json()) as Array<{ id: string }>;
    trackedProductIds.push(rows[0]!.id);
    const phone = trackPhone(uniquePhone());

    await page.goto(`/products/${slug}`);
    await page.getByRole("button", { name: "Add to Cart" }).first().click();
    // Price moves after the cart snapshot: browser figures are ignored.
    await fetch(`${supabaseRest()}/products?id=eq.${rows[0]!.id}`, {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ price: "200.00" }),
    });
    await page.goto("/checkout");
    await fillCheckout(page, phone, "400001");
    await expect(page.getByText(/delivery available/i).first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /place order/i }).click();
    // Surface server-side failures in the assertion output instead of
    // timing out on the success text alone.
    const placed = page.getByText(/^order placed$/i);
    const placeFailed = page.getByText("Could not place the order", { exact: true });
    await expect(placed.or(placeFailed)).toBeVisible({ timeout: 30_000 });
    await expect(placed).toBeVisible();
    // Backend proof: the frozen line total uses the NEW price.
    const items = (await (
      await fetch(
        `${supabaseRest()}/order_items?product_name=eq.${encodeURIComponent("STGE2E Price Probe")}&select=line_total`,
        { headers: serviceHeaders() },
      )
    ).json()) as Array<{ line_total: string | number }>;
    expect(items.length).toBeGreaterThan(0);
    // PostgREST serializes numeric columns as JSON numbers, so compare
    // numerically — a string-only assertion throws instead of failing.
    expect(Number(items[0]!.line_total)).toBe(200);
  });

  test("unserviceable pincode blocks before any order", async ({ page }) => {
    const phone = trackPhone(uniquePhone());
    await page.goto("/products/tmst-300");
    await page.getByRole("button", { name: "Add to Cart" }).first().click();
    await page.goto("/checkout");
    await fillCheckout(page, phone, "799001");
    await expect(page.getByText(/delivery unavailable/i)).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /place order/i }).click();
    await expect(page).toHaveURL(/\/checkout/);
    await expect(page.getByText(/TS-\d{6}/)).toHaveCount(0);
    expect(await countOrdersByPhone(phone)).toBe(0);
  });

  test("a duplicate UTR claim is a conflict; a fresh UTR retries clean", async ({
    page,
    baseURL,
  }) => {
    const phone = trackPhone(uniquePhone());
    const created = await createFixtureOrder(page.request, mustBase(baseURL), {
      productId: await seedProductId(),
      quantity: 1,
      phone,
    });
    const claimAs = (orderId: string, claimPhone: string, reference: string, accessToken?: string) =>
      page.request.post(`${baseURL}/api/payments/claim`, {
        data: { orderId, reference, phone: claimPhone, ...(accessToken ? { accessToken } : {}) },
      });
    // First claim through the RENDERED form (cookie session authorizes).
    await page.goto(`/orders/${created.id}/pay`);
    await page.getByLabel(/order mobile number/i).fill(phone);
    const utr = uniqueUtr();
    await page.getByLabel(/utr number/i).fill(utr);
    await page.getByRole("button", { name: /submit reference/i }).click();
    await expect(page.getByText(/payment submitted for verification/i)).toBeVisible({ timeout: 20_000 });
    // Same UTR again (same session) → conflict, order untouched.
    const dup = await claimAs(created.id, phone, utr, created.token);
    expect(dup.status()).toBe(409);
    await page.reload();
    await expect(page.getByText(/payment under verification/i)).toBeVisible({ timeout: 20_000 });
    // Retry path stays healthy: a fresh UTR on a fresh order succeeds.
    const retryPhone = trackPhone(uniquePhone());
    const retry = await createFixtureOrder(page.request, mustBase(baseURL), {
      productId: await seedProductId(),
      quantity: 1,
      phone: retryPhone,
    });
    const retryRes = await claimAs(retry.id, retryPhone, uniqueUtr(), retry.token);
    expect(retryRes.status()).toBe(200);
  });

  test("illegal admin transitions are rejected (409), not applied", async ({
    page,
    baseURL,
  }) => {
    const ids = await loadIdentities();
    await adminLogin(page, ids);
    const phone = trackPhone(uniquePhone());
    const created = await createFixtureOrder(page.request, mustBase(baseURL), {
      productId: await seedProductId(),
      quantity: 1,
      phone,
    });
    const res = await page.request.post("/api/admin/orders/status", {
      data: { orderId: created.id, toStatus: "delivered" },
    });
    expect(res.status()).toBe(409);
    await page.goto(`/admin/orders/${created.id}`);
    await expect(page.getByText("Payment pending").first()).toBeVisible();
  });

  test("expired sessions fail closed, recovery restores access", async ({
    page,
    baseURL,
  }) => {
    const phone = trackPhone(uniquePhone());
    const created = await createFixtureOrder(page.request, mustBase(baseURL), {
      productId: await seedProductId(),
      quantity: 1,
      phone,
    });
    await page.goto(`/orders/${created.id}`);
    // Scoped to the heading: the order number also appears in the
    // breadcrumb, the title tag and the tracking copy.
    await expect(
      page.getByRole("heading", { name: new RegExp(created.orderNumber) }),
    ).toBeVisible();
    // Lose the session entirely.
    await page.context().clearCookies();
    await page.goto(`/orders/${created.id}`);
    await expect(page.getByRole("heading", { name: /page not found/i })).toBeVisible();
    // Recover with order number + mobile (no inbox, no oracle).
    await page.goto("/orders/recover");
    await page.getByLabel(/order number/i).fill(created.orderNumber);
    await page.getByLabel(/mobile number/i).fill(phone);
    await page.getByRole("button", { name: /restore access/i }).click();
    await expect(page.getByRole("link", { name: /view my order/i })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("link", { name: /view my order/i }).click();
    await expect(page.getByRole("heading", { name: `Order ${created.orderNumber}` })).toBeVisible();
  });

  test("delivered journey order shows tracking and a real invoice", async ({ page }) => {
    const raw = await fs.readFile(path.join(__dirname, ".auth", "journey.json"), "utf8");
    const journey = JSON.parse(raw) as { orderId: string; orderNumber: string; phone: string };
    await page.goto("/orders/recover");
    await page.getByLabel(/order number/i).fill(journey.orderNumber);
    await page.getByLabel(/mobile number/i).fill(journey.phone);
    await page.getByRole("button", { name: /restore access/i }).click();
    const restored = page.getByRole("link", { name: /view my order/i });
    const rejected = page.getByRole("alert");
    await expect(restored.or(rejected)).toBeVisible({ timeout: 20_000 });
    await expect(restored).toBeVisible();
    await page.getByRole("link", { name: /view my order/i }).click();
    await expect(page.getByText(/STGE2E/).first()).toBeVisible();
    await expect(page.getByText("Delivered").first()).toBeVisible();
    const [dl] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      page.getByRole("link", { name: /download invoice/i }).click(),
    ]);
    const pdfPath = await dl.path();
    expect((await fs.readFile(pdfPath!)).subarray(0, 4).toString()).toBe("%PDF");
  });

  test.skip("backend outage mid-operation degrades honestly (BLOCKED)", async () => {
    // BLOCKED, not passed: killing the disposable database container
    // mid-run (docker stop supabase_db_*) would destabilize the shared
    // stack for the whole suite and risk an unrecoverable run if the
    // restart flaps. Server-error mapping itself is unit-covered
    // (tests/error-handling.test.ts) and every live failure above
    // (422/409/404) rendered an honest, non-leaking UI state.
  });
});


