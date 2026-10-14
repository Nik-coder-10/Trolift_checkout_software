import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockClient,
  type MockResponder,
} from "@/tests/helpers/supabase-mock";
import { resetRateLimits } from "@/lib/rate-limit/index";

vi.mock("server-only", () => ({}));

let authUser: { id: string } | null = { id: "admin-1" };
let adminFlag = true;
let handler: MockResponder = () => {
  throw new Error("unexpected query");
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createMockClient(handler, { authUser }),
}));

import { parseAdminCustomerQuery } from "@/lib/admin/customers";
import { GET as listGet } from "@/app/api/admin/customers/route";
import {
  GET as detailGet,
  PATCH as detailPatch,
} from "@/app/api/admin/customers/[id]/route";

beforeEach(() => {
  resetRateLimits();
  authUser = { id: "admin-1" };
  adminFlag = true;
  handler = (op) => {
    if (op.table === "profiles") {
      return { rows: adminFlag ? [{ is_admin: true }] : [], error: null };
    }
    throw new Error(`unexpected table ${op.table}`);
  };
});

const LIST_ROW = {
  id: "c1",
  name: "Repeat Buyer",
  phone: "+919810001111",
  email: "r@example.in",
  gstin: "27ABCDE1234F1Z0",
  created_at: "2026-10-04T00:00:00Z",
  order_count: 2,
  paid_count: 1,
  paid_total: "6749.00",
  latest_order_at: "2026-10-04T01:00:00Z",
};

const withRpc = (payload: unknown) => {
  handler = (op) => {
    if (op.table === "profiles") {
      return { rows: adminFlag ? [{ is_admin: true }] : [], error: null };
    }
    if (op.rpc === "get_admin_customers" || op.rpc === "get_admin_customer") {
      return { rows: [payload], error: null };
    }
    if (op.table === "customers") return { rows: [{ id: "c1" }], error: null };
    throw new Error(`unreachable ${op.table ?? op.rpc}`);
  };
};

describe("parseAdminCustomerQuery", () => {
  it("parses search, sort and page with safe defaults", () => {
    expect(
      parseAdminCustomerQuery({ q: " 98100 ", sort: "paid_desc", page: "2" }),
    ).toEqual({ q: "98100", sort: "paid_desc", page: 2, pageSize: 15 });
    expect(parseAdminCustomerQuery({ sort: "bogus", page: "0" })).toMatchObject({
      sort: "newest",
      page: 1,
    });
  });
});

describe("admin authorization", () => {
  it("rejects unauthenticated callers with 401", async () => {
    authUser = null;
    const res = await listGet(new Request("http://localhost/api/admin/customers"));
    expect(res.status).toBe(401);
  });

  it("rejects authenticated non-admins with 403", async () => {
    adminFlag = false;
    const res = await listGet(new Request("http://localhost/api/admin/customers"));
    expect(res.status).toBe(403);
  });
});

describe("customer list", () => {
  it("returns aggregates with exact paise and repeat signals", async () => {
    withRpc({ total: 1, customers: [LIST_ROW] });
    const res = await listGet(
      new Request("http://localhost/api/admin/customers?q=98100"),
    );
    const json = (await res.json()) as {
      ok: boolean;
      data: {
        total: number;
        customers: Array<Record<string, unknown>>;
      };
    };
    expect(json.ok).toBe(true);
    expect(json.data.total).toBe(1);
    expect(json.data.customers[0]).toMatchObject({
      name: "Repeat Buyer",
      orderCount: 2,
      paidCount: 1,
      paidTotalPaise: 674900,
    });
  });

  it("exposes only the documented projection (no leakage)", async () => {
    withRpc({ total: 1, customers: [LIST_ROW] });
    const res = await listGet(new Request("http://localhost/api/admin/customers"));
    const json = (await res.json()) as {
      ok: boolean;
      data: { customers: Array<Record<string, unknown>> };
    };
    expect(Object.keys(json.data.customers[0] ?? {}).sort()).toEqual(
      [
        "createdAt", "email", "gstin", "id", "latestOrderAt", "name",
        "orderCount", "paidCount", "paidTotalPaise", "phone",
      ].sort(),
    );
  });
});

describe("customer detail", () => {
  const detail = (over: Record<string, unknown> = {}) => ({
    customer: {
      id: "c1",
      name: "Repeat Buyer",
      phone: "+919810001111",
      email: "r@example.in",
      gstin: "27ABCDE1234F1Z0",
      created_at: "2026-10-04T00:00:00Z",
    },
    summary: {
      order_count: 2,
      paid_count: 1,
      cancelled_count: 1,
      paid_total: "6749.00",
      first_order_at: "2026-10-03T00:00:00Z",
      latest_order_at: "2026-10-04T01:00:00Z",
    },
    orders: [
      {
        order_id: "o1",
        order_number: "TS-1",
        total_amount: "6749.00",
        payment_status: "paid",
        order_status: "confirmed",
        created_at: "2026-10-04T01:00:00Z",
      },
    ],
    ...over,
  });

  it("returns profile, summary and snapshot history", async () => {
    withRpc(detail());
    const res = await detailGet(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "c1" }),
    });
    const json = (await res.json()) as {
      ok: boolean;
      data: Record<string, unknown>;
    };
    expect(json.ok).toBe(true);
    expect(json.data).toMatchObject({
      summary: { orderCount: 2, paidCount: 1, cancelledCount: 1, paidTotalPaise: 674900 },
    });
  });

  it("404s unknown customers without leaking", async () => {
    withRpc({ customer: null, summary: null, orders: [] });
    const res = await detailGet(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "c-missing" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("customer edit (profile only, never snapshots)", () => {
  it("updates contact info with normalization", async () => {
    withRpc({});
    const res = await detailPatch(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Repeat Buyer Pvt Ltd",
          phone: "09810001111",
          email: "",
          gstin: "27abcde1234f1z0",
        }),
      }),
      { params: Promise.resolve({ id: "c1" }) },
    );
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });

  it("rejects bad input and phone/email conflicts", async () => {
    const bad = await detailPatch(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "x", phone: "123", email: "", gstin: "" }),
      }),
      { params: Promise.resolve({ id: "c1" }) },
    );
    expect(bad.status).toBe(422);

    handler = (op) => {
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      if (op.table === "customers") {
        return { rows: [], error: { message: "duplicate", code: "23505" } };
      }
      throw new Error("unreachable");
    };
    const dup = await detailPatch(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Someone",
          phone: "+919810009999",
          email: "",
          gstin: "",
        }),
      }),
      { params: Promise.resolve({ id: "c1" }) },
    );
    expect(dup.status).toBe(409);
  });

  it("saves a complete billing master and rejects partial profiles", async () => {
    withRpc({});
    const billing = {
      name: "Repeat Buyer Pvt Ltd",
      addressLine: "14 Industrial Estate",
      city: "Mumbai",
      stateCode: "27",
      pincode: "400001",
    };
    const good = await detailPatch(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Repeat Buyer",
          phone: "+919810001111",
          email: "",
          gstin: "27ABCDE1234F1Z0",
          billing,
        }),
      }),
      { params: Promise.resolve({ id: "c1" }) },
    );
    expect(((await good.json()) as { ok: boolean }).ok).toBe(true);

    const partial = await detailPatch(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Repeat Buyer",
          phone: "+919810001111",
          email: "",
          gstin: "",
          billing: { ...billing, city: "", stateCode: "" },
        }),
      }),
      { params: Promise.resolve({ id: "c1" }) },
    );
    expect(partial.status).toBe(422);
  });

  it("rejects anonymous and non-admin editors", async () => {
    const body = { name: "X", phone: "+919810009999", email: "", gstin: "" };
    const req = () =>
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    authUser = null;
    expect((await detailPatch(req(), { params: Promise.resolve({ id: "c1" }) })).status).toBe(401);
    authUser = { id: "u1" };
    adminFlag = false;
    expect((await detailPatch(req(), { params: Promise.resolve({ id: "c1" }) })).status).toBe(403);
  });
});
