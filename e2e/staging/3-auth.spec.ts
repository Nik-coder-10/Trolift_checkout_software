import { createHash } from "node:crypto";
import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import {
  cleanupRun,
  createFixtureOrder,
  loadIdentities,
  mustBase,
  seedProductId,
  trackPhone,
  uniquePhone,
  userLogin,
} from "./helpers";

/**
 * STAGING authorization journeys (live backend, disposable).
 *
 * Anonymous vs admin surfaces, non-admin boundaries, guest capability
 * matrix (missing/invalid/revoked/foreign-order tokens), unauthorized
 * invoice access, and masked customer PII — all asserted against the
 * rendered browser, never mocks.
 */

function guestCookieName(orderId: string): string {
  return `tl_go_${createHash("sha256").update(orderId).digest("hex").slice(0, 16)}`;
}

function cookieDomain(baseURL: string): string {
  return new URL(baseURL).hostname;
}

async function authedFixture(
  browser: Browser,
  baseURL: string,
): Promise<{ ctx: BrowserContext; orderId: string; orderNumber: string; phone: string; token: string }> {
  const ctx = await browser.newContext();
  const phone = trackPhone(uniquePhone());
  const created = await createFixtureOrder(ctx.request, baseURL, {
    productId: await seedProductId(),
    quantity: 1,
    phone,
  });
  return { ctx, orderId: created.id, orderNumber: created.orderNumber, phone, token: created.token };
}

test.describe("staging authorization", () => {
  test.afterAll(async () => {
    await cleanupRun();
  });

  test("anonymous visitors never reach admin UI or actions", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.getByRole("heading", { name: /staff sign in/i })).toBeVisible();
    await expect(page.getByText(/command center|needs attention/i)).toHaveCount(0);
    await page.goto("/admin/orders");
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("signed-in non-admins are gated from admin pages and APIs", async ({
    page,
  }) => {
    const ids = await loadIdentities();
    await userLogin(page, ids);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
    await expect(page.getByText(/does not have admin access/i)).toBeVisible();
    await expect(page.getByText(/TS-\d{6}/)).toHaveCount(0);
    const res = await page.request.post("/api/admin/orders/fulfillment", {
      data: { orderId: "00000000-0000-4000-8000-000000000000", step: "packed" },
    });
    expect([401, 403]).toContain(res.status());
  });

  test("guest order without a capability renders not-found, not data", async ({
    browser,
    baseURL,
  }) => {
    const seeded = await authedFixture(browser, mustBase(baseURL));
    const fresh = await browser.newContext();
    const anonPage = await fresh.newPage();
    try {
      await anonPage.goto(`/orders/${seeded.orderId}`);
      await expect(anonPage.getByRole("heading", { name: /page not found/i })).toBeVisible();
      await expect(anonPage.getByText(/TS-\d{6}/)).toHaveCount(0);
    } finally {
      await fresh.close();
      await seeded.ctx.close();
    }
  });

  test("invalid capability links fail closed", async ({ browser, baseURL }) => {
    const seeded = await authedFixture(browser, mustBase(baseURL));
    // Fresh context: no cookie, so the bogus key is the only credential.
    const fresh = await browser.newContext();
    const page = await fresh.newPage();
    await page.goto(`/orders/${seeded.orderId}?key=stge2e-bogus-capability-value-0000`);
    await expect(page.getByRole("heading", { name: /page not found/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/TS-\d{6}/)).toHaveCount(0);
    await fresh.close();
    await seeded.ctx.close();
  });

  test("revoked capabilities stop working", async ({ browser, baseURL }) => {
    const seeded = await authedFixture(browser, mustBase(baseURL));
    const { ctx } = seeded;
    const base = mustBase(baseURL);
    const page = await ctx.newPage();
    const name = guestCookieName(seeded.orderId);
    const domain = cookieDomain(base);
    const before = (await ctx.cookies()).find((c) => c.name === name);
    expect(before?.value).toBeTruthy();
    // Rotate through the same authenticated session. page.request does
    // not forward the jar cookie, so authorize explicitly per the
    // documented non-cookie client path.
    const rotated = await ctx.request.post(`${base}/api/orders/${seeded.orderId}/rotate`, {
      headers: { Cookie: `${name}=${seeded.token}` },
    });
    expect(rotated.ok()).toBe(true);
    // The jar now holds the replacement…
    const after = (await ctx.cookies()).find((c) => c.name === name);
    expect(after?.value).toBeTruthy();
    expect(after?.value).not.toBe(before?.value);
    // The replacement works…
    await page.goto(`/orders/${seeded.orderId}`);
    await expect(page.getByRole("heading", { name: `Order ${seeded.orderNumber}` })).toBeVisible();
    // …the old one does not.
    await ctx.addCookies([{ name, value: before!.value, domain, path: "/" }]);
    await page.goto(`/orders/${seeded.orderId}`);
    await expect(page.getByRole("heading", { name: /page not found/i })).toBeVisible();
    await ctx.close();
  });

  test("a capability for one order grants nothing on another", async ({
    browser,
    baseURL,
  }) => {
    const ctx = await browser.newContext();
    const domain = cookieDomain(mustBase(baseURL));
    const productId = await seedProductId();
    const base = mustBase(baseURL);
    const a = await createFixtureOrder(ctx.request, base, {
      productId,
      quantity: 1,
      phone: trackPhone(uniquePhone()),
    });
    const b = await createFixtureOrder(ctx.request, base, {
      productId,
      quantity: 1,
      phone: trackPhone(uniquePhone()),
    });
    const page = await ctx.newPage();
    // Both authorized: A renders.
    await page.goto(`/orders/${a.id}`);
    await expect(page.getByRole("heading", { name: `Order ${a.orderNumber}` })).toBeVisible();
    // Expire ONLY B's cookie → B fails closed while A still renders.
    await ctx.addCookies([
      { name: guestCookieName(b.id), value: "expired", domain, path: "/", expires: 1 },
    ]);
    await page.goto(`/orders/${b.id}`);
    await expect(page.getByRole("heading", { name: /page not found/i })).toBeVisible();
    await page.goto(`/orders/${a.id}`);
    await expect(page.getByRole("heading", { name: `Order ${a.orderNumber}` })).toBeVisible();
    await ctx.close();
  });

  test("unpaid invoices are unreachable and unlinked for guests", async ({
    browser,
    baseURL,
  }) => {
    const seeded = await authedFixture(browser, mustBase(baseURL));
    const page = await seeded.ctx.newPage();
    await page.goto(`/orders/${seeded.orderId}`);
    await expect(page.getByRole("link", { name: /download invoice/i })).toHaveCount(0);
    // Cookie-less request: must fail closed without confirming anything.
    const bare = await browser.newContext();
    try {
      const res = await bare.request.get(`${mustBase(baseURL)}/api/orders/${seeded.orderId}/invoice`);
      expect(res.status()).toBe(404);
    } finally {
      await bare.close();
    }
    await seeded.ctx.close();
  });

  test("guest views mask customer PII", async ({ browser, baseURL }) => {
    const seeded = await authedFixture(browser, mustBase(baseURL));
    const page = await seeded.ctx.newPage();
    await page.goto(`/orders/${seeded.orderId}`);
    await expect(page.getByText(/••••••\d{4}/).first()).toBeVisible();
    expect(await page.content()).not.toContain(seeded.phone);
    await seeded.ctx.close();
  });
});



