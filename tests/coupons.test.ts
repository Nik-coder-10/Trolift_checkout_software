import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockClient,
  type MockResponder,
} from "@/tests/helpers/supabase-mock";
import { resetRateLimits } from "@/lib/rate-limit/index";

vi.mock("server-only", () => ({}));

interface CouponFixture {
  code: string;
  discount_paise: number;
  first_order_only: boolean;
  active: boolean;
  valid_from: string | null;
  valid_until: string | null;
}

let coupons: CouponFixture[] = [];
interface PriorOrder {
  phone: string;
  status: string;
}
let priorOrders: PriorOrder[] = [];
let couponsDbBroken = false;

const handler: MockResponder = (op) => {
  if (op.table === "coupons") {
    if (couponsDbBroken) return { rows: [], error: { message: "boom" } };
    const filter = op.filters.find((f) => f.col === "code");
    const code = typeof filter?.val === "string" ? filter.val : null;
    return {
      rows: code === null ? coupons : coupons.filter((c) => c.code === code),
      error: null,
    };
  }
  if (op.table === "orders") {
    const phone = op.filters.find(
      (f) => f.col === "customer_phone_snapshot" && f.op === "eq",
    )?.val;
    const matches = priorOrders.filter(
      (o) => typeof phone === "string" && o.phone === phone,
    );
    const exclusion = op.filters.find(
      (f) => f.col === "order_status" && f.op === "not",
    );
    if (!exclusion) {
      // The query asked for every prior order regardless of status.
      return { rows: [], error: null, count: matches.length };
    }
    const { operator, value } = exclusion.val as {
      operator: string;
      value: unknown;
    };
    if (operator !== "in") {
      throw new Error(`unexpected order_status operator ${operator}`);
    }
    const excluded = String(value)
      .replace(/[()]/g, "")
      .split(",");
    return {
      rows: [],
      error: null,
      count: matches.filter((o) => !excluded.includes(o.status)).length,
    };
  }
  throw new Error(`unexpected admin op on ${op.table ?? op.rpc}`);
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createMockClient(handler),
}));

import { resolveCoupon } from "@/lib/coupons/resolve";
import { COUPON_CODE_RE, normalizeCouponCode } from "@/lib/coupons/code";
import { validateCouponInput } from "@/lib/admin/coupons";
import { POST as validatePost } from "@/app/api/coupons/validate/route";

const ROW: CouponFixture = {
  code: "FIRST300",
  discount_paise: 30000,
  first_order_only: false,
  active: true,
  valid_from: null,
  valid_until: null,
};

const PHONE = "+919876543210";

beforeEach(() => {
  resetRateLimits();
  coupons = [ROW];
  priorOrders = [];
  couponsDbBroken = false;
});

const validate = (body: unknown): Promise<Response> =>
  validatePost(
    new Request("http://localhost/api/coupons/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe("coupon code helpers", () => {
  it("normalizes any casing or padding to the canonical code", () => {
    expect(normalizeCouponCode("  first300 ")).toBe("FIRST300");
    expect(normalizeCouponCode(undefined)).toBe("");
    expect(COUPON_CODE_RE.test("FIRST300")).toBe(true);
    expect(COUPON_CODE_RE.test("first300")).toBe(false);
    expect(COUPON_CODE_RE.test("AB")).toBe(false);
    expect(COUPON_CODE_RE.test("CODE WITH SPACE")).toBe(false);
  });
});

describe("resolveCoupon", () => {
  it("resolves an active code and returns the discount preview", async () => {
    await expect(
      resolveCoupon({ code: " first300 ", phone: null }),
    ).resolves.toEqual({
      code: "FIRST300",
      discountPaise: 30000,
      firstOrderOnly: false,
    });
  });

  it("rejects malformed codes before touching the database", async () => {
    await expect(
      resolveCoupon({ code: "!!", phone: null }),
    ).rejects.toMatchObject({
      status: 422,
      message: "Enter a valid redeem code.",
    });
  });

  it("treats unknown and inactive codes as not valid", async () => {
    await expect(
      resolveCoupon({ code: "NOPE1", phone: null }),
    ).rejects.toMatchObject({ message: "This redeem code is not valid." });

    coupons = [{ ...ROW, active: false }];
    await expect(
      resolveCoupon({ code: "FIRST300", phone: null }),
    ).rejects.toMatchObject({ message: "This redeem code is not valid." });
  });

  it("rejects a code before its window opens and after it closes", async () => {
    coupons = [
      {
        ...ROW,
        valid_from: new Date(Date.now() + 60_000).toISOString(),
      },
    ];
    await expect(
      resolveCoupon({ code: "FIRST300", phone: null }),
    ).rejects.toMatchObject({ message: "This redeem code is not active yet." });

    coupons = [
      {
        ...ROW,
        valid_until: new Date(Date.now() - 60_000).toISOString(),
      },
    ];
    await expect(
      resolveCoupon({ code: "FIRST300", phone: null }),
    ).rejects.toMatchObject({ message: "This redeem code has expired." });
  });

  it("requires a mobile number for first-time-buyer codes", async () => {
    coupons = [{ ...ROW, first_order_only: true }];
    await expect(
      resolveCoupon({ code: "FIRST300", phone: null }),
    ).rejects.toMatchObject({
      message: "Enter your mobile number to use this code.",
    });
  });

  it("only lets first-time buyers use a first-order code", async () => {
    coupons = [{ ...ROW, code: "NAV300", first_order_only: true }];

    await expect(
      resolveCoupon({ code: "NAV300", phone: PHONE }),
    ).resolves.toMatchObject({ code: "NAV300", firstOrderOnly: true });

    priorOrders = [{ phone: PHONE, status: "confirmed" }];
    await expect(
      resolveCoupon({ code: "NAV300", phone: PHONE }),
    ).rejects.toMatchObject({ message: "This code is only for first-time buyers." });
  });

  it("ignores abandoned checkouts and cancelled orders", async () => {
    coupons = [{ ...ROW, first_order_only: true }];
    priorOrders = [
      { phone: PHONE, status: "draft" },
      { phone: PHONE, status: "pending_payment" },
      { phone: PHONE, status: "cancelled" },
    ];

    await expect(
      resolveCoupon({ code: "FIRST300", phone: PHONE }),
    ).resolves.toMatchObject({ code: "FIRST300", firstOrderOnly: true });
  });

  it("counts a submitted payment as a prior order", async () => {
    coupons = [{ ...ROW, first_order_only: true }];
    priorOrders = [{ phone: PHONE, status: "payment_submitted" }];

    await expect(
      resolveCoupon({ code: "FIRST300", phone: PHONE }),
    ).rejects.toMatchObject({ message: "This code is only for first-time buyers." });
  });

  it("never lets the discount zero out the payable total", async () => {
    await expect(
      resolveCoupon({ code: "FIRST300", phone: null, totalPaise: 30000 }),
    ).rejects.toMatchObject({
      message: "Add more items to this order to use this code.",
    });
    await expect(
      resolveCoupon({ code: "FIRST300", phone: null, totalPaise: 30001 }),
    ).resolves.toMatchObject({ discountPaise: 30000 });
  });

  it("surfaces database failures as a retryable server error", async () => {
    couponsDbBroken = true;
    await expect(
      resolveCoupon({ code: "FIRST300", phone: null }),
    ).rejects.toMatchObject({
      status: 500,
      message: "Could not check this redeem code. Please try again.",
    });
  });
});

describe("POST /api/coupons/validate (advisory preview)", () => {
  it("returns the normalized code and discount for an active code", async () => {
    const res = await validate({ code: "first300", phone: "9876543210" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: { code: string; discountPaise: number; firstOrderOnly: boolean };
    };
    expect(json.ok).toBe(true);
    expect(json.data).toEqual({
      code: "FIRST300",
      discountPaise: 30000,
      firstOrderOnly: false,
    });
  });

  it("answers 422 with the exact message checkout should show", async () => {
    const res = await validate({ code: "GONE99", phone: "" });
    expect(res.status).toBe(422);
    const json = (await res.json()) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.message).toBe("This redeem code is not valid.");
  });

  it("rejects malformed codes with the entry message", async () => {
    const res = await validate({ code: "no spaces allowed", phone: "" });
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toBe("Enter a valid redeem code.");
  });

  it("asks for the mobile number on first-order codes", async () => {
    coupons = [{ ...ROW, first_order_only: true }];
    const res = await validate({ code: "FIRST300", phone: "" });
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toBe(
      "Enter your mobile number to use this code.",
    );
  });

  it("rate-limits the validation endpoint after the coupon budget", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const res = await validate({ code: "FIRST300", phone: "" });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe("validateCouponInput (admin create/edit)", () => {
  it("accepts a full code and normalises it", () => {
    const input = validateCouponInput({
      code: " diwali200 ",
      discountRupees: 200,
      firstOrderOnly: true,
      isActive: true,
      validFrom: "2026-10-15T00:00",
      validUntil: "2026-11-01T00:00",
    });
    expect(input.code).toBe("DIWALI200");
    expect(input.discountPaise).toBe(20000);
    expect(input.firstOrderOnly).toBe(true);
    expect(input.isActive).toBe(true);
    // Round-trips to the same instant regardless of the runner's TZ.
    expect(Date.parse(input.validFrom ?? "")).toBe(
      Date.parse("2026-10-15T00:00"),
    );
    expect(Date.parse(input.validUntil ?? "")).toBe(
      Date.parse("2026-11-01T00:00"),
    );
  });

  it("defaults the window to null and active to true", () => {
    const input = validateCouponInput({ code: "FLAT50", discountRupees: 50 });
    expect(input.validFrom).toBeNull();
    expect(input.validUntil).toBeNull();
    expect(input.isActive).toBe(true);
    expect(input.firstOrderOnly).toBe(false);
  });

  it("rejects bad codes, non-positive discounts and inverted windows", () => {
    expect(() => validateCouponInput({ code: "x", discountRupees: 10 })).toThrow(
      /3–32 letters and digits/,
    );
    expect(() =>
      validateCouponInput({ code: "FLAT10", discountRupees: 0 }),
    ).toThrow(/above zero/);
    expect(() =>
      validateCouponInput({ code: "FLAT10", discountRupees: "ten" }),
    ).toThrow(/above zero/);
    expect(() =>
      validateCouponInput({
        code: "FLAT10",
        discountRupees: 10,
        validFrom: "2026-11-01T00:00",
        validUntil: "2026-10-01T00:00",
      }),
    ).toThrow(/after its start/);
    expect(() =>
      validateCouponInput({
        code: "FLAT10",
        discountRupees: 10,
        validFrom: "not-a-date",
      }),
    ).toThrow(/ISO timestamps/);
  });
});
