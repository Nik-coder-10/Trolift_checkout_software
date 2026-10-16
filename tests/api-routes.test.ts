import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockClient,
  type MockResponder,
} from "@/tests/helpers/supabase-mock";
import { resetRateLimits } from "@/lib/rate-limit/index";

beforeEach(() => resetRateLimits());

vi.mock("server-only", () => ({}));

let serverHandler: MockResponder = () => {
  throw new Error("unexpected server query");
};
let adminHandler: MockResponder = () => {
  throw new Error("unexpected admin query");
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createMockClient(serverHandler),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createMockClient(adminHandler),
}));

import { POST as deliveryPost } from "@/app/api/delivery/check/route";
import { POST as claimPost } from "@/app/api/payments/claim/route";
import { generateGuestToken, hashGuestToken } from "@/lib/guest-access/tokens";

const OID = "c0ffee00-0001-4000-8000-000000000001";
// Bearer for OID: the mock answers the token table with its hash.
const CLAIM_TOKEN = generateGuestToken();
const CLAIM_HASH = hashGuestToken(CLAIM_TOKEN);

const call = (
  fn: (req: Request) => Promise<Response>,
  body: unknown,
) =>
  fn(
    new Request("http://localhost/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const rateRow = (charge: string, priority = 100) => ({
  delivery_partner_id: "a1b2c3d4-0001-4000-8000-000000000001",
  serviceable: true,
  delivery_charge: charge,
  eta_min_days: 2,
  eta_max_days: 4,
  min_order_amount: null,
  max_order_amount: null,
  delivery_partners: { name: "Delhivery", is_active: true, priority },
});

describe("POST /api/delivery/check", () => {
  it("returns a serviceable verdict with the serving partner — no charges", async () => {
    serverHandler = (op) => {
      if (op.table === "delivery_pincode_rates") {
        return { rows: [rateRow("450.00")], error: null };
      }
      if (op.table === "delivery_weight_slabs") {
        return { rows: [], error: null };
      }
      if (op.table === "delivery_category_rules") {
        return { rows: [], error: null };
      }
      throw new Error("unreachable");
    };
    const res = await call(deliveryPost, {
      pincode: "400001",
      subtotalPaise: 2544900,
    });
    const json = (await res.json()) as {
      ok: boolean;
      data: Record<string, unknown>;
    };
    expect(json.ok).toBe(true);
    // All-inclusive pricing: the verdict is serviceability + partner +
    // the included-delivery message. Charges, options, weight and
    // rule figures are structurally absent.
    expect(json.data).toMatchObject({
      serviceable: true,
      pincode: "400001",
      message: "Delivery is included in the product price.",
      partner: { name: "Delhivery" },
    });
    expect(json.data).not.toHaveProperty("selected");
    expect(json.data).not.toHaveProperty("deliveryChargePaise");
    expect(json.data).not.toHaveProperty("totalWeightKg");
    expect(json.data).not.toHaveProperty("subtotalPaise");
  });

  it("keeps shipment weight out of the verdict for weightless products", async () => {
    // Live staging proved 0 kg violates orders_delivery_weight_kg_check
    // (> 0 when present) and 500s order placement. Unknown weights must
    // stay null end to end — and the check response never carries
    // weight at all.
    serverHandler = (op) => {
      if (op.table === "delivery_pincode_rates") {
        return { rows: [rateRow("450.00")], error: null };
      }
      if (op.table === "delivery_weight_slabs") {
        return { rows: [], error: null };
      }
      if (op.table === "delivery_category_rules") {
        return { rows: [], error: null };
      }
      if (op.table === "products") {
        return {
          rows: [{ id: "b1c2d3e4-0004-4000-8000-000000000004", weight_kg: null, category: "Tools", price: "100.00" }],
          error: null,
        };
      }
      throw new Error("unreachable");
    };
    const res = await call(deliveryPost, {
      pincode: "400001",
      subtotalPaise: 10000,
      items: [{ productId: "b1c2d3e4-0004-4000-8000-000000000004", quantity: 1 }],
    });
    const json = (await res.json()) as {
      ok: boolean;
      data: Record<string, unknown>;
    };
    expect(json.ok).toBe(true);
    expect(json.data.serviceable).toBe(true);
    expect(json.data).not.toHaveProperty("totalWeightKg");
  });

  it("reports out-of-area pincodes as unserviceable, not errors", async () => {
    // 680522 is flagged ODA in the Delhivery list: the verdict comes
    // from the list alone, and this handler throws if any table is read.
    serverHandler = () => {
      throw new Error("unreachable");
    };
    const res = await call(deliveryPost, { pincode: "680522" });
    const json = (await res.json()) as {
      ok: boolean;
      data: Record<string, unknown>;
    };
    expect(json.ok).toBe(true);
    expect(json.data.serviceable).toBe(false);
    expect(json.data.coverage).toMatchObject({
      listed: true,
      oda: true,
      deliverable: false,
    });
    expect(json.data.partner).toBeNull();
    expect(String(json.data.message)).toContain("nearby pincode");
  });

  it("treats a covered pincode with no configured rate as not orderable", async () => {
    // Orders require a priced partner row — same gate as quoteOrder —
    // so covered-but-unpriced answers with the nearby-pincode message.
    serverHandler = (op) => {
      if (op.table === "delivery_pincode_rates") {
        return { rows: [], error: null };
      }
      if (op.table === "delivery_weight_slabs") {
        return { rows: [], error: null };
      }
      if (op.table === "delivery_category_rules") {
        return { rows: [], error: null };
      }
      throw new Error("unreachable");
    };
    const res = await call(deliveryPost, { pincode: "799001" });
    const json = (await res.json()) as {
      ok: boolean;
      data: Record<string, unknown>;
    };
    expect(json.ok).toBe(true);
    expect(json.data.serviceable).toBe(false);
    expect(json.data.partner).toBeNull();
    expect(String(json.data.message)).toContain("nearby pincode");
    expect(json.data.coverage).toMatchObject({ listed: true, oda: false });
  });

  it("rejects malformed input", async () => {
    for (const body of [{ pincode: "12" }, { pincode: "" }, { pincode: "400001", subtotalPaise: -1 }]) {
      const res = await call(deliveryPost, body);
      expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
    }
  });
});

const orderRow = {
  id: OID,
  order_number: "TS-261004-0001",
  customer_id: "cust-1",
  payment_status: "pending",
  order_status: "pending_payment",
};
const customerRow = { phone: "+919876543210" };
const paymentRow = { id: "pay-1", status: "pending" };

function wireClaim(over: {
  order?: unknown;
  customer?: unknown;
  payment?: unknown;
  updateError?: { message: string; code?: string } | null;
} = {}) {
  adminHandler = (op) => {
    if (op.table === "order_access_tokens" && op.updateValues === undefined) {
      return {
        rows: [
          {
            token_hash: CLAIM_HASH,
            order_id: OID,
            expires_at: new Date(Date.now() + 86400_000).toISOString(),
            revoked_at: null,
          },
        ],
        error: null,
      };
    }
    if (op.table === "order_access_tokens") {
      return { rows: [{ id: "t1" }], error: null };
    }
    if (op.table === "orders" && !op.updateValues) {
      return { rows: [over.order ?? orderRow], error: null };
    }
    if (op.table === "customers") {
      return { rows: [over.customer ?? customerRow], error: null };
    }
    if (op.table === "payments" && !op.updateValues) {
      return { rows: [over.payment ?? paymentRow], error: null };
    }
    if (op.updateValues) {
      if (over.updateError) return { rows: [], error: over.updateError };
      return { rows: [{ id: "x" }], error: null };
    }
    throw new Error(`unreachable ${op.table}`);
  };
}

const claimBody = (over: Record<string, unknown> = {}) => ({
  orderId: OID,
  reference: "123456789012",
  phone: "09876543210",
  accessToken: CLAIM_TOKEN,
  ...over,
});

describe("POST /api/payments/claim (reference only, never amounts)", () => {
  it("submits a valid claim with phone match + guest token", async () => {
    wireClaim();
    const res = await call(claimPost, claimBody());
    const json = (await res.json()) as {
      ok: boolean;
      data: Record<string, unknown>;
    };
    expect(json.ok).toBe(true);
    expect(json.data).toMatchObject({
      orderId: OID,
      paymentStatus: "submitted",
      orderStatus: "payment_submitted",
    });
  });

  it("rejects claims without a guest token (UUID alone authorizes nothing)", async () => {
    wireClaim();
    const noToken = claimBody() as Record<string, unknown>;
    delete noToken["accessToken"];
    const res = await call(claimPost, noToken);
    const json = (await res.json()) as {
      ok: boolean;
      error: { code: string };
    };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("NOT_FOUND");
  });

  it("rejects a mismatched phone without confirming the order (generic 404)", async () => {
    wireClaim();
    const res = await call(
      claimPost,
      claimBody({ phone: "+911111111111" }),
    );
    const json = (await res.json()) as {
      ok: boolean;
      error: { code: string };
    };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("NOT_FOUND");
  });

  it("rejects claims in non-payable states", async () => {
    wireClaim({
      order: { ...orderRow, payment_status: "paid", order_status: "confirmed" },
      payment: { id: "pay-1", status: "paid" },
    });
    const res = await call(claimPost, claimBody({ phone: "+919876543210" }));
    const json = (await res.json()) as {
      ok: boolean;
      error: { code: string };
    };
    expect(json.ok).toBe(false);
    expect(["BAD_REQUEST", "NOT_FOUND"]).toContain(json.error.code);
  });

  it("treats a duplicate UTR as a conflict, not a new record", async () => {
    wireClaim({
      updateError: { message: "duplicate key", code: "23505" },
    });
    const res = await call(
      claimPost,
      claimBody({ phone: "+919876543210" }),
    );
    const json = (await res.json()) as {
      ok: boolean;
      error: { code: string };
    };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("BAD_REQUEST");
  });

  it("rejects malformed bodies", async () => {
    for (const body of [
      { orderId: "nope", reference: "123456789012", phone: "+919876543210" },
      { orderId: OID, reference: "", phone: "+919876543210" },
      { orderId: OID, reference: "123456789012", phone: "" },
    ]) {
      const res = await call(claimPost, body);
      expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
    }
  });
});
