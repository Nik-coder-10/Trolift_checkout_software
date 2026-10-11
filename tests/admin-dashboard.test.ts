import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockClient,
  type MockOp,
  type MockResponder,
  type MockUser,
} from "@/tests/helpers/supabase-mock";

vi.mock("server-only", () => ({}));

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
  businessTimezone,
  getCommandCenterData,
} from "@/lib/admin/dashboard";
import { parseAdminOrderQuery } from "@/lib/admin/orders";
import { AppError } from "@/lib/api/errors";

beforeEach(() => {
  authUser = { id: "admin-1" };
  adminFlag = true;
  handler = () => {
    throw new Error("unexpected query");
  };
});

const profileResponder = (): MockResponder => (op) => {
  if (op.table === "profiles") {
    return { rows: adminFlag ? [{ is_admin: true }] : [], error: null };
  }
  throw new Error(`unexpected table ${op.table}`);
};

const RPC = "get_admin_command_center";

function samplePayload() {
  return {
    today: {
      orders_created: 3,
      payments_verified: 2,
      orders_processed: 1,
      shipments_dispatched: 1,
      deliveries_completed: 4,
    },
    summary: {
      total_orders: 42,
      paid_orders: 30,
      paid_revenue: "123456.78",
      avg_order_value: "4115.23",
      cancelled_orders: 2,
      repeat_customers: 7,
      low_stock_count: 3,
      out_of_stock_count: 1,
    },
    queues: {
      claims: {
        count: 2,
        items: [
          {
            order_id: "o1",
            order_number: "TS-1",
            amount: "500.00",
            customer_name: "Asha",
            reference: "UTR123",
            submitted_at: "2026-10-08T05:00:00Z",
          },
        ],
      },
      confirmed: { count: 1, items: [] },
      paid: { count: 0, items: [] },
      processing: { count: 0, items: [] },
      packed: { count: 0, items: [] },
      ready_for_dispatch: { count: 0, items: [] },
      delayed_shipments: {
        count: 1,
        items: [
          {
            shipment_id: "s1",
            order_id: "o2",
            order_number: "TS-2",
            customer_name: "Ravi",
            dispatch_status: "in_transit",
            expected_delivery_date: "2026-10-05T00:00:00Z",
            dispatched_at: "2026-10-01T00:00:00Z",
          },
        ],
      },
      low_stock: {
        count: 4,
        items: [
          {
            product_id: "p1",
            name: "Crate",
            stock_quantity: 2,
            low_stock_threshold: 5,
          },
        ],
      },
      failed_payments: { count: 0, items: [] },
    },
    recent_orders: {
      total: 42,
      page: 1,
      page_size: 20,
      items: [
        {
          order_id: "o1",
          order_number: "TS-1",
          customer_name: "Asha",
          total_amount: "500.00",
          payment_status: "submitted",
          order_status: "payment_submitted",
          dispatch_status: null,
          created_at: "2026-10-08T05:00:00Z",
        },
      ],
    },
  };
}

describe("authorization", () => {
  it("refuses non-admins before any query runs", async () => {
    adminFlag = false;
    handler = profileResponder();
    await expect(getCommandCenterData()).rejects.toBeInstanceOf(AppError);
  });

  it("refuses anonymous callers", async () => {
    authUser = null;
    handler = profileResponder();
    await expect(getCommandCenterData()).rejects.toBeInstanceOf(AppError);
  });
});

describe("consolidated query shape", () => {
  it("issues exactly one RPC with timezone + pagination args", async () => {
    const ops: MockOp[] = [];
    handler = (op) => {
      ops.push(op);
      if (op.table === "profiles") {
        return { rows: [{ is_admin: true }], error: null };
      }
      if (op.rpc === RPC) {
        const payload = samplePayload();
        const args = op.rpcArgs as { p_page?: number };
        payload.recent_orders.page = args.p_page ?? 1;
        return { rows: [payload], error: null };
      }
      throw new Error(`unexpected op ${op.table ?? op.rpc}`);
    };
    const data = await getCommandCenterData(2);
    const rpcOps = ops.filter((o) => o.rpc === RPC);
    expect(rpcOps).toHaveLength(1);
    const rpcArgs = rpcOps[0]?.rpcArgs as Record<string, unknown>;
    expect(rpcArgs).toMatchObject({
      p_timezone: businessTimezone(),
      p_page: 2,
      p_page_size: 20,
    });
    expect(data.queues.claims.count).toBe(2);
    expect(data.recent_orders.page).toBe(2);
  });

  it("paise conversion of paid revenue and average order value", async () => {
    handler = (op) => {
      if (op.table === "profiles") {
        return { rows: [{ is_admin: true }], error: null };
      }
      if (op.rpc === RPC) {
        return { rows: [samplePayload()], error: null };
      }
      throw new Error("unexpected query");
    };
    const data = await getCommandCenterData();
    // NUMERIC strings → integer paise, no float rounding drift.
    expect(Math.round(Number(data.summary.paid_revenue) * 100)).toBe(12345678);
    expect(Math.round(Number(data.summary.avg_order_value) * 100)).toBe(411523);
  });
});

describe("resilience + empty states", () => {
  it("maps RPC failure to a 500 AppError, never raw errors", async () => {
    handler = (op) => {
      if (op.table === "profiles") {
        return { rows: [{ is_admin: true }], error: null };
      }
      if (op.rpc === RPC) {
        return { rows: [], error: { message: "admin access required" } };
      }
      throw new Error("unexpected query");
    };
    const err = await getCommandCenterData().catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(500);
  });

  it("degrades malformed/missing fields to safe defaults (empty states)", async () => {
    handler = (op) => {
      if (op.table === "profiles") {
        return { rows: [{ is_admin: true }], error: null };
      }
      if (op.rpc === RPC) {
        return { rows: [{ today: null, summary: null, queues: null }], error: null };
      }
      throw new Error("unexpected query");
    };
    const data = await getCommandCenterData();
    expect(data.today.orders_created).toBe(0);
    expect(data.summary.total_orders).toBe(0);
    expect(data.summary.paid_revenue).toBe("0");
    expect(data.queues.claims.count).toBe(0);
    expect(data.queues.claims.items).toEqual([]);
    expect(data.queues.low_stock.count).toBe(0);
    expect(data.queues.failed_payments.items).toEqual([]);
    expect(data.recent_orders.items).toEqual([]);
    expect(data.recent_orders.total).toBe(0);
  });

  it("clamps invalid recent-orders page to page 1", async () => {
    const ops: MockOp[] = [];
    handler = (op) => {
      ops.push(op);
      if (op.table === "profiles") {
        return { rows: [{ is_admin: true }], error: null };
      }
      if (op.rpc === RPC) {
        return { rows: [samplePayload()], error: null };
      }
      throw new Error("unexpected query");
    };
    await getCommandCenterData(-5);
    expect(ops.find((o) => o.rpc === RPC)?.rpcArgs).toMatchObject({ p_page: -5 });
  });
});

describe("queue filter routing", () => {
  it("parses fulfilment statuses the queues link to", () => {
    expect(parseAdminOrderQuery({ status: "packed" }).orderStatus).toBe("packed");
    expect(
      parseAdminOrderQuery({ status: "ready_for_dispatch" }).orderStatus,
    ).toBe("ready_for_dispatch");
    expect(parseAdminOrderQuery({ payment: "submitted" }).paymentStatus).toBe(
      "submitted",
    );
    expect(parseAdminOrderQuery({ payment: "failed" }).paymentStatus).toBe(
      "failed",
    );
    // Unknown values are dropped, never echoed back.
    expect(parseAdminOrderQuery({ status: "hacker" }).orderStatus).toBeUndefined();
    expect(parseAdminOrderQuery({ payment: ";drop" }).paymentStatus).toBeUndefined();
  });

  it("does not leak customer PII in the RPC payload shape", async () => {
    handler = (op) => {
      if (op.table === "profiles") {
        return { rows: [{ is_admin: true }], error: null };
      }
      if (op.rpc === RPC) {
        return { rows: [samplePayload()], error: null };
      }
      throw new Error("unexpected query");
    };
    const data = await getCommandCenterData();
    const serialized = JSON.stringify(data);
    expect(serialized).not.toMatch(/"phone"/);
    expect(serialized).not.toMatch(/"email"/);
    expect(serialized).not.toMatch(/gstin/i);
  });
});

describe("business timezone", () => {
  it("defaults to Asia/Kolkata and honours env override", () => {
    expect(businessTimezone()).toBe("Asia/Kolkata");
    const prev = process.env.BUSINESS_TIMEZONE;
    process.env.BUSINESS_TIMEZONE = "Asia/Dubai";
    try {
      expect(businessTimezone()).toBe("Asia/Dubai");
    } finally {
      if (prev === undefined) delete process.env.BUSINESS_TIMEZONE;
      else process.env.BUSINESS_TIMEZONE = prev;
    }
  });
});
