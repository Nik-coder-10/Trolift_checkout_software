import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockClient,
  type MockResponder,
} from "@/tests/helpers/supabase-mock";
import { resetRateLimits } from "@/lib/rate-limit/index";

beforeEach(() => resetRateLimits());

vi.mock("server-only", () => ({}));

let adminHandler: MockResponder = () => {
  throw new Error("unexpected admin query");
};
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createMockClient(adminHandler),
}));

import { POST } from "@/app/api/orders/my/route";

const CUSTOMER_ID = "a1b2c3d4-0001-4000-8000-000000000001";
const ORDER_1 = "123e4567-e89b-12d3-a456-426614174001";
const ORDER_2 = "123e4567-e89b-12d3-a456-426614174002";

const orderRow = (id: string, number: string, total: string) => ({
  id,
  order_number: number,
  created_at: "2026-10-18T10:00:00Z",
  total_amount: total,
  payment_status: "pending",
  order_status: "pending_payment",
  delivery_pincode: "400001",
  delivery_partner_name: "Delhivery",
});

function wireDb(phone = "+919876543210") {
  adminHandler = (op) => {
    if (op.table === "customers") {
      const eq = op.filters.find((f) => f.col === "phone");
      if (eq && eq.val === phone) {
        return { rows: [{ id: CUSTOMER_ID }], error: null };
      }
      return { rows: [], error: null };
    }
    if (op.table === "orders") {
      // The per-order access check inside issueGuestToken.
      if (op.single) {
        const eq = op.filters.find((f) => f.col === "id");
        const rows = [ORDER_1, ORDER_2].includes(String(eq?.val))
          ? [{ id: eq?.val }]
          : [];
        return { rows, error: null };
      }
      return {
        rows: [orderRow(ORDER_1, "TS-261018-0001", "6299.00"), orderRow(ORDER_2, "TS-261018-0002", "12598.00")],
        error: null,
      };
    }
    if (op.table === "order_access_tokens") {
      if (op.updateValues !== undefined) return { rows: [], error: null };
      return { rows: [], error: null };
    }
    throw new Error(`unexpected admin op on ${op.table ?? op.rpc}`);
  };
}

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/orders/my", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("POST /api/orders/my (past orders by mobile)", () => {
  it("lists the customer's orders newest-first as a safe projection", async () => {
    wireDb();
    const res = await post({ phone: "9876543210" });
    const json = (await res.json()) as {
      ok: boolean;
      data: { orders: Array<Record<string, unknown>> };
    };
    expect(json.ok).toBe(true);
    expect(json.data.orders).toHaveLength(2);
    expect(json.data.orders[0]).toMatchObject({
      orderId: ORDER_1,
      orderNumber: "TS-261018-0001",
      totalPaise: 629900,
      paymentStatus: "pending",
      orderStatus: "pending_payment",
      deliveryPincode: "400001",
      deliveryPartnerName: "Delhivery",
    });
    // No raw tokens, no addresses, no GSTINs, no phone in the body.
    const raw = JSON.stringify(json.data);
    expect(raw).not.toMatch(/[A-Za-z0-9_-]{43}/);
    expect(raw).not.toContain("customer");
  });

  it("rotates a guest cookie per listed order and returns no token in the body", async () => {
    wireDb();
    const res = await post({ phone: "+919876543210" });
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) {
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("tl_go_");
    }
  });

  it("normalizes 0-prefixed and +91 numbers to the same customer", async () => {
    wireDb();
    const res = await post({ phone: "09876543210" });
    const json = (await res.json()) as { ok: boolean; data: { orders: unknown[] } };
    expect(json.ok).toBe(true);
    expect(json.data.orders).toHaveLength(2);
  });

  it("returns an empty list (not an error) for a number with no orders", async () => {
    wireDb();
    const res = await post({ phone: "+919800000000" });
    const json = (await res.json()) as { ok: boolean; data: { orders: unknown[] } };
    expect(json.ok).toBe(true);
    expect(json.data.orders).toEqual([]);
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it("rejects malformed numbers without touching the database", async () => {
    adminHandler = () => {
      throw new Error("must not be called");
    };
    for (const phone of ["", "abc", "12345", "+911234"]) {
      const res = await post({ phone });
      expect(res.status).toBe(400);
    }
  });

  it("rejects a non-JSON body", async () => {
    const res = await POST(
      new Request("http://localhost/api/orders/my", { method: "POST", body: "nope" }),
    );
    expect(res.status).toBe(400);
  });

  it("shares the recover rate-limit budget (5/min, fail-closed)", async () => {
    wireDb();
    for (let i = 0; i < 5; i += 1) {
      const res = await post({ phone: "+919876543210" });
      expect(res.status).toBe(200);
    }
    const denied = await post({ phone: "+919876543210" });
    expect(denied.status).toBe(429);
  });

  it("surfaces a database failure as a generic 500", async () => {
    adminHandler = (op) => {
      if (op.table === "customers") return { rows: [], error: { message: "boom" } };
      throw new Error(`unexpected admin op on ${op.table ?? op.rpc}`);
    };
    const res = await post({ phone: "+919876543210" });
    expect(res.status).toBe(500);
  });
});
