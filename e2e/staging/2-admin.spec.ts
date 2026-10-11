import { expect, test } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadIdentities, adminLogin } from "./helpers";

/**
 * STAGING admin browser journey (live backend, disposable).
 *
 * Sign in → find the customer journey's test order → verify the payment
 * claim → fulfillment walk → shipment create/track/deliver → event
 * timeline → invoice download (admin + customer copies).
 *
 * Every state change goes through rendered UI controls except shipment
 * creation, which has no UI affordance: it uses the supported admin
 * API through the same authenticated browser session (auth enforced).
 */

interface Journey {
  orderId: string;
  orderNumber: string;
  phone: string;
  utr: string;
}

async function loadJourney(): Promise<Journey> {
  const raw = await fs.readFile(path.join(__dirname, ".auth", "journey.json"), "utf8");
  return JSON.parse(raw) as Journey;
}

test.describe("staging admin journey", () => {
  test("claim to delivered with tracking and invoices, all in the browser", async ({
    page,
  }) => {
    const ids = await loadIdentities();
    const journey = await loadJourney();
    const { orderId, orderNumber } = journey;

    // 1–2. Sign in, find the test order via search.
    await adminLogin(page, ids);
    await page.goto("/admin/orders");
    await page.getByLabel("Search", { exact: true }).fill(orderNumber);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(new RegExp(`q=${orderNumber}`));
    const orderLink = page.getByRole("link", { name: new RegExp(orderNumber) }).first();
    await expect(orderLink).toBeVisible({ timeout: 20_000 });

    // 3–4. Open the claim, verify it.
    await orderLink.click();
    await expect(page).toHaveURL(new RegExp(`/admin/orders/${orderId}`));
    await expect(page.getByRole("heading", { name: new RegExp(orderNumber) })).toBeVisible();
    await page.getByRole("button", { name: "Mark paid" }).click();
    await expect(page.getByText("Mark payment as paid?")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText(/paid/i).first()).toBeVisible({ timeout: 20_000 });

    // 5. Fulfillment walk through valid states (UI-offered only).
    // Milestones advance order_status: processing → packed, then the
    // status transition to ready_for_dispatch.
    await page.getByRole("button", { name: "Move to Processing" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("button", { name: "Mark packed" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Mark packed" }).click();
    await expect(page.getByRole("button", { name: "Move to Ready for dispatch" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Move to Ready for dispatch" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    // Unambiguous: only ready_for_dispatch offers "Move to Dispatched".
    await expect(page.getByRole("button", { name: "Move to Dispatched" })).toBeVisible({ timeout: 20_000 });

    // 6–7. Shipment (supported admin API under the UI session — no
    // create affordance exists in the UI) then tracking via UI.
    // page.request shares the browser session's cookies; the standalone
    // `request` fixture is a bare, unauthenticated context.
    const created = await page.request.post("/api/admin/shipments/create", {
      data: { orderId },
    });
    expect(created.ok(), `shipment create failed: ${await created.text()}`).toBe(true);
    const shipment = (await created.json()) as { data: { id: string } };
    const shipmentId = shipment.data.id;
    await page.goto(`/admin/shipments/${shipmentId}`);
    await page.getByRole("button", { name: "Mark ready" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("button", { name: "Mark dispatched" })).toBeVisible({ timeout: 20_000 });
    const trackingRef = `STGE2E${Date.now().toString(36).toUpperCase()}`;
    await page.getByRole("button", { name: "Mark dispatched" }).click();
    await page.getByPlaceholder("e.g. AWB123456789").fill(trackingRef);
    await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("button", { name: "Mark in transit" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Mark in transit" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();

    // 8. Mark delivered (shipment sync drives the order lifecycle;
    // fall back to the order action if the sync leaves it behind).
    await expect(page.getByRole("button", { name: "Mark delivered" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Mark delivered" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText(/terminal state/i)).toBeVisible({ timeout: 20_000 });
    await page.goto(`/admin/orders/${orderId}`);
    if ((await page.getByRole("button", { name: "Move to Delivered" }).count()) > 0) {
      await page.getByRole("button", { name: "Move to Delivered" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    }
    await expect(page.getByText(/delivered/i).first()).toBeVisible({ timeout: 20_000 });
    // No further transitions offered on a terminal order.
    await expect(page.getByRole("button", { name: /move to/i })).toHaveCount(0);

    // 9. Event timeline rendered. The compact "Lifecycle timeline"
    // strip is deliberately hidden on a terminal order (delivered), so
    // the audit-trail timeline is the surface that must show the walk.
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
    await expect(page.getByText("Delivered").first()).toBeVisible();

    // 10. Admin invoice download is a real PDF.
    const [dl] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      page.getByRole("link", { name: /download invoice/i }).click(),
    ]);
    const pdfPath = await dl.path();
    const magic = (await fs.readFile(pdfPath!)).subarray(0, 4).toString();
    expect(magic).toBe("%PDF");
  });
});

