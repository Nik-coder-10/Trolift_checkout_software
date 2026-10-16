import { expect, test } from "@playwright/test";

/**
 * Catalogue journey against the offline fallback catalogue (hermetic:
 * the Playwright webServer blanks Supabase env vars, so these specs
 * prove real rendering without any backend).
 */
test.describe("catalogue", () => {
  test("homepage loads with brand and product entry points", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: /trolift solutions — home/i }),
    ).toBeVisible();
    // Desktop shows the primary nav inline; mobile hides it behind the
    // hamburger menu — exercise whichever the viewport offers.
    const inline = page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Products" });
    if (await inline.isVisible()) {
      await expect(inline).toBeVisible();
    } else {
      await page.getByRole("button", { name: /open menu/i }).click();
      await expect(
        page
          .getByRole("navigation", { name: "Mobile" })
          .getByRole("link", { name: "Products" }),
      ).toBeVisible();
    }
  });

  test("product listing shows cards that link to detail pages", async ({
    page,
  }) => {
    await page.goto("/products");
    await expect(
      page.getByRole("heading", { name: /products|all products/i }).first(),
    ).toBeVisible();
    const firstCard = page
      .getByRole("link", { name: /telescopic ladder talt-032/i })
      .first();
    await expect(firstCard).toBeVisible();
    await firstCard.click();
    await expect(page).toHaveURL(/\/products\/talt-032/);
    await expect(
      page.getByRole("heading", { name: /telescopic ladder talt-032/i }),
    ).toBeVisible();
  });

  test("header search narrows the catalogue", async ({ page }) => {
    await page.goto("/products");
    const inlineSearch = page.getByRole("search").first();
    if (await inlineSearch.getByPlaceholder(/search/i).isVisible()) {
      await inlineSearch.getByPlaceholder(/search/i).fill("ladder");
      await inlineSearch.press("Enter");
    } else {
      await page.getByRole("button", { name: /open menu/i }).click();
      const menuSearch = page
        .getByRole("navigation", { name: "Mobile" })
        .getByRole("search");
      await menuSearch.getByPlaceholder(/search/i).fill("ladder");
      await menuSearch.press("Enter");
    }
    await expect(page).toHaveURL(/q=ladder/);
  });

  test("product detail shows price, stock status and purchase actions", async ({
    page,
  }) => {
    await page.goto("/products/talt-032");
    await expect(
      page.getByRole("heading", { name: /telescopic ladder talt-032/i }),
    ).toBeVisible();
    // Stock badge: exactly one of the three honest states.
    const badge = page.getByText(/^(in stock|low stock|out of stock)$/i).first();
    await expect(badge).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add to Cart" }),
    ).toBeVisible();
  });

  test("unknown product slug renders the not-found page, not a crash", async ({
    page,
  }) => {
    const res = await page.goto("/products/no-such-product-xyz");
    expect(res?.status()).toBe(404);
  });
});
