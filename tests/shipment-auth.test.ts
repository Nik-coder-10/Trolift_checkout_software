import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createMockClient,
  type MockOp,
  type MockResponder,
} from "@/tests/helpers/supabase-mock";
import { resetRateLimits } from "@/lib/rate-limit/index";

/**
 * Regression: the shipment reads join customer PII through the
 * SERVICE-ROLE client, so they must be admin-gated. Before this test
 * existed, `getShipmentDetail()`/`getShipmentByOrderId()` had no
 * requireAdmin() and GET /api/admin/shipments/[id] would answer
 * anonymous callers with shipment + customer name/phone.
 */

let adminFlag = true;

let handler: MockResponder = () => {
  throw new Error("unexpected query");
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createMockClient((op) => handler(op)),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createMockClient((op) => handler(op)),
}));
vi.mock("@/lib/auth/session", async () => {
  const { AppError } = await import("@/lib/api/errors");
  return {
    requireUser: async () => {
      if (!adminFlag) throw new AppError("UNAUTHORIZED", "Please sign in.", 401);
      return { id: "admin-1" };
    },
    requireAdmin: async () => {
      if (!adminFlag) throw new AppError("UNAUTHORIZED", "Please sign in.", 401);
      return { id: "admin-1" };
    },
    getSessionUser: async () => (adminFlag ? { id: "admin-1" } : null),
    isAdmin: async () => adminFlag,
  };
});

beforeEach(() => {
  resetRateLimits();
  adminFlag = true;
  handler = () => {
    throw new Error("unexpected query");
  };
});

const SHIPMENT_ID = "abc00000-0000-4000-8000-000000000001";

const SHIPMENT_ROW = {
  id: SHIPMENT_ID,
  order_id: "abc00000-0000-4000-8000-000000000002",
  delivery_partner_id: null,
  tracking_reference: null,
  dispatch_status: "not_ready",
  dispatched_at: null,
  expected_delivery_date: null,
  delivered_at: null,
  dispatch_notes: null,
  created_at: "2026-10-08T06:00:00Z",
  updated_at: "2026-10-08T06:00:00Z",
  orders: {
    order_number: "TS-1001",
    delivery_pincode: "380015",
    order_status: "processing",
    total_amount: "12345.00",
    customers: { name: "Ahmedabad Dealer", phone: "+919876543210" },
  },
};

describe("shipment reads are admin-gated", () => {
  it("anonymous GET /api/admin/shipments/[id] is refused before any query", async () => {
    adminFlag = false;
    const ops: MockOp[] = [];
    handler = (op) => {
      ops.push(op);
      return { rows: [SHIPMENT_ROW], error: null };
    };
    const { GET } = await import("@/app/api/admin/shipments/[id]/route");
    const res = await GET(new Request(`http://localhost/api/admin/shipments/${SHIPMENT_ID}`), {
      params: Promise.resolve({ id: SHIPMENT_ID }),
    });
    expect(res.status).toBe(401);
    // No service-role read may happen on the denied path.
    expect(ops.filter((o) => o.table === "shipments")).toHaveLength(0);
    // …and the response body cannot leak the customer.
    expect(JSON.stringify(await res.json())).not.toContain("9876543210");
  });

  it("anonymous getShipmentDetail / getShipmentByOrderId throw and read nothing", async () => {
    adminFlag = false;
    const ops: MockOp[] = [];
    handler = (op) => {
      ops.push(op);
      return { rows: [SHIPMENT_ROW], error: null };
    };
    const { getShipmentDetail, getShipmentByOrderId } = await import(
      "@/lib/shipments/service"
    );
    await expect(getShipmentDetail(SHIPMENT_ID)).rejects.toMatchObject({ status: 401 });
    await expect(
      getShipmentByOrderId(SHIPMENT_ROW.order_id),
    ).rejects.toMatchObject({ status: 401 });
    expect(ops).toHaveLength(0);
  });

  it("admins still get shipment detail", async () => {
    handler = (op) => {
      if (op.table === "shipments") return { rows: [SHIPMENT_ROW], error: null };
      throw new Error(`unexpected table ${op.table}`);
    };
    const { GET } = await import("@/app/api/admin/shipments/[id]/route");
    const res = await GET(new Request(`http://localhost/api/admin/shipments/${SHIPMENT_ID}`), {
      params: Promise.resolve({ id: SHIPMENT_ID }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { customer?: { name?: string } };
    };
    expect(body.ok).toBe(true);
  });

  it("unknown shipment id yields 404, not 400", async () => {
    handler = () => ({ rows: [], error: null });
    const { GET } = await import("@/app/api/admin/shipments/[id]/route");
    const res = await GET(new Request(`http://localhost/api/admin/shipments/${SHIPMENT_ID}`), {
      params: Promise.resolve({ id: SHIPMENT_ID }),
    });
    expect(res.status).toBe(404);
  });
});
