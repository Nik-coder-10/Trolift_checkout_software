import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createMockClient,
  type MockResponder,
} from "@/tests/helpers/supabase-mock";
import { resetRateLimits } from "@/lib/rate-limit/index";
import {
  canTransitionShipment,
  isTerminalShipmentStatus,
  orderStatusForShipment,
} from "@/lib/shipments/types";
import type { ShipmentStatus } from "@/lib/shipments/types";

beforeEach(() => resetRateLimits());

let adminHandler: MockResponder = () => {
  throw new Error("unexpected admin query");
};
const serverHandler: MockResponder = (op) => adminHandler(op);
vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    createMockClient(serverHandler, { authUser: { id: "admin-1" } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    createMockClient(adminHandler, { authUser: { id: "admin-1" } }),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAdmin: async () => ({ id: "admin-1" }),
  requireUser: async () => ({ id: "admin-1" }),
  getSessionUser: async () => ({ id: "admin-1" }),
  isAdmin: async () => true,
}));

describe("Shipment state machine", () => {
  const validTransitions: Array<[ShipmentStatus, ShipmentStatus]> = [
    ["not_ready", "ready"],
    ["ready", "dispatched"],
    ["dispatched", "in_transit"],
    ["dispatched", "delivered"],
    ["in_transit", "delivered"],
  ];

  for (const [from, to] of validTransitions) {
    it(`allows ${from} → ${to}`, () => {
      expect(canTransitionShipment(from, to)).toBe(true);
    });
  }

  const invalidTransitions: Array<[ShipmentStatus, ShipmentStatus]> = [
    ["not_ready", "dispatched"],
    ["not_ready", "in_transit"],
    ["not_ready", "delivered"],
    ["ready", "in_transit"],
    ["ready", "delivered"],
    ["dispatched", "ready"],
    ["dispatched", "not_ready"],
    ["in_transit", "dispatched"],
    ["in_transit", "ready"],
    ["delivered", "dispatched"],
    ["delivered", "in_transit"],
    ["delivered", "ready"],
    ["delivered", "not_ready"],
  ];

  for (const [from, to] of invalidTransitions) {
    it(`rejects ${from} → ${to}`, () => {
      expect(canTransitionShipment(from, to)).toBe(false);
    });
  }

  it("identifies delivered as terminal", () => {
    expect(isTerminalShipmentStatus("delivered")).toBe(true);
  });

  it("identifies non-terminal statuses", () => {
    expect(isTerminalShipmentStatus("not_ready")).toBe(false);
    expect(isTerminalShipmentStatus("ready")).toBe(false);
    expect(isTerminalShipmentStatus("dispatched")).toBe(false);
    expect(isTerminalShipmentStatus("in_transit")).toBe(false);
  });
});

describe("Shipment → Order status mapping", () => {
  it("maps ready → ready_for_dispatch when order is packed", () => {
    expect(orderStatusForShipment("ready", "packed")).toBe("ready_for_dispatch");
  });

  it("maps dispatched → dispatched when order is ready_for_dispatch", () => {
    expect(orderStatusForShipment("dispatched", "ready_for_dispatch")).toBe("dispatched");
  });

  it("maps delivered → delivered when order is dispatched", () => {
    expect(orderStatusForShipment("delivered", "dispatched")).toBe("delivered");
  });

  it("maps delivered → delivered when order is dispatched", () => {
    expect(orderStatusForShipment("delivered", "dispatched")).toBe("delivered");
  });

  it("returns null for non-mapped transitions", () => {
    expect(orderStatusForShipment("not_ready", "packed")).toBeNull();
    expect(orderStatusForShipment("ready", "dispatched")).toBeNull();
    expect(orderStatusForShipment("in_transit", "dispatched")).toBeNull();
  });
});

describe("Shipment service", () => {
  const ORDER_ID = "c0ffee00-0001-4000-8000-000000000001";

  function mockAdmin() {
    return (op: Parameters<MockResponder>[0]) => {
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      if (op.table === "auth") return { rows: [], error: null };
      throw new Error("unexpected");
    };
  }

  it("createShipment rejects when order is not ready_for_dispatch", async () => {
    const { createShipment } = await import("@/lib/shipments/service");
    adminHandler = (op) => {
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      if (op.table === "orders" && !op.updateValues) {
        return {
          rows: [{ id: ORDER_ID, order_status: "confirmed" }],
          error: null,
        };
      }
      throw new Error("unexpected");
    };
    await expect(createShipment(ORDER_ID)).rejects.toMatchObject({
      status: 409,
    });
  });

  it("createShipment rejects duplicate shipment", async () => {
    const { createShipment } = await import("@/lib/shipments/service");
    adminHandler = (op) => {
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      if (op.table === "orders" && !op.updateValues) {
        return {
          rows: [{ id: ORDER_ID, order_status: "ready_for_dispatch" }],
          error: null,
        };
      }
      if (op.table === "shipments" && !op.updateValues) {
        return { rows: [{ id: "existing" }], error: null };
      }
      throw new Error("unexpected");
    };
    await expect(createShipment(ORDER_ID)).rejects.toMatchObject({
      status: 409,
    });
  });

  it("updateShipmentStatus rejects invalid transitions", async () => {
    const { updateShipmentStatus } = await import("@/lib/shipments/service");
    adminHandler = (op) => {
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      if (op.table === "shipments" && !op.updateValues) {
        return {
          rows: [{
            id: "ship-1",
            order_id: ORDER_ID,
            dispatch_status: "not_ready",
            orders: { id: ORDER_ID, order_status: "packed" },
          }],
          error: null,
        };
      }
      throw new Error("unexpected");
    };
    await expect(updateShipmentStatus("ship-1", "delivered", {})).rejects.toMatchObject({
      status: 409,
    });
  });

  it("updateShipmentStatus validates tracking reference", async () => {
    const { updateShipmentStatus } = await import("@/lib/shipments/service");
    adminHandler = (op) => {
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      if (op.table === "shipments" && !op.updateValues) {
        return {
          rows: [{
            id: "ship-1",
            order_id: ORDER_ID,
            dispatch_status: "ready",
            orders: { id: ORDER_ID, order_status: "ready_for_dispatch" },
          }],
          error: null,
        };
      }
      throw new Error("unexpected");
    };
    await expect(
      updateShipmentStatus("ship-1", "dispatched", { trackingReference: "invalid@ref!" }),
    ).rejects.toMatchObject({
      status: 422,
    });
  });

  it("updateShipmentStatus validates delivery partner exists", async () => {
    const { updateShipmentStatus } = await import("@/lib/shipments/service");
    adminHandler = (op) => {
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      if (op.table === "shipments" && !op.updateValues) {
        return {
          rows: [{
            id: "ship-1",
            order_id: ORDER_ID,
            dispatch_status: "ready",
            orders: { id: ORDER_ID, order_status: "ready_for_dispatch" },
          }],
          error: null,
        };
      }
      if (op.table === "delivery_partners") {
        return { rows: [], error: null };
      }
      throw new Error("unexpected");
    };
    await expect(
      updateShipmentStatus("ship-1", "dispatched", { deliveryPartnerId: "nonexistent" }),
    ).rejects.toMatchObject({
      status: 422,
    });
  });
});

describe("Shipment API", () => {
  it("GET /api/admin/shipments returns paginated list", async () => {
    const { GET } = await import("@/app/api/admin/shipments/route");
    adminHandler = (op) => {
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      if (op.table === "shipments") {
        return {
          rows: [{
            id: "ship-1",
            order_id: "order-1",
            dispatch_status: "ready",
            tracking_reference: "TRK123",
            dispatched_at: null,
            expected_delivery_date: null,
            created_at: "2026-10-01T10:00:00Z",
            orders: { order_number: "TS-261001-0001", delivery_pincode: "400001", customers: { name: "Test" } },
          }],
          error: null,
          count: 1,
        };
      }
      throw new Error("unexpected");
    };
    const res = await GET(new Request("http://localhost/api/admin/shipments"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; data: { total: number } };
    expect(json.ok).toBe(true);
    expect(json.data.total).toBe(1);
  });

  it("POST /api/admin/shipments/create requires orderId", async () => {
    const { POST } = await import("@/app/api/admin/shipments/create/route");
    const res = await POST(
      new Request("http://localhost/api/admin/shipments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/admin/shipments/create requires orderId", async () => {
    const { POST } = await import("@/app/api/admin/shipments/create/route");
    const res = await POST(
      new Request("http://localhost/api/admin/shipments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/admin/shipments/create requires orderId", async () => {
    const { POST } = await import("@/app/api/admin/shipments/create/route");
    const res = await POST(
      new Request("http://localhost/api/admin/shipments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("Shipment customer visibility", () => {
  it("tracking info is exposed to customers", async () => {
    const { getPayableOrder } = await import("@/lib/payments/order");
    adminHandler = (op) => {
      if (op.table === "orders" && !op.updateValues) {
        return {
          rows: [{
            id: "order-1",
            order_number: "TS-261001-0001",
            customer_id: "cust-1",
            subtotal: "100.00",
            delivery_charge: "10.00",
            total_amount: "110.00",
            delivery_pincode: "400001",
            delivery_partner_name: "Partner A",
            gstin_snapshot: null,
            tax_treatment: "non_gst",
            taxable_amount: "0.00",
            cgst_amount: "0.00",
            sgst_amount: "0.00",
            igst_amount: "0.00",
            billing_name: null,
            payment_status: "paid",
            order_status: "dispatched",
            created_at: "2026-10-01T10:00:00Z",
          }],
          error: null,
        };
      }
      if (op.table === "shipments") {
        return {
          rows: [{
            tracking_reference: "AWB123456",
            expected_delivery_date: "2026-10-05T10:00:00Z",
            dispatched_at: "2026-10-03T10:00:00Z",
            delivered_at: null,
          }],
          error: null,
        };
      }
      if (op.table === "customers") {
        return { rows: [{ name: "Test", phone: "9876543210" }], error: null };
      }
      if (op.table === "order_items") {
        return { rows: [], error: null };
      }
      if (op.table === "payments") {
        return { rows: [], error: null };
      }
      if (op.table === "order_events") {
        return { rows: [], error: null };
      }
      throw new Error("unexpected");
    };
    const order = await getPayableOrder("123e4567-e89b-12d3-a456-426614174001");
    expect(order).not.toBeNull();
    expect(order?.tracking).not.toBeNull();
    expect(order?.tracking?.trackingNumber).toBe("AWB123456");
    expect(order?.tracking?.estimatedDeliveryDate).toBe("5/10/2026");
  });

  it("tracking is null when no shipment exists", async () => {
    const { getPayableOrder } = await import("@/lib/payments/order");
    adminHandler = (op) => {
      if (op.table === "orders" && !op.updateValues) {
        return {
          rows: [{
            id: "order-1",
            order_number: "TS-261001-0001",
            customer_id: "cust-1",
            subtotal: "100.00",
            delivery_charge: "10.00",
            total_amount: "110.00",
            delivery_pincode: "400001",
            delivery_partner_name: "Partner A",
            gstin_snapshot: null,
            tax_treatment: "non_gst",
            taxable_amount: "0.00",
            cgst_amount: "0.00",
            sgst_amount: "0.00",
            igst_amount: "0.00",
            billing_name: null,
            payment_status: "pending",
            order_status: "pending_payment",
            created_at: "2026-10-01T10:00:00Z",
          }],
          error: null,
        };
      }
      if (op.table === "shipments") {
        return { rows: [], error: null };
      }
      if (op.table === "customers") {
        return { rows: [{ name: "Test", phone: "9876543210" }], error: null };
      }
      if (op.table === "order_items") {
        return { rows: [], error: null };
      }
      if (op.table === "payments") {
        return { rows: [], error: null };
      }
      if (op.table === "order_events") {
        return { rows: [], error: null };
      }
      throw new Error("unexpected");
    };
    const order = await getPayableOrder("123e4567-e89b-12d3-a456-426614174001");
    expect(order).not.toBeNull();
    expect(order?.tracking).toBeNull();
  });
});
