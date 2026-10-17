import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockClient,
  type MockOp,
  type MockResponder,
  type MockUser,
} from "@/tests/helpers/supabase-mock";
import { resetRateLimits } from "@/lib/rate-limit/index";

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
  escapeLikeWildcards,
  listAdminOrders,
  listPaymentClaims,
  parseAdminOrderQuery,
  transitionOrderStatus,
  verifyPaymentClaim,
} from "@/lib/admin/orders";
import { POST as statusPost } from "@/app/api/admin/orders/status/route";
import { POST as verifyPost } from "@/app/api/admin/payments/verify/route";
import { GET as listGet } from "@/app/api/admin/orders/route";
import { GET as proofGet } from "@/app/api/admin/payments/proof/route";

let proofBytes: Uint8Array | null = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
vi.mock("@/lib/storage/payment-proofs", () => ({
  PAYMENT_PROOF_BUCKET: "payment-proofs",
  downloadPaymentProof: (path: string) =>
    proofBytes === null || path.includes("missing")
      ? Promise.resolve(null)
      : Promise.resolve({
          bytes: Buffer.from(proofBytes),
          contentType: "image/png" as const,
        }),
}));

beforeEach(() => {
  resetRateLimits();
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

const ORDER = {
  id: "o1",
  order_number: "TS-261004-0001",
  payment_status: "submitted",
  order_status: "payment_submitted",
};
const PAYMENT = { id: "p1", status: "submitted" };

describe("parseAdminOrderQuery", () => {
  it("parses search, enums, dates, sort and page", () => {
    expect(
      parseAdminOrderQuery({
        q: "  TS-1 ",
        payment: "submitted",
        status: "payment_submitted",
        from: "2026-10-01",
        to: "not-a-date",
        sort: "total_desc",
        page: "2",
      }),
    ).toMatchObject({
      q: "TS-1",
      paymentStatus: "submitted",
      orderStatus: "payment_submitted",
      sort: "total_desc",
      page: 2,
      pageSize: 15,
    });
  });

  it("strips postgrest metacharacters and drops unknown enums", () => {
    const q = parseAdminOrderQuery({
      q: "a,b(c)",
      payment: "bogus",
      status: "bogus",
      sort: "bogus",
      page: "0",
    });
    expect(q.q).toBe("abc");
    expect(q.paymentStatus).toBeUndefined();
    expect(q.orderStatus).toBeUndefined();
    expect(q.sort).toBe("newest");
    expect(q.page).toBe(1);
  });
});

describe("admin authorization", () => {
  it("rejects unauthenticated callers with 401", async () => {
    authUser = null;
    handler = profileResponder();
    const res = await listGet(
      new Request("http://localhost/api/admin/orders"),
    );
    expect(res.status).toBe(401);
  });

  it("rejects authenticated non-admins with 403", async () => {
    adminFlag = false;
    handler = profileResponder();
    const res = await listGet(
      new Request("http://localhost/api/admin/orders"),
    );
    expect(res.status).toBe(403);
  });

  it("rejects mutations for non-admins", async () => {
    adminFlag = false;
    handler = profileResponder();
    const res = await statusPost(
      new Request("http://localhost/api/admin/orders/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: "o1", toStatus: "confirmed" }),
      }),
    );
    expect(res.status).toBe(403);
  });
});

function wireOrderFlow() {
  handler = (op) => {
    if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
    // Stock movements converge inside their RPCs (mocked as success here;
    // dedicated inventory tests drive shortfall/idempotency paths).
    if (op.rpc === "consume_reservation" || op.rpc === "restore_reservation") {
      return { rows: ["consumed"], error: null };
    }
    if (op.table === "orders" && !op.updateValues) {
      return { rows: [{ ...ORDER }], error: null };
    }
    if (op.table === "payments" && !op.updateValues) {
      return { rows: [{ ...PAYMENT }], error: null };
    }
    if (op.updateValues) return { rows: [{ id: "x" }], error: null };
    if (op.table === "order_events") return { rows: [{ id: "e1" }], error: null };
    if (op.table === "customers") return { rows: [], error: null };
    throw new Error(`unexpected ${op.table}`);
  };
}

describe("payment verification", () => {
  it("approves submitted claims to paid/confirmed", async () => {
    wireOrderFlow();
    const r = await verifyPaymentClaim("o1", "approve");
    expect(r).toEqual({ paymentStatus: "paid", orderStatus: "confirmed" });
  });

  it("rejects claims back to failed/pending_payment", async () => {
    wireOrderFlow();
    const res = await verifyPost(
      new Request("http://localhost/api/admin/payments/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: "o1", decision: "reject" }),
      }),
    );
    const json = (await res.json()) as {
      ok: boolean;
      data: Record<string, unknown>;
    };
    expect(json.ok).toBe(true);
    expect(json.data).toMatchObject({
      paymentStatus: "failed",
      orderStatus: "pending_payment",
    });
  });

  it("refuses invalid decisions and non-claim states", async () => {
    wireOrderFlow();
    const badDecision = await verifyPost(
      new Request("http://localhost/api/admin/payments/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: "o1", decision: "paid" }),
      }),
    );
    expect(badDecision.status).toBe(400);

    handler = (op) => {
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      if (op.table === "orders" && !op.updateValues) {
        return {
          rows: [{ ...ORDER, payment_status: "paid", order_status: "confirmed" }],
          error: null,
        };
      }
      if (op.table === "payments" && !op.updateValues) {
        return { rows: [{ ...PAYMENT, status: "paid" }], error: null };
      }
      if (op.updateValues) return { rows: [{ id: "x" }], error: null };
      if (op.table === "order_events") return { rows: [{ id: "e1" }], error: null };
      throw new Error("unreachable");
    };
    const res = await verifyPost(
      new Request("http://localhost/api/admin/payments/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: "o1", decision: "approve" }),
      }),
    );
    expect(res.status).toBe(409);
  });
});

describe("order status transitions", () => {
  it("advances through valid transitions", async () => {
    wireOrderFlow();
    // payment_submitted is not directly advancable here; use confirmed order.
    handler = (op) => {
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      if (op.table === "orders" && !op.updateValues) {
        return {
          rows: [{ ...ORDER, payment_status: "paid", order_status: "confirmed" }],
          error: null,
        };
      }
      if (op.updateValues) return { rows: [{ id: "x" }], error: null };
      if (op.table === "order_events") return { rows: [{ id: "e1" }], error: null };
      throw new Error("unreachable");
    };
    const r = await transitionOrderStatus("o1", "processing");
    expect(r).toEqual({ orderStatus: "processing" });
  });

  it("rejects jumps and unknown targets", async () => {
    wireOrderFlow();
    const res = await statusPost(
      new Request("http://localhost/api/admin/orders/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: "o1", toStatus: "delivered" }),
      }),
    );
    expect(res.status).toBe(409);

    const unknown = await statusPost(
      new Request("http://localhost/api/admin/orders/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: "o1", toStatus: "shipped_by_dragon" }),
      }),
    );
    expect(unknown.status).toBe(400);
  });

  it("ignores client-supplied money (no such fields exist)", async () => {
    wireOrderFlow();
    const res = await statusPost(
      new Request("http://localhost/api/admin/orders/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: "o1",
          toStatus: "confirmed",
          total: 1,
          subtotal: 1,
        }),
      }),
    );
    // payment_submitted → confirmed is legal; totals are simply not read.
    expect(res.status).toBe(200);
  });

  it("detects concurrent mutation races via optimistic guards", async () => {
    handler = (op) => {
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      if (op.table === "orders" && !op.updateValues) {
        return { rows: [{ ...ORDER }], error: null };
      }
      if (op.updateValues) return { rows: [], error: null };
      if (op.table === "payments" && !op.updateValues) {
        return { rows: [{ ...PAYMENT }], error: null };
      }
      if (op.table === "order_events") return { rows: [{ id: "e1" }], error: null };
      throw new Error("unreachable");
    };
    const res = await statusPost(
      new Request("http://localhost/api/admin/orders/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: "o1", toStatus: "confirmed" }),
      }),
    );
    expect(res.status).toBe(409);
  });
});

describe("admin order list", () => {
  it("returns paginated projections with customer data", async () => {
    handler = (op) => {
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      if (op.table === "customers") return { rows: [{ id: "c1" }], error: null };
      if (op.table === "orders") {
        return {
          rows: [
            {
              id: "o1",
              order_number: "TS-1",
              created_at: "2026-10-04T00:00:00Z",
              subtotal: "100.00",
              delivery_charge: "10.00",
              total_amount: "110.00",
              payment_status: "pending",
              order_status: "pending_payment",
              customers: { name: "A", phone: "+911111111111" },
            },
          ],
          error: null,
          count: 1,
        };
      }
      throw new Error(`unreachable ${op.table}`);
    };
    const res = await listGet(
      new Request("http://localhost/api/admin/orders?q=TS-1&page=1"),
    );
    const json = (await res.json()) as {
      ok: boolean;
      data: { orders: Array<Record<string, unknown>>; total: number };
    };
    expect(json.ok).toBe(true);
    expect(json.data.total).toBe(1);
    expect(json.data.orders[0]).toMatchObject({
      orderNumber: "TS-1",
      customerName: "A",
      totalPaise: 11000,
    });
  });
});

describe("admin order search LIKE escaping", () => {
  it("escapes backslash, percent and underscore; leaves the rest alone", () => {
    expect(escapeLikeWildcards("100%_\\")).toBe("100\\%\\_\\\\");
    expect(escapeLikeWildcards("TS-261001-0001")).toBe("TS-261001-0001");
    expect(escapeLikeWildcards("")).toBe("");
  });

  function wireSearch(customers: Array<{ id: string }>): {
    seen: MockOp[];
  } {
    const seen: MockOp[] = [];
    handler = (op) => {
      seen.push(op);
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      if (op.table === "customers") return { rows: customers, error: null };
      if (op.table === "orders") return { rows: [], error: null, count: 0 };
      throw new Error(`unexpected ${op.table}`);
    };
    return { seen };
  }

  it("passes an escaped ilike pattern when no customer matches", async () => {
    const { seen } = wireSearch([]);
    await listAdminOrders(parseAdminOrderQuery({ q: "100%_x" }));
    const ilike = seen
      .find((op) => op.table === "orders")
      ?.filters.find((f) => f.op === "ilike");
    expect(ilike?.val).toBe("%100\\%\\_x%");
  });

  it("escapes the pattern inside or() when customers match", async () => {
    const { seen } = wireSearch([{ id: "c1" }]);
    await listAdminOrders(parseAdminOrderQuery({ q: "100%_x" }));
    const or = seen
      .find((op) => op.table === "orders")
      ?.filters.find((f) => f.op === "or");
    expect(or?.val).toBe(
      "order_number.ilike.%100\\%\\_x%,customer_id.in.(c1)",
    );
  });

  it("leaves ordinary search terms untouched", async () => {
    const { seen } = wireSearch([]);
    await listAdminOrders(parseAdminOrderQuery({ q: "TS-261001" }));
    const ilike = seen
      .find((op) => op.table === "orders")
      ?.filters.find((f) => f.op === "ilike");
    expect(ilike?.val).toBe("%TS-261001%");
  });
});

describe("payment claims inbox", () => {
  function wireClaims(): { seen: MockOp[] } {
    const seen: MockOp[] = [];
    handler = (op) => {
      seen.push(op);
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      if (op.table === "orders") {
        return {
          rows: [
            {
              id: "o1",
              order_number: "TS-1",
              created_at: "2026-10-05T00:00:00Z",
              total_amount: "110.00",
              customers: { name: "A", phone: "+911111111111" },
            },
          ],
          error: null,
          count: 1,
        };
      }
      if (op.table === "payments") {
        return {
          rows: [
            {
              order_id: "o1",
              transaction_reference: "123456789012",
              updated_at: "2026-10-05T01:00:00Z",
              proof_path: "o1/abc.png",
            },
          ],
          error: null,
        };
      }
      throw new Error(`unexpected ${op.table}`);
    };
    return { seen };
  }

  it("lists submitted claims with reference, proof path and totals", async () => {
    const { seen } = wireClaims();
    const result = await listPaymentClaims(1);
    expect(result.total).toBe(1);
    expect(result.claims[0]).toMatchObject({
      orderId: "o1",
      orderNumber: "TS-1",
      customerName: "A",
      totalPaise: 11000,
      reference: "123456789012",
      proofPath: "o1/abc.png",
    });
    const ordersOp = seen.find((op) => op.table === "orders");
    expect(ordersOp?.filters).toContainEqual({
      col: "payment_status",
      op: "eq",
      val: "submitted",
    });
  });

  it("degrades to null reference/proof when the payments query fails", async () => {
    handler = (op) => {
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      if (op.table === "orders") {
        return {
          rows: [
            {
              id: "o1",
              order_number: "TS-1",
              created_at: "2026-10-05T00:00:00Z",
              total_amount: "110.00",
              customers: { name: "A", phone: "+911111111111" },
            },
          ],
          error: null,
          count: 1,
        };
      }
      if (op.table === "payments") return { rows: [], error: { message: "boom" } };
      throw new Error(`unexpected ${op.table}`);
    };
    const result = await listPaymentClaims(1);
    expect(result.claims[0]).toMatchObject({
      reference: null,
      proofPath: null,
    });
  });

  it("throws for non-admins", async () => {
    adminFlag = false;
    handler = profileResponder();
    await expect(listPaymentClaims(1)).rejects.toMatchObject({ status: 403 });
  });
});

describe("payment proof streaming route", () => {
  beforeEach(() => {
    proofBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  });

  it("rejects unauthenticated callers with 401", async () => {
    authUser = null;
    handler = profileResponder();
    const res = await proofGet(
      new Request("http://localhost/api/admin/payments/proof?path=o1/abc.png"),
    );
    expect(res.status).toBe(401);
  });

  it("streams the screenshot for admins", async () => {
    handler = profileResponder();
    const res = await proofGet(
      new Request("http://localhost/api/admin/payments/proof?path=o1/abc.png"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("rejects malformed paths and maps missing objects to 404", async () => {
    handler = profileResponder();
    const traversal = await proofGet(
      new Request("http://localhost/api/admin/payments/proof?path=../secret.png"),
    );
    expect(traversal.status).toBe(400);
    const missing = await proofGet(
      new Request("http://localhost/api/admin/payments/proof?path=o1/missing.png"),
    );
    expect(missing.status).toBe(404);
  });
});
