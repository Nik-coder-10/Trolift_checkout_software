import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// server-only modules throw outside the Next server runtime by design.
vi.mock("server-only", () => ({}));

import {
  createMockClient,
  type MockResponder,
} from "@/tests/helpers/supabase-mock";

let handler: MockResponder = () => {
  throw new Error("unexpected query");
};
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createMockClient(handler),
}));

let authUser: { id: string } | null = { id: "admin-1" };
let adminFlag = true;
vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    createMockClient(
      (op) => {
        if (op.table === "profiles") {
          return { rows: adminFlag ? [{ is_admin: true }] : [], error: null };
        }
        throw new Error(`unexpected server table ${op.table}`);
      },
      { authUser },
    ),
}));

import { getInvoiceData } from "@/lib/invoices/service";
import { GET as customerGet } from "@/app/api/orders/[id]/invoice/route";
import { GET as adminGet } from "@/app/api/admin/orders/[id]/invoice/route";
import {
  generateGuestToken,
  guestCookieName,
  hashGuestToken,
} from "@/lib/guest-access/tokens";

const ORDER_ID = "123e4567-e89b-12d3-a456-426614174000";
const OTHER_ID = "123e4567-e89b-12d3-a456-426614174099";

// Guest bearer for ORDER_ID; OTHER_ID intentionally has no token.
const INVOICE_TOKEN = generateGuestToken();
const INVOICE_HASH = hashGuestToken(INVOICE_TOKEN);

const ORDER_ROW = {
  id: ORDER_ID,
  order_number: "TS-261005-0001",
  created_at: "2026-10-05T10:00:00Z",
  payment_status: "paid",
  subtotal: "12598.00",
  delivery_charge: "450.00",
  total_amount: "15315.64",
  delivery_pincode: "400001",
  delivery_partner_name: "Partner A",
  gstin_snapshot: "27ABCDE1234F1Z5",
  tax_treatment: "gst",
  taxable_amount: "12598.00",
  cgst_amount: "1133.82",
  sgst_amount: "1133.82",
  igst_amount: "0.00",
  billing_name: "Acme Pvt Ltd",
  billing_address_line: "14 Industrial Estate",
  billing_city: "Mumbai",
  billing_state: "Maharashtra",
  billing_state_code: "27",
  billing_pincode: "400001",
  customer_name_snapshot: "Acme Pvt Ltd",
  customer_phone_snapshot: "+919810001111",
  customer_email_snapshot: "acme@example.in",
};

const ITEM_ROWS = [
  {
    product_name: "Heavy-Duty Platform Trolley 500 kg",
    quantity: 2,
    unit_price: "6299.00",
    line_total: "12598.00",
    gst_rate_percent: "18.00",
    line_tax_amount: "2267.64",
  },
];

// In-memory invoices table: number claim + freeze-once semantics.
const invoices = new Map<
  string,
  { invoice_number: string; invoice_date: string; data: unknown }
>();
let seq = 41;
let rpcCalls = 0;
// Canonical event rows written during invoice issuance.
const issued: Array<Record<string, unknown>> = [];

const customerReq = (id: string, query = "", token: string | null = INVOICE_TOKEN) =>
  new Request(`http://localhost/api/orders/${id}/invoice${query}`, {
    headers:
      token !== null
        ? { Cookie: `${guestCookieName(id)}=${encodeURIComponent(token)}` }
        : {},
  });

const ctxFor = (id: string) => ({
  params: Promise.resolve({ id }),
});

beforeEach(() => {
  invoices.clear();
  seq = 41;
  rpcCalls = 0;
  issued.length = 0;
  ORDER_ROW.payment_status = "paid";
  ORDER_ROW.customer_name_snapshot = "Acme Pvt Ltd";
  ORDER_ROW.subtotal = "12598.00";
  authUser = { id: "admin-1" };
  adminFlag = true;
  process.env.TROLIFT_BUSINESS_NAME = "Trolift Solutions";
  process.env.TROLIFT_BUSINESS_ADDRESS = "14 Industrial Estate, Mumbai 400001";
  process.env.TROLIFT_BUSINESS_PHONE = "+919810000000";
  process.env.TROLIFT_BUSINESS_EMAIL = "sales@trolift.in";
  process.env.TROLIFT_BUSINESS_GSTIN = "27ABCDE1234F1Z5";

  handler = (op) => {
    if (op.rpc === "generate_invoice_number") {
      rpcCalls += 1;
      seq += 1;
      return {
        rows: [`INV/FY26-27/${String(seq).padStart(6, "0")}`],
        error: null,
      };
    }
    if (op.table === "order_access_tokens") {
      if (op.updateValues !== undefined) {
        return { rows: [{ id: "t1" }], error: null };
      }
      const orderId = op.filters.find((f) => f.col === "order_id")?.val;
      return {
        rows:
          orderId === ORDER_ID
            ? [
                {
                  token_hash: INVOICE_HASH,
                  order_id: ORDER_ID,
                  expires_at: new Date(Date.now() + 86400_000).toISOString(),
                  revoked_at: null,
                },
              ]
            : [],
        error: null,
      };
    }
    if (op.table === "invoices") {
      // INSERTs carry no filters — the order id lives in the values.
      const orderId = (
        op.filters.length === 0 && op.updateValues !== undefined
          ? (op.updateValues as Record<string, unknown>)["order_id"]
          : op.filters.find((f) => f.col === "order_id")?.val
      ) as string;
      if (op.updateValues !== undefined && op.filters.length === 0) {
        // INSERT (claim).
        if (invoices.has(orderId)) {
          return { rows: [], error: { message: "duplicate", code: "23505" } };
        }
        const v = op.updateValues as Record<string, unknown>;
        invoices.set(orderId, {
          invoice_number: v["invoice_number"] as string,
          invoice_date: "2026-10-05",
          data: null,
        });
        return { rows: [{ order_id: orderId }], error: null };
      }
      if (op.updateValues !== undefined) {
        // UPDATE (freeze — first writer wins).
        const row = invoices.get(orderId);
        if (row && row.data === null) {
          row.data = (op.updateValues as Record<string, unknown>)["data"];
        }
        return { rows: [], error: null };
      }
      const row = invoices.get(orderId);
      return { rows: row ? [{ ...row }] : [], error: null };
    }
    if (op.table === "orders") {
      return {
        rows: orderIdKnown(op) ? [{ ...ORDER_ROW }] : [],
        error: null,
      };
    }
    if (op.table === "order_items") return { rows: ITEM_ROWS, error: null };
    if (op.table === "payments") return { rows: [{ method: "upi" }], error: null };
    if (op.table === "order_events") {
      // INVOICE_ISSUED emission on first freeze (insert folds into
      // updateValues in the mock). Recorded for issuance assertions.
      if (op.updateValues !== undefined) {
        issued.push(op.updateValues as Record<string, unknown>);
        return { rows: [{ id: "e1" }], error: null };
      }
      return { rows: [], error: null };
    }
    throw new Error(`unexpected table ${op.table ?? op.rpc}`);
  };
});

const orderIdKnown = (op: { filters: Array<{ col: string; val: unknown }> }) =>
  op.filters.some((f) => f.col === "id" && f.val === ORDER_ID);

afterEach(() => {
  delete process.env.TROLIFT_BUSINESS_NAME;
  delete process.env.TROLIFT_BUSINESS_ADDRESS;
  delete process.env.TROLIFT_BUSINESS_PHONE;
  delete process.env.TROLIFT_BUSINESS_EMAIL;
  delete process.env.TROLIFT_BUSINESS_GSTIN;
});

describe("customer invoice route (token-gated, fail closed)", () => {
  it("requires the guest token — UUID alone is 404", async () => {
    const res = await customerGet(customerReq(ORDER_ID, "", null), ctxFor(ORDER_ID));
    expect(res.status).toBe(404);
    const wrong = await customerGet(
      customerReq(ORDER_ID, "", generateGuestToken()),
      ctxFor(ORDER_ID),
    );
    expect(wrong.status).toBe(404);
  });

  it("serves the PDF for a paid order", async () => {
    const res = await customerGet(customerReq(ORDER_ID), ctxFor(ORDER_ID));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    expect(
      res.headers.get("Content-Disposition") ?? "",
    ).toMatch(/^attachment; filename="INV-FY26-27-000042\.pdf"$/);
  });

  it("reuses the frozen invoice without renumbering", async () => {
    const first = await getInvoiceData(ORDER_ID);
    const second = await getInvoiceData(ORDER_ID);
    expect(second.invoiceNumber).toBe(first.invoiceNumber);
    expect(rpcCalls).toBe(1);
  });

  it("emits INVOICE_ISSUED exactly once (first freeze only)", async () => {
    await getInvoiceData(ORDER_ID);
    await getInvoiceData(ORDER_ID);
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({
      order_id: ORDER_ID,
      event_type: "INVOICE_ISSUED",
      actor_type: "system",
      actor_user_id: null,
    });
    expect(issued[0]?.["metadata"]).toMatchObject({
      invoice_number: expect.any(String),
    });
  });

  it("converges concurrent first-time claims on one number", async () => {
    const [a, b] = await Promise.all([
      getInvoiceData(ORDER_ID),
      getInvoiceData(ORDER_ID),
    ]);
    expect(a.invoiceNumber).toBe(b.invoiceNumber);
    expect(a.invoiceNumber).toMatch(/^INV\/FY26-27\/\d{6}$/);
  });

  it("keeps frozen content after snapshot edits", async () => {
    const first = await getInvoiceData(ORDER_ID);
    // Simulate post-order master/catalogue edits reflected in snapshots.
    ORDER_ROW.customer_name_snapshot = "Acme Changed";
    ORDER_ROW.subtotal = "99999.00";
    const second = await getInvoiceData(ORDER_ID);
    expect(second.customer.name).toBe("Acme Pvt Ltd");
    expect(second.totals.subtotalPaise).toBe(1259800);
    expect(second.invoiceNumber).toBe(first.invoiceNumber);
  });

  it("rejects unpaid orders with 409 (never an invoice)", async () => {
    ORDER_ROW.payment_status = "pending";
    const res = await customerGet(customerReq(ORDER_ID), ctxFor(ORDER_ID));
    expect(res.status).toBe(409);
    const json = (await res.json()) as {
      ok: boolean;
      error: { code: string };
    };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("INVOICE_NOT_AVAILABLE");
  });

  it("404s unknown and malformed ids without leaking", async () => {
    const missing = await customerGet(
      customerReq(OTHER_ID),
      ctxFor(OTHER_ID),
    );
    expect(missing.status).toBe(404);
    const body = (await missing.json()) as {
      ok: boolean;
      error: { message: string };
    };
    expect(body.error.message).toBe("Invoice not found.");
    expect(JSON.stringify(body)).not.toContain("TS-261005");

    const malformed = await customerGet(customerReq("abc"), ctxFor("abc"));
    expect(malformed.status).toBe(404);
  });

  it("ignores ?id= — the path alone addresses the invoice (no IDOR probe)", async () => {
    // Valid query id, invalid path: still 404 (query never consulted).
    const res = await customerGet(
      customerReq("not-a-uuid", `?id=${ORDER_ID}`),
      ctxFor("not-a-uuid"),
    );
    expect(res.status).toBe(404);
    // Valid path, hostile query id: serves the PATH order only.
    const res2 = await customerGet(
      customerReq(ORDER_ID, `?id=${OTHER_ID}`),
      ctxFor(ORDER_ID),
    );
    expect(res2.status).toBe(200);
  });
});

describe("admin invoice route (requireAdmin + paid-only)", () => {
  it("rejects anonymous and non-admin callers before any lookup", async () => {
    authUser = null;
    expect(
      (await adminGet(customerReq(ORDER_ID), ctxFor(ORDER_ID))).status,
    ).toBe(401);
    authUser = { id: "u1" };
    adminFlag = false;
    expect(
      (await adminGet(customerReq(ORDER_ID), ctxFor(ORDER_ID))).status,
    ).toBe(403);
  });

  it("serves the PDF to admins for paid orders", async () => {
    const res = await adminGet(customerReq(ORDER_ID), ctxFor(ORDER_ID));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
  });

  it("refuses unpaid orders for admins too", async () => {
    ORDER_ROW.payment_status = "submitted";
    const res = await adminGet(customerReq(ORDER_ID), ctxFor(ORDER_ID));
    expect(res.status).toBe(409);
  });

  it("supports inline disposition for the Print flow", async () => {
    const res = await adminGet(
      new Request(
        `http://localhost/api/admin/orders/${ORDER_ID}/invoice?disposition=inline`,
      ),
      ctxFor(ORDER_ID),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition") ?? "").toMatch(/^inline;/);
  });
});
