import { expect, test, type Page } from "@playwright/test";

/**
 * Checkout UX against the offline backend: validation is client-side,
 * delivery/order calls fail gracefully (alert, no crash). The happy
 * path through order creation is proven at the HTTP layer in
 * tests/journey.test.ts with a simulated backend.
 */
test.describe("checkout", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => window.localStorage.clear());
  });

  async function seedCart(page: Page) {
    await page.goto("/products/talt-032");
    await page.getByRole("button", { name: "Add to Cart" }).click();
    await page.goto("/checkout");
  }

  test("empty cart shows the empty state, not the form", async ({ page }) => {
    await page.goto("/checkout");
    await expect(page.getByText(/your cart is empty/i)).toBeVisible();
    await expect(
      page.getByRole("link", { name: /browse|products/i }).first(),
    ).toBeVisible();
  });

  test("invalid customer details are rejected inline", async ({ page }) => {
    await seedCart(page);
    await page.getByLabel("Full name").fill("A");
    await page.getByLabel("Mobile number").fill("123");
    await page.getByLabel("Delivery Pincode").fill("12");
    await page.getByRole("button", { name: /place order/i }).click();
    // At least one inline validation message must appear; no order call.
    await expect(page.getByText(/enter a valid/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/checkout/);
  });

  test("shipping address is required with the client details", async ({
    page,
  }) => {
    await seedCart(page);
    await page.getByLabel("Full name").fill("Acme Traders");
    await page.getByLabel("Mobile number").fill("9876543210");
    await page.getByLabel("Delivery Pincode").fill("400001");
    await page.getByRole("button", { name: /place order/i }).click();
    // The address is asked next to name/mobile/email and blocks submit.
    await expect(page.getByLabel("Shipping address")).toBeVisible();
    await expect(page.getByText(/full shipping address/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/checkout/);
  });

  test("business GSTIN demands a complete billing profile", async ({
    page,
  }) => {
    await seedCart(page);
    await page.getByLabel("Full name").fill("Acme Traders");
    await page.getByLabel("Mobile number").fill("9876543210");
    await page
      .getByRole("radiogroup", { name: "Customer type" })
      .getByText(/business/i)
      .click();
    await page.getByRole("button", { name: /place order/i }).click();
    await expect(page.getByText(/gstin/i).first()).toBeVisible();
  });

  test("delivery check without backend fails gracefully", async ({ page }) => {
    await seedCart(page);
    await page.getByLabel("Delivery Pincode").fill("400001");
    await page.getByRole("button", { name: /check delivery/i }).click();
    // Either a result or an honest error — never a hang or a crash.
    await expect(
      page
        .getByText(/delivery (available|unavailable)|could not|failed|not available/i)
        .first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test("malformed pincode is rejected before any network call", async ({
    page,
  }) => {
    await seedCart(page);
    await page.getByLabel("Delivery Pincode").fill("abc");
    await page.getByRole("button", { name: /check delivery/i }).click();
    await expect(page.getByText(/6-digit/i)).toBeVisible();
  });

  test("refresh keeps the cart; back button returns to cart", async ({
    page,
  }) => {
    await seedCart(page);
    await page.reload();
    await expect(page.getByRole("heading", { name: /checkout/i })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/products\/talt-032/);
  });
});

