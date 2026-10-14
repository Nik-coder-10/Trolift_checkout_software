import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// server-only modules throw outside the Next server runtime by design.
vi.mock("server-only", () => ({}));

import {
  createMockClient,
  type MockOp,
  type MockResponder,
  type MockUser,
} from "@/tests/helpers/supabase-mock";

let authUser: MockUser | null = { id: "admin-1" };
let adminFlag = true;
let handler: MockResponder = () => {
  throw new Error("unexpected query");
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createMockClient(handler, { authUser }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createMockClient(handler, { authUser }),
}));

import {
  canDownloadInvoice,
  quotationAction,
} from "@/lib/documents/availability";
import { getOrderDocumentActions } from "@/lib/admin/order-documents";
import { DocumentActions } from "@/components/admin/DocumentActions";

const ORDER_ID = "123e4567-e89b-12d3-a456-426614174000";

const profileOk: MockResponder = (op) => {
  if (op.table === "profiles") {
    return { rows: adminFlag ? [{ is_admin: true }] : [], error: null };
  }
  throw new Error(`unexpected table ${op.table}`);
};

/** Deterministic frozen-quotation probe: undefined = no row. */
function responder(quotation: unknown | undefined, error: unknown = null) {
  const seen: MockOp[] = [];
  const r: MockResponder = (op) => {
    seen.push(op);
    if (op.table === "profiles") {
      return { rows: adminFlag ? [{ is_admin: true }] : [], error: null };
    }
    if (op.table === "quotations") {
      return {
        rows:
          quotation === undefined
            ? []
            : [quotation as Record<string, unknown>],
        error: (error as { message: string } | null) ?? null,
      };
    }
    throw new Error(`unexpected table ${op.table}`);
  };
  return { r, seen };
}

beforeEach(() => {
  authUser = { id: "admin-1" };
  adminFlag = true;
  handler = profileOk;
});

describe("document availability rules (paid-only / provisional-only)", () => {
  it("offers the tax invoice for paid orders only", () => {
    expect(canDownloadInvoice("paid")).toBe(true);
    for (const status of [
      "pending",
      "submitted",
      "failed",
      "cancelled",
      "refunded",
      "PAID",
      "",
      "unknown",
    ]) {
      expect(canDownloadInvoice(status), status).toBe(false);
    }
  });

  it("offers a quotation while the order is provisional", () => {
    for (const status of ["draft", "pending_payment", "payment_submitted"]) {
      expect(quotationAction(status, false), status).toEqual({
        available: true,
        existing: false,
      });
    }
  });

  it("offers no fresh quotation once the order has moved past provisional", () => {
    for (const status of [
      "paid",
      "confirmed",
      "processing",
      "packed",
      "ready_for_dispatch",
      "shipped",
      "dispatched",
      "delivered",
      "cancelled",
      "",
    ]) {
      expect(quotationAction(status, false), status).toEqual({
        available: false,
        existing: false,
      });
    }
  });

  it("keeps an existing quotation downloadable from any status", () => {
    for (const status of [
      "draft",
      "pending_payment",
      "payment_submitted",
      "paid",
      "delivered",
      "cancelled",
    ]) {
      expect(quotationAction(status, true), status).toEqual({
        available: true,
        existing: true,
      });
    }
  });
});

describe("getOrderDocumentActions (admin, read-only)", () => {
  it("refuses anonymous and non-admin callers", async () => {
    authUser = null;
    await expect(
      getOrderDocumentActions({
        id: ORDER_ID,
        paymentStatus: "paid",
        orderStatus: "paid",
      }),
    ).rejects.toMatchObject({ name: "AppError", status: 401 });

    authUser = { id: "u1" };
    adminFlag = false;
    await expect(
      getOrderDocumentActions({
        id: ORDER_ID,
        paymentStatus: "paid",
        orderStatus: "paid",
      }),
    ).rejects.toMatchObject({ name: "AppError", status: 403 });
  });

  it("links a paid order to its invoice and a frozen quotation", async () => {
    const { r } = responder({
      quotation_number: "QTN-TS0000121264",
      valid_till: "2026-10-23",
      data: { version: 1, kind: "quotation" },
    });
    handler = r;
    const actions = await getOrderDocumentActions({
      id: ORDER_ID,
      paymentStatus: "paid",
      orderStatus: "paid",
    });
    expect(actions.invoice).toEqual({
      available: true,
      href: `/api/admin/orders/${ORDER_ID}/invoice`,
    });
    expect(actions.quotation).toEqual({
      available: true,
      existing: true,
      href: `/api/admin/orders/${ORDER_ID}/quotation`,
      quotationNumber: "QTN-TS0000121264",
      validTill: "2026-10-23",
    });
  });

  it("offers only the quotation for an unpaid, unquoted order", async () => {
    const { r, seen } = responder(undefined);
    handler = r;
    const actions = await getOrderDocumentActions({
      id: ORDER_ID,
      paymentStatus: "pending",
      orderStatus: "pending_payment",
    });
    expect(actions.invoice.available).toBe(false);
    expect(actions.quotation).toMatchObject({
      available: true,
      existing: false,
      quotationNumber: null,
    });
    // Rendering never issues a document: reads only, no write, no rpc.
    expect(seen.every((op) => op.rpc === null)).toBe(true);
    expect(seen.every((op) => op.updateValues === undefined)).toBe(true);
  });

    it("offers no quotation for a paid order without a frozen one", async () => {
    const { r } = responder(undefined);
    handler = r;
    const actions = await getOrderDocumentActions({
      id: ORDER_ID,
      paymentStatus: "paid",
      orderStatus: "delivered",
    });
    expect(actions.quotation).toMatchObject({
      available: false,
      existing: false,
    });
    expect(actions.invoice.available).toBe(true);
  });

  it("hides the invoice action for refunded orders (conservative, documented)", async () => {
    // canIssueInvoice() admits ONLY "paid": the panel must never offer a
    // document labelled "TAX INVOICE" against a currently-unpaid order,
    // even though the admin route still serves an already-frozen invoice
    // by direct request (record-keeping — see availability.ts).
    const { r } = responder(undefined);
    handler = r;
    const actions = await getOrderDocumentActions({
      id: ORDER_ID,
      paymentStatus: "refunded",
      orderStatus: "delivered",
    });
    expect(actions.invoice.available).toBe(false);
  });

  it("treats a claimed-but-unfrozen quotation row as not frozen", async () => {
    // Number claimed (row exists) but the frozen payload is not written
    // yet — the service would NOT serve this as a re-download, so the UI
    // must fall back to the provisional eligibility rule instead of
    // offering an action the route would refuse with 409.
    const { r } = responder({
      quotation_number: "QTN-TS0000121264",
      valid_till: "2026-10-23",
      data: null,
    });
    handler = r;
    const provisional = await getOrderDocumentActions({
      id: ORDER_ID,
      paymentStatus: "pending",
      orderStatus: "pending_payment",
    });
    expect(provisional.quotation).toMatchObject({
      available: true,
      existing: false,
      quotationNumber: null,
    });
    const settled = await getOrderDocumentActions({
      id: ORDER_ID,
      paymentStatus: "paid",
      orderStatus: "delivered",
    });
    expect(settled.quotation).toMatchObject({
      available: false,
      existing: false,
    });
  });

  it("treats a wrong-kind quotation payload as not frozen", async () => {
    const { r } = responder({
      quotation_number: "QTN-TS0000121264",
      valid_till: "2026-10-23",
      data: { version: 1, kind: "invoice" },
    });
    handler = r;
    const actions = await getOrderDocumentActions({
      id: ORDER_ID,
      paymentStatus: "paid",
      orderStatus: "delivered",
    });
    expect(actions.quotation).toMatchObject({
      available: false,
      existing: false,
      quotationNumber: null,
    });
  });

  it("never queries for a malformed order id", async () => {
    const { r, seen } = responder(undefined);
    handler = r;
    const actions = await getOrderDocumentActions({
      id: "not-a-uuid",
      paymentStatus: "paid",
      orderStatus: "pending_payment",
    });
    expect(seen.some((op) => op.table === "quotations")).toBe(false);
    expect(actions.invoice.available).toBe(true);
    // No frozen row could be read, so the UI falls back to eligibility.
    expect(actions.quotation).toMatchObject({ existing: false });
  });

    it("fails closed when the quotation probe errors", async () => {
    const { r } = responder(undefined, { message: "permission denied" });
    handler = r;
    const provisional = await getOrderDocumentActions({
      id: ORDER_ID,
      paymentStatus: "submitted",
      orderStatus: "payment_submitted",
    });
    expect(provisional.quotation).toMatchObject({
      available: true,
      existing: false,
      quotationNumber: null,
    });
    expect(provisional.invoice.available).toBe(false);

    const settled = await getOrderDocumentActions({
      id: ORDER_ID,
      paymentStatus: "paid",
      orderStatus: "delivered",
    });
    expect(settled.quotation).toMatchObject({ available: false });
    expect(settled.invoice.available).toBe(true);
  });
});

describe("admin document UI contract (static)", () => {
  const repo = join(__dirname, "..");
  const page = readFileSync(
    join(repo, "app", "admin", "(protected)", "orders", "[orderId]", "page.tsx"),
    "utf8",
  );
  const panel = readFileSync(
    join(repo, "components", "admin", "DocumentActions.tsx"),
    "utf8",
  );

  it("renders each document link exactly once (Playwright strict mode)", () => {
    const source = `${page}\n${panel}`;
    expect(source.match(/Download Invoice/g)).toHaveLength(1);
    expect(source.match(/Download Quotation/g)).toHaveLength(1);
  });

  it("keeps the accessible download names the staging specs select on", () => {
    // e2e/staging/2-admin.spec.ts and 4-failure.spec.ts click
    // getByRole("link", { name: /download invoice/i }).
    expect(panel).toContain("Download Invoice");
    expect(panel).toContain("Download Quotation");
    // Anchors + server Content-Disposition: no JS-only download path.
    expect(panel).toContain("download className");
  });
});

describe("admin document UI (rendered markup — exercises the real panel)", () => {
  const invoiceHref = `/api/admin/orders/${ORDER_ID}/invoice`;
  const quotationHref = `/api/admin/orders/${ORDER_ID}/quotation`;

  it("renders each document link exactly once when available", () => {
    const html = renderToStaticMarkup(
      createElement(DocumentActions, {
        invoice: { available: true, href: invoiceHref },
        quotation: {
          available: true,
          existing: true,
          href: quotationHref,
          quotationNumber: "QTN-TS0000121264",
          validTill: "2026-10-23",
        },
        paymentStatus: "paid",
        orderStatus: "paid",
      }),
    );
    // Playwright strict mode: exactly one accessible link per document.
    expect(html.match(/Download Invoice/g)).toHaveLength(1);
    expect(html.match(/Download Quotation/g)).toHaveLength(1);
    expect(html).toContain(`href="${quotationHref}"`);
    expect(html).toContain("QTN-TS0000121264");
  });

  it("hides unavailable actions and explains why (refunded order)", () => {
    const html = renderToStaticMarkup(
      createElement(DocumentActions, {
        invoice: { available: false, href: invoiceHref },
        quotation: {
          available: false,
          existing: false,
          href: quotationHref,
          quotationNumber: null,
          validTill: null,
        },
        paymentStatus: "refunded",
        orderStatus: "delivered",
      }),
    );
    expect(html).not.toContain("Download Invoice");
    expect(html).not.toContain("Download Quotation");
    expect(html).not.toContain(`href="${invoiceHref}"`);
    expect(html).toContain("refunded");
  });
});
