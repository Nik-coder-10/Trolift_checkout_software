import { expect, test, type Page } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  paymentProofUpload,
  trackPhone,
  uniquePhone,
  uniqueUtr,
} from "./helpers";

/**
 * STAGING customer browser journey (live backend, disposable).
 *
 * Catalogue → search → product → cart → checkout (business GSTIN +
 * serviceable pincode) → order confirmation → payment instructions →
 * simulated UTR claim → refresh persistence → timeline → tracking →
 * (invoice after the admin journey verifies payment; asserted here as
 * absent-before-paid, present-after in admin.spec.ts).
 *
 * Persists the created order to .auth/journey.json for the admin,
 * authorization, and failure specs. Cleans up only its own records.
 */

const PRODUCT_SLUG = "tmst-300";
const PRODUCT_NAME = /metal platform trolley tmst-300/i;

/**
 * Below the `md` breakpoint the filter panel (including search) is
 * collapsed behind a disclosure button, so the field is not focusable
 * until it is opened.
 */
async function openCatalogueFilters(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: /search & filters/i });
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click();
  }
}

test.describe("staging customer journey", () => {
  // No cleanup here: the journey order is consumed by the admin,
  // authorization, and failure specs. Final cleanup (including this
  // order) runs in 4-failure.spec.ts via journey.json.

  test("catalogue to paid-pending order with claim, all in the browser", async ({
    page,
  }) => {
    const phone = trackPhone(uniquePhone());
    const utr = uniqueUtr();

    // 1–2. Catalogue + search + product page.
    await page.goto("/products");
    await expect(
      page.getByRole("heading", { name: /products/i }).first(),
    ).toBeVisible();
    // Catalogue search (debounced, URL-synced). NOTE: the header
    // search submits an empty query (reported separately) — the
    // catalogue FilterBar is the working search surface.
    await openCatalogueFilters(page);
    // The panel is rendered twice (desktop copy + mobile disclosure),
    // so there is one id per copy: drive the visible one.
    const catalogueSearch = page.locator("#catalogue-search:visible");
    await expect(catalogueSearch).toBeVisible();
    await catalogueSearch.pressSequentially("trolley", { delay: 50 });
    await expect(page).toHaveURL(/\/products\?q=trolley/, { timeout: 15_000 });
    await page.getByRole("link", { name: PRODUCT_NAME }).first().click();
    await expect(page).toHaveURL(new RegExp(`/products/${PRODUCT_SLUG}`));
    await expect(
      page.getByRole("heading", { name: PRODUCT_NAME }).first(),
    ).toBeVisible();

    // 3–5. Cart: add, change quantity, navigate away and back.
    await page.getByRole("button", { name: "Add to Cart" }).first().click();
    await expect(
      page.getByRole("link", { name: /shopping cart, 1 items?/i }),
    ).toBeVisible();
    await page.goto("/cart");
    const qty = page.getByRole("spinbutton", { name: /quantity for/i });
    await expect(qty).toHaveValue("1");
    await page.getByRole("button", { name: "Increase quantity" }).click();
    await expect(qty).toHaveValue("2");
    await page.goto("/products");
    await page.goBack();
    await expect(page).toHaveURL(/\/cart/);
    await expect(
      page.getByRole("spinbutton", { name: /quantity for/i }),
    ).toHaveValue("2");

    // 6–9. Checkout: customer + business billing + serviceable pincode.
    await page.getByRole("link", { name: /proceed to checkout/i }).click();
    await expect(page).toHaveURL(/\/checkout/);
    await page.getByLabel("Full name").fill("STGE2E Buyer");
    await page.getByLabel("Mobile number").fill(phone);
    await page
      .getByRole("radiogroup", { name: "Customer type" })
      .getByText(/business/i)
      .click();
    await page.getByLabel(/GSTIN/i).fill("27ABCDE1234F1Z0");
    await page.getByLabel(/legal \/ business name/i).fill("STGE2E Traders");
    await page.getByLabel(/street address/i).fill("14 Industrial Estate");
    await page.getByLabel(/^city$/i).fill("Mumbai");
    await page.locator("#billing\\.stateCode").selectOption("27");
    await page.getByLabel(/billing pincode/i).fill("400001");
    await page.getByLabel("Delivery Pincode").fill("400001");
    await page.getByRole("button", { name: /check delivery/i }).click();
    await expect(
      page.getByText(/delivery available/i),
    ).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /review details/i }).click();

    // 10. Submit the order.
    await page.getByRole("button", { name: /place order/i }).click();
    await expect(page.getByText(/^order placed$/i)).toBeVisible({ timeout: 30_000 });
    const orderNumber = ((await page.getByText(/TS-\d{6}-\d{4,}/).first().textContent()) ?? "").trim();
    expect(orderNumber).toMatch(/^TS-\d{6}-\d{4,}$/);

    // 11. Confirmation + payment instructions.
    const payHref = await page.getByRole("link", { name: /pay now/i }).getAttribute("href");
    expect(payHref).toMatch(/^\/orders\/[0-9a-f-]{36}\/pay$/);
    const orderId = payHref!.split("/")[2]!;
    await page.getByRole("link", { name: /pay now/i }).click();
    await expect(page).toHaveURL(new RegExp(`/orders/${orderId}/pay`));
    await expect(page.getByText(/scan to pay/i)).toBeVisible();
    await expect(page.getByText(/confirm payment/i)).toBeVisible();

    // 12. Simulated payment claim (test UTR — never a real transfer).
    // The screenshot is mandatory: a tiny real PNG satisfies the
    // server-side magic-byte sniff.
    await page.getByLabel(/order mobile number/i).fill(phone);
    await page.getByLabel(/utr number/i).fill(utr);
    await page.getByLabel(/payment screenshot/i).setInputFiles(paymentProofUpload());
    await page.getByRole("button", { name: /submit reference/i }).click();
    await expect(
      page.getByText(/payment submitted for verification/i),
    ).toBeVisible({ timeout: 20_000 });

    // 13–14. Refresh persists; timeline shows the journey so far.
    await page.reload();
    await expect(
      page.getByText(/payment under verification/i),
    ).toBeVisible({ timeout: 20_000 });
    await page.goto(`/orders/${orderId}`);
    await expect(page.getByRole("heading", { name: new RegExp(`Order ${orderNumber}`) })).toBeVisible();
    await expect(page.getByText("Payment submitted for verification")).toBeVisible();
    await expect(
      page.locator('section[aria-label="Order updates"]').getByText("Order placed", { exact: true }),
    ).toBeVisible();

    // 15. Tracking pending; 16. invoice correctly absent before verification.
    await expect(page.getByText(/tracking details appear here/i)).toBeVisible();
    await expect(
      page.getByText(/invoice is issued after payment verification/i),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /download invoice/i })).toHaveCount(0);

    // PII is masked in the guest view.
    await expect(page.getByText(/••••••\d{4}/).first()).toBeVisible();
    expect(await page.content()).not.toContain(phone);

    // Share state for the admin/authorization/failure specs.
    await fs.writeFile(
      path.join(__dirname, ".auth", "journey.json"),
      JSON.stringify({ orderId, orderNumber, phone, utr }, null, 2),
      { mode: 0o600 },
    );
  });
});
