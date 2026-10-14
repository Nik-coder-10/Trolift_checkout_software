import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// server-only modules throw outside the Next server runtime by design.
vi.mock("server-only", () => ({}));
// revalidatePath needs the Next static-generation store; stub it out.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import {
  createMockClient,
  type MockResponder,
} from "@/tests/helpers/supabase-mock";
import { resetRateLimits } from "@/lib/rate-limit/index";

let authUser: { id: string } | null = { id: "admin-1" };
let adminFlag = true;
let handler: MockResponder = () => {
  throw new Error("unexpected query");
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    createMockClient((op) => {
      if (op.table === "profiles") {
        return { rows: adminFlag ? [{ is_admin: true }] : [], error: null };
      }
      return handler(op);
    }, { authUser }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createMockClient(handler),
}));

import {
  ADMIN_EVENT_DESCRIPTIONS,
  CUSTOMER_EVENT_LABELS,
  ORDER_EVENT_TYPES,
  assertEventMetadata,
  customerSafeTimeline,
  eventTypeForTransition,
} from "@/lib/orders/events";
import {
  logOrderEvent,
  markFulfillmentStep,
  transitionOrderStatus,
  verifyPaymentClaim,
} from "@/lib/admin/orders";
import { POST as fulfillmentPost } from "@/app/api/admin/orders/fulfillment/route";

const ORDER_ID = "123e4567-e89b-12d3-a456-426614170001";

beforeEach(() => {
  resetRateLimits();
  authUser = { id: "admin-1" };
  adminFlag = true;
  handler = () => {
    throw new Error("unexpected query");
  };
});

function wireOrderFlow(opts: {
  orderStatus?: string;
  paymentStatus?: string;
  priorEvents?: string[];
  failEventInsert?: boolean;
}) {
  const inserts: Array<Record<string, unknown>> = [];
  handler = (op) => {
    if (op.table === "orders" && op.updateValues === undefined) {
      return {
        rows: [
          {
            id: ORDER_ID,
            order_number: "TS-261005-0001",
            payment_status: opts.paymentStatus ?? "submitted",
            order_status: opts.orderStatus ?? "payment_submitted",
          },
        ],
        error: null,
      };
    }
    if (op.table === "payments" && op.updateValues === undefined) {
      return { rows: [{ id: "pay-1", status: "submitted" }], error: null };
    }
    if (op.updateValues !== undefined) {
      return { rows: [{ id: "x" }], error: null };
    }
    if (op.table === "order_events") {
      return {
        rows: (opts.priorEvents ?? []).map((t, i) => ({
          event_type: t,
          created_at: `2026-10-05T10:0${i}:00.000Z`,
        })),
        error: null,
      };
    }
    throw new Error(`unexpected ${op.table ?? op.rpc}`);
  };
  // Capture event inserts separately (insert also folds into updateValues
  // in the mock, so intercept by table + payload shape).
  const capture: Array<Record<string, unknown>> = inserts;
  const prev = handler;
  handler = (op) => {
    if (
      op.table === "order_events" &&
      op.updateValues !== undefined &&
      (op.updateValues as Record<string, unknown>)["order_id"] !== undefined
    ) {
      if (opts.failEventInsert) {
        return { rows: [], error: { message: "insert failed" } };
      }
      capture.push(op.updateValues as Record<string, unknown>);
      return { rows: [{ id: "e1" }], error: null };
    }
    return prev(op);
  };
  return inserts;
}

describe("event catalog (closed, customer-safe)", () => {
  it("covers every required lifecycle type", () => {
    for (const t of [
      "ORDER_CREATED",
      "PAYMENT_SUBMITTED",
      "PAYMENT_VERIFIED",
      "PAYMENT_REJECTED",
      "ORDER_CONFIRMED",
      "PROCESSING_STARTED",
      "PACKED",
      "READY_FOR_DISPATCH",
      "DISPATCHED",
      "DELIVERED",
      "CANCELLED",
    ] as const) {
      expect(ORDER_EVENT_TYPES).toContain(t);
      expect(ADMIN_EVENT_DESCRIPTIONS[t]).toBeTruthy();
      expect(CUSTOMER_EVENT_LABELS[t]).toBeTruthy();
    }
  });

  it("hides the legacy bucket from customers", () => {
    expect(
      (CUSTOMER_EVENT_LABELS as Partial<Record<string, string>>)[
        "STATUS_CHANGED"
      ],
    ).toBeUndefined();
    expect(ADMIN_EVENT_DESCRIPTIONS.STATUS_CHANGED).toBeTruthy();
  });

  it("maps transitions to canonical types", () => {
    expect(eventTypeForTransition("payment_submitted", "confirmed")).toBe(
      "ORDER_CONFIRMED",
    );
    expect(eventTypeForTransition("confirmed", "processing")).toBe(
      "PROCESSING_STARTED",
    );
    expect(eventTypeForTransition("processing", "dispatched")).toBe("DISPATCHED");
    expect(eventTypeForTransition("dispatched", "delivered")).toBe("DELIVERED");
    expect(eventTypeForTransition("pending_payment", "cancelled")).toBe(
      "CANCELLED",
    );
    expect(eventTypeForTransition("pending_payment", "payment_submitted")).toBe(
      "PAYMENT_SUBMITTED",
    );
  });
});

describe("event metadata allowlist (no secrets, no PII)", () => {
  it("accepts operational facts", () => {
    expect(
      assertEventMetadata({
        payment_method: "upi",
        item_count: 2,
        total_paise: 1304800,
        invoice_number: "INV/FY26-27/000042",
      }),
    ).toEqual({
      payment_method: "upi",
      item_count: 2,
      total_paise: 1304800,
      invoice_number: "INV/FY26-27/000042",
    });
    expect(assertEventMetadata({})).toEqual({});
  });

  it("rejects identifying, secret and malformed values", () => {
    for (const meta of [
      { utr: "UTR123" },
      { transaction_reference: "abc" },
      { phone: "+919876543210" },
      { email: "a@b.in" },
      { customer_address: "x" },
      { gstin: "27ABCDE1234F1Z0" },
      { api_key: "sk" },
      { password: "x" },
      { token: "x" },
    ]) {
      expect(() => assertEventMetadata(meta)).toThrow(/not allowed/);
    }
    expect(() => assertEventMetadata(null)).toThrow();
    expect(() => assertEventMetadata([])).toThrow();
    expect(() => assertEventMetadata({ item_count: NaN })).toThrow();
    expect(() =>
      assertEventMetadata({ invoice_number: "x".repeat(201) }),
    ).toThrow();
  });
});

describe("customer-safe timeline (labels + timestamps only)", () => {
  it("maps, filters and orders chronologically", () => {
    const out = customerSafeTimeline([
      { eventType: "DELIVERED", createdAt: "2026-10-07T10:00:00.000Z" },
      { eventType: "STATUS_CHANGED", createdAt: "2026-10-06T10:00:00.000Z" },
      { eventType: "BOGUS_TYPE", createdAt: "2026-10-05T10:00:00.000Z" },
      { eventType: "ORDER_CREATED", createdAt: "2026-10-05T09:00:00.000Z" },
    ]);
    expect(out).toEqual([
      { label: "Order placed", at: "2026-10-05T09:00:00.000Z" },
      { label: "Delivered", at: "2026-10-07T10:00:00.000Z" },
    ]);
    // No actor, note, id or metadata survives the projection.
    for (const entry of out) {
      expect(Object.keys(entry).sort()).toEqual(["at", "label"]);
    }
  });
});

describe("logOrderEvent (typed, loud on failure)", () => {
  it("writes the full canonical row", async () => {
    const inserts = wireOrderFlow({});
    await logOrderEvent({
      orderId: ORDER_ID,
      eventType: "DISPATCHED",
      actorType: "admin",
      actorUserId: "admin-1",
      fromStatus: "processing",
      toStatus: "dispatched",
      metadata: { item_count: 2 },
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      order_id: ORDER_ID,
      event_type: "DISPATCHED",
      actor_type: "admin",
      actor_user_id: "admin-1",
      action: "dispatched",
      from_status: "processing",
      to_status: "dispatched",
      metadata: { item_count: 2 },
    });
  });

  it("throws (never silently drops) when the insert fails", async () => {
    wireOrderFlow({ failEventInsert: true });
    await expect(
      logOrderEvent({
        orderId: ORDER_ID,
        eventType: "DISPATCHED",
        actorType: "admin",
        actorUserId: "admin-1",
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR", status: 500 });
  });

  it("rejects sensitive metadata before touching the database", async () => {
    const inserts = wireOrderFlow({});
    await expect(
      logOrderEvent({
        orderId: ORDER_ID,
        eventType: "PAYMENT_SUBMITTED",
        actorType: "customer",
        actorUserId: "cust-1",
        metadata: { utr: "UTR123" },
      }),
    ).rejects.toThrow(/not allowed/);
    expect(inserts).toHaveLength(0);
  });
});

describe("emission on state operations", () => {
  it("verify/approve emits PAYMENT_VERIFIED + ORDER_CONFIRMED", async () => {
    const inserts = wireOrderFlow({});
    // consume_reservation RPC success.
    const prev = handler;
    handler = (op) => {
      if (op.rpc === "consume_reservation") {
        return { rows: ["consumed"], error: null };
      }
      return prev(op);
    };
    const r = await verifyPaymentClaim(ORDER_ID, "approve");
    expect(r).toEqual({ paymentStatus: "paid", orderStatus: "confirmed" });
    const types = inserts.map((i) => i["event_type"]);
    expect(types).toEqual(["PAYMENT_VERIFIED", "ORDER_CONFIRMED"]);
    expect(inserts[0]).toMatchObject({
      actor_type: "admin",
      actor_user_id: "admin-1",
      metadata: { payment_method: "upi" },
    });
  });

  it("verify/reject emits only PAYMENT_REJECTED", async () => {
    const inserts = wireOrderFlow({});
    const r = await verifyPaymentClaim(ORDER_ID, "reject", "blurry screenshot");
    expect(r).toEqual({ paymentStatus: "failed", orderStatus: "pending_payment" });
    expect(inserts.map((i) => i["event_type"])).toEqual([
      "PAYMENT_REJECTED",
    ]);
    expect(inserts[0]).toMatchObject({ note: "blurry screenshot" });
  });

  it("transitions emit the mapped type; invalid ones write nothing", async () => {
    const inserts = wireOrderFlow({ orderStatus: "confirmed" });
    await transitionOrderStatus(ORDER_ID, "processing");
    expect(inserts.map((i) => i["event_type"])).toEqual(["PROCESSING_STARTED"]);
    await expect(transitionOrderStatus(ORDER_ID, "delivered")).rejects.toMatchObject({
      status: 409,
    });
    expect(inserts).toHaveLength(1);
  });

  it("cancellation emits CANCELLED", async () => {
    const inserts = wireOrderFlow({ orderStatus: "pending_payment" });
    // restore_reservation RPC success (no reservation held in this mock).
    const prev = handler;
    handler = (op) => {
      if (op.rpc === "restore_reservation") {
        return { rows: ["restored"], error: null };
      }
      return prev(op);
    };
    await transitionOrderStatus(ORDER_ID, "cancelled");
    expect(inserts.map((i) => i["event_type"])).toEqual(["CANCELLED"]);
  });
});

describe("fulfilment milestones (now part of order status lifecycle)", () => {
  it("packs then readies in order, each at most once", async () => {
    const done = new Set<string>();
    let currentStatus = "processing";
    const inserts = wireOrderFlow({ orderStatus: "processing" });
    const prev = handler;
    handler = (op) => {
      if (op.table === "order_events" && op.updateValues === undefined) {
        return {
          rows: [...done].map((t, i) => ({
            event_type: t,
            created_at: `2026-10-05T10:0${i}:00.000Z`,
          })),
          error: null,
        };
      }
      if (op.table === "orders" && op.updateValues) {
        currentStatus = (op.updateValues as Record<string, string>).order_status ?? currentStatus;
        return { rows: [{ id: ORDER_ID }], error: null };
      }
      if (op.table === "orders" && !op.updateValues) {
        return { rows: [{ id: ORDER_ID, order_number: "TS-261005-0001", payment_status: "submitted", order_status: currentStatus }], error: null };
      }
      return prev(op);
    };
    // Ready before packed is rejected.
    await expect(markFulfillmentStep(ORDER_ID, "ready_for_dispatch")).rejects.toMatchObject({
      status: 409,
    });
    const packed = await markFulfillmentStep(ORDER_ID, "packed");
    expect(packed).toEqual({ eventType: "PACKED" });
    done.add("PACKED");
    // Double pack is rejected.
    await expect(markFulfillmentStep(ORDER_ID, "packed")).rejects.toMatchObject({
      status: 409,
    });
    const ready = await markFulfillmentStep(ORDER_ID, "ready_for_dispatch");
    expect(ready).toEqual({ eventType: "READY_FOR_DISPATCH" });
    expect(inserts.map((i) => i["event_type"])).toEqual([
      "PACKED",
      "READY_FOR_DISPATCH",
    ]);
  });

  it("rejects fulfilment on non-fulfillable statuses", async () => {
    wireOrderFlow({ orderStatus: "delivered" });
    await expect(markFulfillmentStep(ORDER_ID, "packed")).rejects.toMatchObject({
      status: 409,
    });
    wireOrderFlow({ orderStatus: "cancelled" });
    await expect(
      markFulfillmentStep(ORDER_ID, "ready_for_dispatch"),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("fulfilment API requires admins and a closed step enum", async () => {
    wireOrderFlow({ orderStatus: "processing" });
    const body = (b: unknown) =>
      fulfillmentPost(
        new Request("http://localhost/x", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(b),
        }),
      );
    authUser = null;
    expect((await body({ orderId: ORDER_ID, step: "packed" })).status).toBe(401);
    authUser = { id: "u1" };
    adminFlag = false;
    expect((await body({ orderId: ORDER_ID, step: "packed" })).status).toBe(403);
    authUser = { id: "admin-1" };
    adminFlag = true;
    expect(
      (await body({ orderId: ORDER_ID, step: "teleport" })).status,
    ).toBe(400);
    const ok = await body({ orderId: ORDER_ID, step: "packed" });
    expect(ok.status).toBe(200);
  });
});

describe("migration RLS contract (order_events)", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "0014_order_events.sql"),
    "utf8",
  );

  it("grants customers nothing and forbids updates/deletes", () => {
    expect(sql).toMatch(/to authenticated/);
    expect(sql).not.toMatch(/to anon/);
    expect(sql).not.toMatch(/for update/i);
    expect(sql).not.toMatch(/for delete/i);
    expect(sql).toMatch(/No update\/delete policies exist/);
  });

  it("0021 backfill and constraints exist", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase", "migrations", "0021_order_event_types.sql"),
      "utf8",
    );
    for (const t of ["ORDER_CREATED", "PACKED", "INVOICE_ISSUED", "STATUS_CHANGED"]) {
      expect(migration).toContain(`'${t}'`);
    }
    expect(migration).toContain("order_events_created_idx");
    expect(migration).toContain("order_events_type_idx");
    expect(migration).toContain("actor_type in ('customer', 'admin', 'system')");
  });
});
