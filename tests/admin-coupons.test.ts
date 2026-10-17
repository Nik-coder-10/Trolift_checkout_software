import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockClient,
  type MockResponder,
} from "@/tests/helpers/supabase-mock";
import { resetRateLimits } from "@/lib/rate-limit/index";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let authUser: { id: string } | null = { id: "admin-1" };
let adminFlag = true;
let insertError: { message: string; code?: string } | null = null;
let handler: MockResponder = () => {
  throw new Error("unexpected query");
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createMockClient(handler, { authUser }),
}));

import { GET, POST } from "@/app/api/admin/coupons/route";
import { PATCH } from "@/app/api/admin/coupons/[id]/route";

const COUPON_ID = "9aa1b2c3-0001-4000-8000-000000000009";

const row = {
  id: COUPON_ID,
  code: "FIRST300",
  discount_paise: 30000,
  first_order_only: false,
  active: true,
  valid_from: null,
  valid_until: null,
  updated_at: "2026-10-17T10:00:00+05:30",
};

beforeEach(() => {
  resetRateLimits();
  authUser = { id: "admin-1" };
  adminFlag = true;
  insertError = null;
  handler = (op) => {
    if (op.table === "profiles") {
      return { rows: adminFlag ? [{ is_admin: true }] : [], error: null };
    }
    if (op.table === "coupons") {
      if (op.updateValues !== undefined) {
        // insert() and update() both arrive here.
        return { rows: [{ id: COUPON_ID }], error: insertError };
      }
      return { rows: [row], error: null };
    }
    throw new Error(`unexpected table ${op.table ?? op.rpc}`);
  };
});

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const patch = (body: unknown, id: string) =>
  PATCH(
    new Request("http://localhost/x", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

const CODE = {
  code: " diwali200 ",
  discountRupees: 200,
  firstOrderOnly: true,
  isActive: true,
  validFrom: null,
  validUntil: "2026-11-01T00:00:00.000Z",
};

describe("GET /api/admin/coupons", () => {
  it("lists codes with rupee discounts mapped out of the decimal column", async () => {
    const res = await GET(new Request("http://localhost/x"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; data: unknown[] };
    expect(json.ok).toBe(true);
    expect(json.data).toEqual([
      {
        id: COUPON_ID,
        code: "FIRST300",
        discountPaise: 30000,
        firstOrderOnly: false,
        isActive: true,
        validFrom: null,
        validUntil: null,
        updatedAt: "2026-10-17T10:00:00+05:30",
      },
    ]);
  });

  it("rejects anonymous callers before any query runs", async () => {
    authUser = null;
    const res = await GET(new Request("http://localhost/x"));
    expect(res.status).toBe(401);
  });

  it("rejects signed-in non-admins", async () => {
    adminFlag = false;
    const res = await GET(new Request("http://localhost/x"));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/coupons", () => {
  it("creates a code with the whitelisted, normalized fields", async () => {
    const res = await post(CODE);
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      ok: boolean;
      data: { id: string };
    };
    expect(json.data.id).toBe(COUPON_ID);
  });

  it("rejects a malformed body before touching the database", async () => {
    const res = await post({ code: "x", discountRupees: 10 });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toMatch(/3–32 letters and digits/);
  });

  it("answers 400 when the code already exists", async () => {
    insertError = { message: "duplicate key", code: "23505" };
    const res = await post(CODE);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toBe("That redeem code already exists.");
  });

  it("rejects anonymous writes", async () => {
    authUser = null;
    const res = await post(CODE);
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/admin/coupons/[id]", () => {
  it("updates one code (deactivate round-trip)", async () => {
    const res = await patch({ ...CODE, isActive: false }, COUPON_ID);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; data: { id: string } };
    expect(json.data.id).toBe(COUPON_ID);
  });

  it("rejects anonymous updates", async () => {
    authUser = null;
    const res = await patch(CODE, COUPON_ID);
    expect(res.status).toBe(401);
  });
});
