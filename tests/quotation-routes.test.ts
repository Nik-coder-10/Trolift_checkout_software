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

import { getQuotationData } from "@/lib/quotations/service";
import { GET as customerGet } from "@/app/api/orders/[id]/quotation/route";
import { GET as adminGet } from "@/app/api/admin/orders/[id]/quotation/route";
import {
  generateGuestToken,
  guestCookieName,
  hashGuestToken,
} from "@/lib/guest-access/tokens";

const ORDER_ID = "123e4567-e89b-12d3-a456-426614174000";
const OTHER_ID = "123e4567-e89b-12d3-a456-426614174099";

// Guest bearer for ORDER_ID; OTHER_ID intentionally has no token.
const QUOTE_TOKEN = generateGuestToken();
const QUOTE_HASH = hashGuestToken(QUOTE_TOKEN);

const ORDER_ROW = {
  id: ORDER_ID,
  order_number: "TS-261009-0001",
  created_at: "2026-10-09T10:00:00Z",
  payment_status: "pending",
  order_status: "pending_payment",
  subtotal: "5050.00",
  delivery_charge: "470.00",
  total_amount: "5520.00",
  delivery_pincode: "110075",
  delivery_partner_name: "Partner A",
  gstin_snapshot: "07ABCDE1234F1Z2",
  tax_treatment: "gst",
  taxable_amount: "5050.00",
  cgst_amount: "0.00",
  sgst_amount: "0.00",
  igst_amount: "252.50",
  billing_name: "Acme Pvt Ltd",
  billing_address_line: "14 Industrial Estate",
  billing_city: "South West Delhi",
  billing_state: "Delhi",
  billing_state_code: "07",
  billing_pincode: "110075",
  customer_name_snapshot: "Acme Pvt Ltd",
  customer_phone_snapshot: "+919810001111",
  customer_email_snapshot: null,
};

const ITEM_ROWS = [
  {
    product_name: "Metal Trolley 600 Kg",
    quantity: 1,
    unit_price: "5050.00",
    line_total: "5050.00",
    gst_rate_percent: "5.00",
    line_tax_amount: "252.50",
    hsn_snapshot: "87168010",
  },
];

// In-memory quotations table: number claim + freeze-once semantics.
const quotations = new Map<
  string,
  { quotation_number: string; quotation_date: string; valid_till: string; data: unknown }
>();
let seq = 121263;
let rpcCalls = 0;
// Canonical event rows written during quotation issuance.
const issued: Array<Record<string, unknown>> = [];

const customerReq = (id: string, query = "", token: string | null = QUOTE_TOKEN) =>
  new Request(`http://localhost/api/orders/${id}/quotation${query}`, {
    headers:
      token !== null
        ? { Cookie: `${guestCookieName(id)}=${encodeURIComponent(token)}` }
        : {},
  });

const ctxFor = (id: string) => ({
  params: Promise.resolve({ id }),
});

beforeEach(() => {
  quotations.clear();
  seq = 121263;
  rpcCalls = 0;
  issued.length = 0;
  ORDER_ROW.payment_status = "pending";
  ORDER_ROW.order_status = "pending_payment";
  authUser = { id: "admin-1" };
  adminFlag = true;
  process.env.TROLIFT_BUSINESS_NAME = "Trolift Solutions";
  process.env.TROLIFT_BUSINESS_ADDRESS = "Jaipur 302022, Rajasthan";
  process.env.TROLIFT_BUSINESS_GSTIN = "27ABCDE1234F1Z0";
  delete process.env.TROLIFT_BANK_ACCOUNT_NO;
  delete process.env.TROLIFT_SIGNATORY_NAME;

  handler = (op) => {
    if (op.rpc === "generate_quotation_number") {
      rpcCalls += 1;
      seq += 1;
      return {
        rows: [`QTN-TS${String(seq).padStart(10, "0")}`],
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
                  token_hash: QUOTE_HASH,
                  order_id: ORDER_ID,
                  expires_at: new Date(Date.now() + 86400_000).toISOString(),
                  revoked_at: null,
                },
              ]
            : [],
        error: null,
      };
    }
    if (op.table === "quotations") {
      const orderId = (
        op.filters.length === 0 && op.updateValues !== undefined
          ? (op.updateValues as Record<string, unknown>)["order_id"]
          : op.filters.find((f) => f.col === "order_id")?.val
      ) as string;
      if (op.updateValues !== undefined && op.filters.length === 0) {
        // INSERT (claim).
        if (quotations.has(orderId)) {
          return { rows: [], error: { message: "duplicate", code: "23505" } };
        }
        const v = op.updateValues as Record<string, unknown>;
        quotations.set(orderId, {
          quotation_number: v["quotation_number"] as string,
          quotation_date: v["quotation_date"] as string,
          valid_till: v["valid_till"] as string,
          data: null,
        });
        return { rows: [{ order_id: orderId }], error: null };
      }
      if (op.updateValues !== undefined) {
        // UPDATE (freeze — first writer wins).
        const row = quotations.get(orderId);
        if (row && row.data === null) {
          row.data = (op.updateValues as Record<string, unknown>)["data"];
        }
        return { rows: [], error: null };
      }
      const row = quotations.get(orderId);
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
  delete process.env.TROLIFT_BUSINESS_GSTIN;
});

describe("customer quotation route (token-gated, fail closed)", () => {
  it("requires the guest token — UUID alone is 404", async () => {
    const res = await customerGet(customerReq(ORDER_ID, "", null), ctxFor(ORDER_ID));
    expect(res.status).toBe(404);
    const wrong = await customerGet(
      customerReq(ORDER_ID, "", generateGuestToken()),
      ctxFor(ORDER_ID),
    );
    expect(wrong.status).toBe(404);
  });

  it("serves the PDF for a provisional order", async () => {
    const res = await customerGet(customerReq(ORDER_ID), ctxFor(ORDER_ID));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    expect(
      res.headers.get("Content-Disposition") ?? "",
    ).toMatch(/^attachment; filename="QTN-TS0000121264\.pdf"$/);
  });

  it("serves quotations for payment_submitted orders too", async () => {
    ORDER_ROW.order_status = "payment_submitted";
    const res = await customerGet(customerReq(ORDER_ID), ctxFor(ORDER_ID));
    expect(res.status).toBe(200);
  });

  it("reuses the frozen quotation without renumbering", async () => {
    const first = await getQuotationData(ORDER_ID);
    const second = await getQuotationData(ORDER_ID);
    expect(second.quotationNumber).toBe(first.quotationNumber);
    expect(rpcCalls).toBe(1);
  });

  it("emits QUOTATION_ISSUED exactly once (first freeze only)", async () => {
    await getQuotationData(ORDER_ID);
    await getQuotationData(ORDER_ID);
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({
      order_id: ORDER_ID,
      event_type: "QUOTATION_ISSUED",
      actor_type: "system",
      actor_user_id: null,
    });
    expect(issued[0]?.["metadata"]).toMatchObject({
      quotation_number: expect.any(String),
    });
  });

  it("rejects delivered and cancelled orders with 409 (never a quotation)", async () => {
    for (const status of ["delivered", "cancelled", "confirmed"]) {
      ORDER_ROW.order_status = status;
      const res = await customerGet(customerReq(ORDER_ID), ctxFor(ORDER_ID));
      expect(res.status, status).toBe(409);
      const json = (await res.json()) as {
        ok: boolean;
        error: { code: string };
      };
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("QUOTATION_NOT_AVAILABLE");
    }
  });

  it("404s unknown and malformed ids without leaking", async () => {
    const missing = await customerGet(
      customerReq(OTHER_ID),
      ctxFor(OTHER_ID),
    );
    expect(missing.status).toBe(404);
    const malformed = await customerGet(customerReq("abc"), ctxFor("abc"));
    expect(malformed.status).toBe(404);
  });

  it("ignores ?id= — the path alone addresses the quotation", async () => {
    const res = await customerGet(
      customerReq("not-a-uuid", `?id=${ORDER_ID}`),
      ctxFor("not-a-uuid"),
    );
    expect(res.status).toBe(404);
    const res2 = await customerGet(
      customerReq(ORDER_ID, `?id=${OTHER_ID}`),
      ctxFor(ORDER_ID),
    );
    expect(res2.status).toBe(200);
  });
});

describe("admin quotation route (requireAdmin + provisional-only)", () => {
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

  it("serves the PDF to admins for provisional orders", async () => {
    const res = await adminGet(customerReq(ORDER_ID), ctxFor(ORDER_ID));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
  });

  it("supports inline disposition for preview", async () => {
    const res = await adminGet(
      new Request(
        `http://localhost/api/admin/orders/${ORDER_ID}/quotation?disposition=inline`,
      ),
      ctxFor(ORDER_ID),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition") ?? "").toMatch(/^inline;/);
  });
});
