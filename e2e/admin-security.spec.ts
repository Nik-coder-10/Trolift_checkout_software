import { expect, test } from "@playwright/test";

/**
 * Security posture at the browser boundary: unauthenticated visitors
 * cannot see admin UI, guest order URLs fail closed, and protected
 * APIs reject anonymous callers. Deeper authorization is proven in
 * tests/security.test.ts and the HTTP journey in tests/journey.test.ts.
 */
test.describe("admin and access control", () => {
  test("/admin never renders admin UI to anonymous visitors", async ({
    page,
  }) => {
    await page.goto("/admin");
    // With a backend: proxy redirects to /admin/login. Without one
    // (this harness), the protected layout renders an inline gate.
    // Either way, no admin content may appear.
    await expect(
      page
        .getByRole("heading", { name: /sign in(required)?/i })
        .first(),
    ).toBeVisible();
    await expect(page.getByText(/command center|needs attention/i)).toHaveCount(0);
    await expect(page.getByText(/dashboard/i)).toHaveCount(0);
  });

  test("command center queue filters reject anonymous deep links", async ({
    page,
  }) => {
    await page.goto("/admin/orders?payment=submitted");
    await expect(
      page
        .getByRole("heading", { name: /sign in(required)?/i })
        .first(),
    ).toBeVisible();
    await expect(page.getByText(/TS-\d/i)).toHaveCount(0);
  });

  test("login page renders email/password form", async ({ page }) => {
    await page.goto("/admin/login");
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /sign in/i }),
    ).toBeVisible();
  });

  test("unknown order UUID renders not-found, not data", async ({ page }) => {
    await page.goto("/orders/123e4567-e89b-12d3-a456-426614174000");
    // Fail closed and observable: the not-found UI appears and no
    // order details leak (no order number, totals, or timeline).
    await expect(
      page.getByRole("heading", { name: /page not found/i }),
    ).toBeVisible();
    await expect(page.getByText(/TS-\d/i)).toHaveCount(0);
  });

  test("malformed order id does not crash or leak", async ({ page }) => {
    await page.goto("/orders/not-a-uuid");
    await expect(
      page.getByRole("heading", { name: /page not found/i }),
    ).toBeVisible();
  });

  test("admin APIs reject anonymous callers", async ({ request }) => {
    for (const url of [
      "/api/admin/products",
      "/api/admin/orders",
      "/api/admin/customers",
      "/api/admin/export/products",
      "/api/admin/notes",
      "/api/admin/coupons",
    ]) {
      const res = await request.get(url);
      expect(res.status(), url).toBe(401);
    }
  });

  test("redeem-code management rejects anonymous writes", async ({ request }) => {
    const uuid = "123e4567-e89b-42d3-a456-426614174000";
    const created = await request.post("/api/admin/coupons", {
      data: { code: "GUEST100", discountRupees: 100 },
    });
    expect(created.status()).toBe(401);
    const patched = await request.patch(`/api/admin/coupons/${uuid}`, {
      data: { code: "GUEST100", discountRupees: 100, isActive: false },
    });
    expect(patched.status()).toBe(401);
  });

  test("staff notes API denies anonymous reads, writes and edits", async ({
    request,
  }) => {
    const uuid = "123e4567-e89b-42d3-a456-426614174000";
    // Authorization is checked before entity validation: an
    // unsupported entity type leaks nothing to a guest either.
    const results = [
      await request.get(`/api/admin/notes?entityType=order&entityId=${uuid}`),
      await request.get(
        `/api/admin/notes?entityType=admin_audit_log&entityId=${uuid}`,
      ),
      await request.post("/api/admin/notes", {
        data: { entityType: "order", entityId: uuid, body: "x" },
      }),
      await request.patch("/api/admin/notes", {
        data: { noteId: uuid, body: "x" },
      }),
      await request.delete(`/api/admin/notes?id=${uuid}`),
    ];
    for (const res of results) {
      expect(res.status()).toBe(401);
    }
  });

  test("customer order tracking never shows internal staff notes", async ({
    page,
  }) => {
    await page.goto("/orders/123e4567-e89b-12d3-a456-426614174000");
    await expect(page.getByText(/internal notes/i)).toHaveCount(0);
    await expect(page.getByText(/staff-only/i)).toHaveCount(0);
  });

  test("public APIs stay reachable without a session", async ({
    request,
  }) => {
    const health = await request.get("/api/health");
    expect(health.status()).toBe(200);
  });

  test("cross-origin mutations are rejected at the API edge", async ({
    request,
  }) => {
    // Cookie-authenticated writes must not be drivable from another
    // origin, even with credentials attached by the browser.
    const res = await request.post("/api/admin/products", {
      headers: { Origin: "https://evil.example" },
      data: { name: "csrf attempt" },
    });
    expect(res.status()).toBe(403);
  });

  test("robots.txt and sitemap.xml are served", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    const robotsText = await robots.text();
    expect(robotsText).toContain("Sitemap:");
    expect(robotsText).toContain("/admin");

    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    const xml = await sitemap.text();
    expect(xml).toContain("/products");
    // Capability URLs and admin surfaces must never be listed.
    expect(xml).not.toContain("/orders/");
    expect(xml).not.toContain("/admin/");
  });
});
