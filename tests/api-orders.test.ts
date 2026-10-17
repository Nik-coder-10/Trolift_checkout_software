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

import { POST } from "@/app/api/orders/route";

const P1 = "b1c2d3e4-0004-4000-8000-000000000004";
const PARTNER = "a1b2c3d4-0001-4000-8000-000000000001";
const KEY = "c0ffee00-0001-4000-8000-000000000001";
const CREATED_ORDER_ID = "123e4567-e89b-12d3-a456-426614174001";

const rateRow = (charge: string) => ({
  delivery_partner_id: PARTNER,
  serviceable: true,
  delivery_charge: charge,
  eta_min_days: 2,
  eta_max_days: 4,
  min_order_amount: null,
  max_order_amount: null,
  delivery_partners: { name: "Delhivery", is_active: true, priority: 100 },
});

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const validBody = (over: Record<string, unknown> = {}) => ({
  items: [{ productId: P1, quantity: 2 }],
  customer: { name: "Demo Traders", phone: "+919876543210" },
  pincode: "400001",
  idempotencyKey: KEY,
  ...over,
});

function wireDb(price: string, charge: string, rates: unknown[] = [rateRow(charge)]) {
  // Summary rows mirror what the RPC would persist from the quote, so
  // the response mapping is exercised end to end.
  const subtotal = (Number(price) * 2).toFixed(2);
  const total = (Number(subtotal) + Number(charge)).toFixed(2);
  serverHandler = (op) => {
    if (op.table === "products") {
      return {
        rows: [{ id: P1, name: "Trolley", price, is_active: true }],
        error: null,
      };
    }
    if (op.rpc === "product_availability") {
      return {
        rows: [{ product_id: P1, available: 50, low_stock_threshold: 5, status: "in_stock" }],
        error: null,
      };
    }
    if (op.table === "delivery_pincode_rates") {
      return { rows: rates, error: null };
    }
    if (op.table === "delivery_weight_slabs") {
      return { rows: [], error: null };
    }
    if (op.table === "delivery_category_rules") {
      return { rows: [], error: null };
    }
    throw new Error(`unexpected server op on ${op.table}`);
  };
  adminHandler = (op) => {
    if (op.rpc === "create_order") {
      return { rows: CREATED_ORDER_ID as unknown as unknown[], error: null };
    }
    if (op.table === "order_access_tokens") {
      // Issuance stores the hash; the raw token goes out once in the body.
      if (op.updateValues !== undefined) {
        return { rows: [{ id: "tok-1" }], error: null };
      }
      return { rows: [], error: null };
    }
    if (op.table === "order_events") {
      return { rows: [], error: null };
    }
    if (op.table === "orders") {
      return {
        rows: [
          {
            id: CREATED_ORDER_ID,
            order_number: "TS-261004-0001",
            subtotal,
            delivery_charge: charge,
            total_amount: total,
            payment_status: "pending",
            order_status: "pending_payment",
          },
        ],
        error: null,
      };
    }
    throw new Error(`unexpected admin op on ${op.table ?? op.rpc}`);
  };
}

describe("POST /api/orders (server-authoritative totals)", () => {
  it("prices from live rows and returns the safe summary", async () => {
    wireDb("6299.00", "450.00");
    const res = await post(validBody());
    const json = (await res.json()) as {
      ok: boolean;
      data: Record<string, unknown>;
    };
    expect(json.ok).toBe(true);
    expect(json.data).toMatchObject({
      orderNumber: "TS-261004-0001",
      subtotalPaise: 1259800,
      deliveryChargePaise: 45000,
      totalPaise: 1304800,
      paymentStatus: "pending",
      duplicate: false,
    });
    expect(json.data).not.toHaveProperty("customer_id");
    // One-time guest token issued; only its hash is stored server-side.
    expect(typeof json.data["guestToken"]).toBe("string");
    expect(String(json.data["guestToken"])).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.headers.get("Set-Cookie") ?? "").toContain("HttpOnly");
  });

  it("ignores every client-submitted money/status field", async () => {
    wireDb("6299.00", "450.00");
    const res = await post(
      validBody({
        subtotal: 1,
        deliveryCharge: 1,
        total: 2,
        total_amount: 2,
        unitPrice: 1,
        paymentStatus: "paid",
        orderStatus: "delivered",
        deliveryPartnerId: "00000000-0000-4000-8000-000000000000",
      }),
    );
    const json = (await res.json()) as {
      ok: boolean;
      data: Record<string, unknown>;
    };
    expect(json.ok).toBe(true);
    expect(json.data.totalPaise).toBe(1304800);
    expect(json.data.paymentStatus).toBe("pending");
  });

  it("charges the NEW price when the catalogue moved mid-checkout", async () => {
    wireDb("7000.00", "450.00");
    const res = await post(validBody());
    const json = (await res.json()) as {
      ok: boolean;
      data: Record<string, unknown>;
    };
    expect(json.ok).toBe(true);
    expect(json.data.subtotalPaise).toBe(1400000);
    expect(json.data.totalPaise).toBe(1445000);
  });

  it("uses the CURRENT delivery rate, never the browser's", async () => {
    wireDb("6299.00", "700.00");
    const res = await post(validBody());
    const json = (await res.json()) as {
      ok: boolean;
      data: Record<string, unknown>;
    };
    expect(json.ok).toBe(true);
    expect(json.data.deliveryChargePaise).toBe(70000);
  });

  it("rejects inactive and unknown products", async () => {
    serverHandler = (op) => {
      if (op.table === "products") {
        return {
          rows: [{ id: P1, name: "Old", price: "1.00", is_active: false }],
          error: null,
        };
      }
      throw new Error("unreachable");
    };
    const res = await post(validBody());
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);

    serverHandler = (op) => {
      if (op.table === "products") return { rows: [], error: null };
      throw new Error("unreachable");
    };
    const res2 = await post(validBody());
    expect(((await res2.json()) as { ok: boolean }).ok).toBe(false);
  });

  it("rejects unserviceable pincodes", async () => {
    // 680522 is flagged ODA in the Delhivery list, so coverage vetoes it
    // before any rate lookup — no rows configured, and none required.
    serverHandler = (op) => {
      if (op.table === "products") {
        return {
          rows: [{ id: P1, name: "T", price: "6299.00", is_active: true }],
          error: null,
        };
      }
      if (op.rpc === "product_availability") {
        return {
          rows: [{ product_id: P1, available: 50, low_stock_threshold: 5, status: "in_stock" }],
          error: null,
        };
      }
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
    const res = await post(validBody({ pincode: "680522" }));
    const json = (await res.json()) as {
      ok: boolean;
      error: { code: string };
    };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });

  it("places an order on a covered pincode with no configured rate", async () => {
    // No rate row means nothing is left to price — not "we don't deliver
    // here". The order goes through against the coverage-source partner,
    // recorded without a partner id until the operator configures one.
    wireDb("6299.00", "450.00", []);
    const captured: { args?: Record<string, unknown> } = {};
    const inner = adminHandler;
    adminHandler = (op) => {
      if (op.rpc === "create_order") {
        captured.args = op.rpcArgs as Record<string, unknown>;
      }
      return inner(op);
    };

    const res = await post(validBody({ pincode: "302012" }));
    const json = (await res.json()) as {
      ok: boolean;
      error?: { code: string; message: string };
    };
    expect(json.error).toBeUndefined();
    expect(json.ok).toBe(true);

    const order = captured.args?.["p_order"] as
      | Record<string, unknown>
      | undefined;
    expect(order).toBeDefined();
    expect(order?.["delivery_partner_id"]).toBeNull();
    expect(order?.["delivery_partner_name"]).toBe("Delhivery");
    // Delivery is already inside the catalogue price, so the quote never
    // carries a charge for an unconfigured pincode either.
    expect(order?.["delivery_charge"]).toBe("0.00");
  });

  it("replays duplicate submissions to the original order", async () => {
    serverHandler = (op) => {
      if (op.table === "products") {
        return {
          rows: [{ id: P1, name: "T", price: "6299.00", is_active: true }],
          error: null,
        };
      }
      if (op.rpc === "product_availability") {
        return {
          rows: [{ product_id: P1, available: 50, low_stock_threshold: 5, status: "in_stock" }],
          error: null,
        };
      }
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
    adminHandler = (op) => {
      if (op.rpc === "create_order") {
        return {
          rows: [],
          error: { message: "duplicate key", code: "23505" },
        };
      }
      if (op.table === "order_access_tokens") {
        if (op.updateValues !== undefined) {
          return { rows: [{ id: "tok-1" }], error: null };
        }
        return { rows: [], error: null };
      }
      if (op.table === "orders") {
        return {
          rows: [
            {
              id: CREATED_ORDER_ID,
              order_number: "TS-261004-0001",
              subtotal: "12598.00",
              delivery_charge: "450.00",
              total_amount: "13048.00",
              payment_status: "pending",
              order_status: "pending_payment",
            },
          ],
          error: null,
        };
      }
      throw new Error("unreachable");
    };
    const res = await post(validBody());
    const json = (await res.json()) as {
      ok: boolean;
      data: Record<string, unknown>;
    };
    expect(json.ok).toBe(true);
    expect(json.data).toMatchObject({
      orderNumber: "TS-261004-0001",
      duplicate: true,
    });
  });

  it("returns 429 once the per-minute budget is exhausted", async () => {
    wireDb("6299.00", "450.00");
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await post(
        validBody({
          idempotencyKey: `c0ffee00-0001-4000-8000-${i.toString(16).padStart(12, "0")}`,
        }),
      );
      codes.push(res.status);
    }
    expect(codes.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it("fails safe on database errors without leaking internals", async () => {
    serverHandler = () => ({
      rows: [],
      error: { message: "connection refused: secret-host:5432", code: "XX000" },
    });
    const res = await post(validBody());
    const json = (await res.json()) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(json)).not.toContain("secret-host");
  });
});
