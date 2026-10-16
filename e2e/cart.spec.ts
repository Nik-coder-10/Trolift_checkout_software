import { expect, test } from "@playwright/test";

const PRODUCT = /telescopic ladder talt-032/i;

/**
 * Cart journey: the cart is browser-local (localStorage mirror), so
 * every behavior here is fully exercisable without a backend.
 */
test.describe("cart", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => window.localStorage.clear());
  });

  test("empty cart shows the empty state", async ({ page }) => {
    await page.goto("/cart");
    await expect(page.getByRole("heading", { name: /shopping cart/i })).toBeVisible();
    await expect(page.getByText(/your cart is empty/i)).toBeVisible();
  });

  test("add from product card updates badge and cart page", async ({ page }) => {
    await page.goto("/products");
    await page
      .getByRole("button", { name: /add .* to cart/i })
      .first()
      .click();
    await expect(
      page.getByRole("link", { name: /shopping cart, 1 items?/i }),
    ).toBeVisible();
    await page.getByRole("link", { name: /shopping cart, 1 items?/i }).click();
    await expect(page).toHaveURL(/\/cart/);
    await expect(page.getByRole("link", { name: PRODUCT }).first()).toBeVisible();
  });

  test("quantity stepper changes the line and survives refresh", async ({
    page,
  }) => {
    await page.goto("/products/talt-032");
    await page
      .getByRole("button", { name: "Add to Cart" })
      .first()
      .click();
    await page.goto("/cart");
    const qty = page.getByRole("spinbutton", { name: /quantity for .*talt-032/i });
    await expect(qty).toHaveValue("1");
    await page.getByRole("button", { name: "Increase quantity" }).click();
    await expect(qty).toHaveValue("2");
    await page.reload();
    await expect(
      page.getByRole("spinbutton", { name: /quantity for .*talt-032/i }),
    ).toHaveValue("2");
  });

  test("remove and clear restore the empty state", async ({ page }) => {
    await page.goto("/products/talt-032");
    await page
      .getByRole("button", { name: "Add to Cart" })
      .first()
      .click();
    await page.goto("/cart");
    await page
      .getByRole("button", { name: /remove .* from cart/i })
      .click();
    await expect(page.getByText(/your cart is empty/i)).toBeVisible();
    await expect(
      page.getByRole("link", { name: /shopping cart, empty/i }),
    ).toBeVisible();
  });

  test("corrupted storage degrades to an empty cart, never a crash", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() =>
      window.localStorage.setItem("trolift-cart-v1", "{not-json"),
    );
    await page.goto("/cart");
    await expect(page.getByText(/your cart is empty/i)).toBeVisible();
  });

  test("cart links onward to checkout", async ({ page }) => {
    await page.goto("/products/talt-032");
    await page
      .getByRole("button", { name: "Add to Cart" })
      .first()
      .click();
    await page.goto("/cart");
    await page.getByRole("link", { name: /proceed to checkout/i }).click();
    await expect(page).toHaveURL(/\/checkout/);
    await expect(
      page.getByRole("heading", { name: /checkout/i }),
    ).toBeVisible();
  });
});

