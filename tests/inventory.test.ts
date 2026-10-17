import { beforeEach, describe, expect, it, vi } from "vitest";

// server-only modules throw outside the Next server runtime by design.
vi.mock("server-only", () => ({}));
import {
  createMockClient,
  type MockResponder,
} from "@/tests/helpers/supabase-mock";

let serverHandler: MockResponder = () => {
  throw new Error("unexpected server query");
};
let adminHandler: MockResponder = () => {
  throw new Error("unexpected admin query");
};
let authUser: { id: string } | null = { id: "admin-1" };
let adminFlag = true;
vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    createMockClient((op) => {
      if (op.table === "profiles") {
        return { rows: adminFlag ? [{ is_admin: true }] : [], error: null };
      }
      return serverHandler(op);
    }, { authUser }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createMockClient(adminHandler),
}));

import { AppError } from "@/lib/api/errors";
import {
  adminStockTier,
  ADMIN_STOCK_TIER_LABELS,
  fetchAvailability,
  stockStatus,
} from "@/lib/inventory/availability";
import { priceOrderLines } from "@/lib/orders/quote";
import { persistOrder } from "@/lib/orders/create";
import { parseOrderRequestBody } from "@/lib/orders/request";
import { updateAdminProduct } from "@/lib/admin/products";
import {
  transitionOrderStatus,
  verifyPaymentClaim,
} from "@/lib/admin/orders";

beforeEach(() => {
  authUser = { id: "admin-1" };
  adminFlag = true;
  serverHandler = () => {
    throw new Error("unexpected server query");
  };
  adminHandler = () => {
    throw new Error("unexpected admin query");
  };
  delete process.env.PAYMENT_WINDOW_HOURS;
});

const ROW = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Trolley",
  price: "6299.00",
  gst_rate: null,
  hsn_code: null,
  is_active: true,
  available: 10,
  ...over,
});

describe("stock status (storefront rule)", () => {
  it("derives in/low/out from available vs threshold", () => {
    expect(stockStatus(11, 5)).toBe("in_stock");
    expect(stockStatus(5, 5)).toBe("low_stock");
    expect(stockStatus(1, 5)).toBe("low_stock");
    expect(stockStatus(0, 5)).toBe("out_of_stock");
    expect(stockStatus(-3, 5)).toBe("out_of_stock");
    expect(stockStatus(0, 0)).toBe("out_of_stock");
    expect(stockStatus(1, 0)).toBe("in_stock");
  });

  it("falls back to the default threshold when missing", () => {
    expect(stockStatus(5, null)).toBe("low_stock");
    expect(stockStatus(6, undefined)).toBe("in_stock");
  });
});

describe("fetchAvailability (batched, fail-soft for display)", () => {
  it("maps RPC rows by product", async () => {
    const client = createMockClient(() => ({
      rows: [
        { product_id: "p1", available: 4, low_stock_threshold: 5, status: "low_stock" },
      ],
      error: null,
    }));
    const map = await fetchAvailability(client, ["p1"]);
    expect(map?.get("p1")).toEqual({
      productId: "p1",
      available: 4,
      status: "low_stock",
    });
  });

  it("returns null when the RPC fails (callers degrade, never guess sales)", async () => {
    const client = createMockClient(() => ({
      rows: [],
      error: { message: "boom" },
    }));
    expect(await fetchAvailability(client, ["p1"])).toBeNull();
    expect(await fetchAvailability(client, [])).toEqual(new Map());
  });
});

describe("server line validation (stale carts, forged counts)", () => {
  it("accepts in-stock quantities and prices from snapshots only", () => {
    const lines = priceOrderLines([ROW()], [{ productId: "p1", quantity: 2 }]);
    expect(lines[0]).toMatchObject({
      productName: "Trolley",
      quantity: 2,
      unitPricePaise: 629900,
      lineTotalPaise: 1259800,
    });
  });

  it("accepts quantity exactly equal to availability", () => {
    const lines = priceOrderLines([ROW({ available: 3 })], [
      { productId: "p1", quantity: 3 },
    ]);
    expect(lines[0]?.quantity).toBe(3);
  });

  it("rejects out-of-stock products naming the item", () => {
    expect(() =>
      priceOrderLines([ROW({ available: 0 })], [{ productId: "p1", quantity: 1 }]),
    ).toThrowError(/"Trolley" is out of stock/);
  });

  it("rejects quantities beyond availability with the count", () => {
    expect(() =>
      priceOrderLines([ROW({ available: 2 })], [{ productId: "p1", quantity: 5 }]),
    ).toThrowError(/Only 2 of "Trolley" available/);
  });

  it("rejects zero and negative quantities", () => {
    for (const quantity of [0, -2]) {
      expect(() =>
        priceOrderLines([ROW()], [{ productId: "p1", quantity }]),
      ).toThrowError(/at least 1/);
    }
  });

  it("rejects deactivated products even when stock remains", () => {
    expect(() =>
      priceOrderLines(
        [ROW({ is_active: false, available: 50 })],
        [{ productId: "p1", quantity: 1 }],
      ),
    ).toThrowError(/no longer available/);
  });

  it("keeps money independent of availability (history integrity)", () => {
    const a = priceOrderLines([ROW({ available: 1 })], [{ productId: "p1", quantity: 1 }]);
    const b = priceOrderLines([ROW({ available: 100 })], [{ productId: "p1", quantity: 1 }]);
    expect(a[0]?.lineTotalPaise).toBe(b[0]?.lineTotalPaise);
  });

  it("drops forged client stock fields at the request gate", () => {
    const parsed = parseOrderRequestBody({
      items: [
        {
          productId: "b1c2d3e4-0004-4000-8000-000000000004",
          quantity: 1,
          stockQuantity: 9999,
          available: 9999,
          unitPrice: 1,
        },
      ],
      customer: { name: "Demo", phone: "+919876543210" },
      pincode: "400001",
      shippingAddress: "24, MG Road, Pune 411001",
      idempotencyKey: "c0ffee00-0001-4000-8000-000000000001",
    });
    expect(parsed.items).toEqual([
      { productId: "b1c2d3e4-0004-4000-8000-000000000004", quantity: 1 },
    ]);
  });
});

describe("atomic order path (race loser fails safe)", () => {
  const quoteFor = (qty: number) => ({
    lines: [
      {
        productId: "p1",
        productName: "Trolley",
        quantity: qty,
        unitPricePaise: 629900,
        lineTotalPaise: 629900 * qty,
        unitTaxablePaise: 629900,
        taxablePaise: 629900 * qty,
        gstRate: null as string | null,
        lineTaxPaise: 0,
        hsn: null,
      },
    ],
    subtotalPaise: 629900 * qty,
    tax: {
      treatment: "non_gst" as const,
      type: "none" as const,
      taxablePaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      totalGstPaise: 0,
    },
    billing: {
      gstin: null,
      stateCode: null,
      name: null,
      addressLine: null,
      city: null,
      state: null,
      pincode: null,
    },
    deliveryPartnerId: "d1",
    deliveryPartnerName: "Delhivery",
    deliveryChargePaise: 45000,
    deliveryWeightKg: null,
    deliveryRuleSummary: null,
    etaDays: null,
    totalPaise: 629900 * qty + 45000,
    pincode: "400001",
  });

  it("maps an atomic shortfall to 422 naming the item", async () => {
    process.env.PAYMENT_WINDOW_HOURS = "48";
    adminHandler = (op) => {
      if (op.rpc === "create_order") {
        return {
          rows: [],
          error: {
            code: "P0001",
            message: 'INSUFFICIENT_STOCK: Only 1 available of "Trolley"',
          },
        };
      }
      throw new Error(`unexpected ${op.table ?? op.rpc}`);
    };
    const err = await persistOrder({
      idempotencyKey: "c0ffee00-0001-4000-8000-000000000001",
      customer: { name: "D", phone: "+919876543210", email: null, gstin: null },
      shippingAddress: "24, MG Road, Pune 411001",
      quote: quoteFor(2),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("INSUFFICIENT_STOCK");
    expect((err as AppError).status).toBe(422);
    expect((err as AppError).message).toContain("Trolley");
  });
});

describe("payment verification consumes holds", () => {
  it("converts holds to a sale on approve", async () => {
    const consumed: unknown[] = [];
    serverHandler = (op) => {
      if (op.table === "orders" && !op.updateValues) {
        return {
          rows: [{ id: "o1", order_status: "payment_submitted", payment_status: "submitted", stock_state: "reserved" }],
          error: null,
        };
      }
      if (op.table === "payments" && !op.updateValues) {
        return { rows: [{ id: "pay1", status: "submitted" }], error: null };
      }
      if (op.rpc === "consume_reservation") {
        consumed.push(op.rpcArgs);
        return { rows: ["consumed"], error: null };
      }
      if (op.updateValues) return { rows: [{ id: "x" }], error: null };
      if (op.table === "order_events") return { rows: [{ id: "e1" }], error: null };
      throw new Error(`unexpected ${op.table ?? op.rpc}`);
    };
    const r = await verifyPaymentClaim("o1", "approve");
    expect(r).toEqual({ paymentStatus: "paid", orderStatus: "confirmed" });
    expect(consumed).toEqual([{ p_order_id: "o1" }]);
  });

  it("stops approval when the hold is no longer covered", async () => {
    serverHandler = (op) => {
      if (op.table === "orders" && !op.updateValues) {
        return {
          rows: [{ id: "o1", order_status: "payment_submitted", payment_status: "submitted", stock_state: "reserved" }],
          error: null,
        };
      }
      if (op.table === "payments" && !op.updateValues) {
        return { rows: [{ id: "pay1", status: "submitted" }], error: null };
      }
      if (op.rpc === "consume_reservation") {
        return {
          rows: [],
          error: { code: "P0001", message: "INSUFFICIENT_STOCK: hold of 2 units no longer covered" },
        };
      }
      throw new Error(`unexpected ${op.table ?? op.rpc}`);
    };
    const err = await verifyPaymentClaim("o1", "approve").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("INSUFFICIENT_STOCK");
    expect((err as AppError).status).toBe(409);
  });
});

describe("cancellation restores exactly once", () => {
  const wireCancel = (rpcResult: unknown = "restored") => {
    const calls: unknown[] = [];
    serverHandler = (op) => {
      if (op.table === "orders" && !op.updateValues) {
        return {
          rows: [{ id: "o1", order_status: "confirmed", payment_status: "paid", stock_state: "consumed" }],
          error: null,
        };
      }
      if (op.rpc === "restore_reservation") {
        calls.push(op.rpcArgs);
        return { rows: [rpcResult], error: null };
      }
      if (op.updateValues) return { rows: [{ id: "x" }], error: null };
      if (op.table === "order_events") return { rows: [{ id: "e1" }], error: null };
      throw new Error(`unexpected ${op.table ?? op.rpc}`);
    };
    return calls;
  };

  it("returns units before moving to cancelled", async () => {
    const calls = wireCancel();
    const r = await transitionOrderStatus("o1", "cancelled");
    expect(r).toEqual({ orderStatus: "cancelled" });
    expect(calls).toEqual([
      { p_order_id: "o1", p_reason: "order cancelled from confirmed" },
    ]);
  });

  it("leaves non-cancellation transitions untouched by stock", async () => {
    const calls = wireCancel();
    serverHandler = (op) => {
      if (op.table === "orders" && !op.updateValues) {
        return {
          rows: [{ id: "o1", order_status: "confirmed", payment_status: "paid", stock_state: "consumed" }],
          error: null,
        };
      }
      if (op.updateValues) return { rows: [{ id: "x" }], error: null };
      if (op.table === "order_events") return { rows: [{ id: "e1" }], error: null };
      throw new Error(`unexpected ${op.table ?? op.rpc}`);
    };
    await transitionOrderStatus("o1", "processing");
    expect(calls).toEqual([]);
  });
});

describe("admin stock controls (audited adjustments)", () => {
  const INPUT = {
    name: "Test Trolley",
    slug: "test-trolley",
    description: "A test trolley.",
    priceRupees: "6299.00",
    category: "Trolleys",
    images: [] as string[],
    specificationsJson: "{}",
    stockQuantity: 7,
    lowStockThreshold: 3,
    isActive: true,
    gstRate: "",
    weightKg: "",
    hsnCode: "",
  };

  it("logs manual stock changes with signed deltas", async () => {
    const events: unknown[] = [];
    serverHandler = (op) => {
      if (op.table === "products" && !op.updateValues) {
        return { rows: [{ stock_quantity: 10 }], error: null };
      }
      if (op.table === "products" && op.updateValues) {
        return { rows: [{ id: "p1" }], error: null };
      }
      if (op.table === "inventory_events") {
        events.push(op.updateValues);
        return { rows: [{ id: "ev1" }], error: null };
      }
      throw new Error(`unexpected ${op.table ?? op.rpc}`);
    };
    await updateAdminProduct("p1", INPUT);
    expect(events).toEqual([
      {
        product_id: "p1",
        order_id: null,
        event: "adjusted",
        quantity: -3,
        balance_after: 7,
        note: "manual stock adjustment",
      },
    ]);
  });

  it("skips the event when stock is unchanged", async () => {
    let eventCalls = 0;
    serverHandler = (op) => {
      if (op.table === "products" && !op.updateValues) {
        return { rows: [{ stock_quantity: 7 }], error: null };
      }
      if (op.table === "products" && op.updateValues) {
        return { rows: [{ id: "p1" }], error: null };
      }
      if (op.table === "inventory_events") {
        eventCalls += 1;
        return { rows: [{ id: "ev1" }], error: null };
      }
      throw new Error(`unexpected ${op.table ?? op.rpc}`);
    };
    await updateAdminProduct("p1", INPUT);
    expect(eventCalls).toBe(0);
  });
});

describe("adminStockTier (admin list badges)", () => {
  it("follows the agreed tiers in check order", () => {
    expect(adminStockTier(0, 5)).toBe("out");
    expect(adminStockTier(-2, 5)).toBe("out");
    expect(adminStockTier(1, 5)).toBe("critical");
    expect(adminStockTier(2, 5)).toBe("few");
    expect(adminStockTier(3, 5)).toBe("few");
    expect(adminStockTier(4, 5)).toBe("warning");
    expect(adminStockTier(5, 5)).toBe("warning");
    expect(adminStockTier(6, 5)).toBe("ok");
    expect(adminStockTier(50, 5)).toBe("ok");
  });

  it("respects per-product thresholds and falls back to the default", () => {
    // 2–3 always wins over the threshold tier (checked first).
    expect(adminStockTier(2, 1)).toBe("few");
    expect(adminStockTier(4, 3)).toBe("ok");
    expect(adminStockTier(4, null)).toBe("warning"); // default threshold 5
    expect(adminStockTier(4, undefined)).toBe("warning");
    expect(adminStockTier(6, null)).toBe("ok");
    expect(adminStockTier(1, 0)).toBe("critical");
  });

  it("labels every non-ok tier for the UI", () => {
    expect(ADMIN_STOCK_TIER_LABELS.out).toBe("Out of stock");
    expect(ADMIN_STOCK_TIER_LABELS.critical).toBe("Only one remaining");
    expect(ADMIN_STOCK_TIER_LABELS.few).toBe("Only few remaining");
    expect(ADMIN_STOCK_TIER_LABELS.warning).toBe("Low stock remaining");
    expect(ADMIN_STOCK_TIER_LABELS.ok).toBe("");
  });
});
