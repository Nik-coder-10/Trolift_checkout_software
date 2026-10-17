import { describe, expect, it, vi } from "vitest";

// request.ts pulls ORDER_MAX_QTY from the server-only quote module.
vi.mock("server-only", () => ({}));
import { parseOrderRequestBody } from "@/lib/orders/request";
import { normalizePhone } from "@/lib/validations/common";
import { AppError } from "@/lib/api/errors";

const PID = "b1c2d3e4-0004-4000-8000-000000000004";
const KEY = "c0ffee00-0001-4000-8000-000000000001";

const body = (over: Record<string, unknown> = {}) => ({
  items: [{ productId: PID, quantity: 2 }],
  customer: {
    name: "Demo Traders",
    phone: "+919876543210",
    email: "",
    gstin: "",
  },
  pincode: "400001",
  shippingAddress: "24, MG Road, Indiranagar, Bengaluru 560038",
  idempotencyKey: KEY,
  ...over,
});

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  throw new Error("expected AppError");
};

describe("parseOrderRequestBody (server gate)", () => {
  it("accepts a valid order request", () => {
    const r = parseOrderRequestBody(body());
    expect(r.items).toEqual([{ productId: PID, quantity: 2 }]);
    expect(r.customer.phone).toBe("+919876543210");
    expect(r.pincode).toBe("400001");
    expect(r.shippingAddress).toBe("24, MG Road, Indiranagar, Bengaluru 560038");
    expect(r.idempotencyKey).toBe(KEY);
  });

  it("rejects an empty cart", () => {
    expect(codeOf(() => parseOrderRequestBody(body({ items: [] })))).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("rejects malformed product ids and bad quantities", () => {
    expect(
      codeOf(() =>
        parseOrderRequestBody(body({ items: [{ productId: "abc", quantity: 1 }] })),
      ),
    ).toBe("VALIDATION_ERROR");
    for (const quantity of [0, -1, 1.5, 1000, "2"]) {
      expect(
        codeOf(() =>
          parseOrderRequestBody(body({ items: [{ productId: PID, quantity }] })),
        ),
      ).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects bad GSTIN, pincode, customer and idempotency key", () => {
    expect(
      codeOf(() =>
        parseOrderRequestBody(
          body({ customer: { name: "D", phone: "+919876543210", gstin: "BAD" } }),
        ),
      ),
    ).toBe("VALIDATION_ERROR");
    expect(codeOf(() => parseOrderRequestBody(body({ pincode: "123" })))).toBe(
      "VALIDATION_ERROR",
    );
    expect(codeOf(() => parseOrderRequestBody(body({ customer: null })))).toBe(
      "VALIDATION_ERROR",
    );
    expect(codeOf(() => parseOrderRequestBody(body({ idempotencyKey: "x" })))).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("rejects a shipping address that is missing, too short or too long", () => {
    for (const shippingAddress of [undefined, "", "12 MG", "x".repeat(501)]) {
      expect(
        codeOf(() => parseOrderRequestBody(body({ shippingAddress }))),
      ).toBe("VALIDATION_ERROR");
    }
    // A multi-line address is normalised, not rejected.
    expect(
      parseOrderRequestBody(body({ shippingAddress: "24,  MG\nRoad,  Pune" }))
        .shippingAddress,
    ).toBe("24, MG Road, Pune");
  });

  it("has nowhere to put fake money: extra fields are dropped", () => {
    const r = parseOrderRequestBody(
      body({
        subtotal: 1,
        total: 1,
        deliveryCharge: 0,
        unitPrice: 1,
        paymentStatus: "verified",
        orderStatus: "delivered",
      }),
    );
    expect(r).not.toHaveProperty("subtotal");
    expect(r).not.toHaveProperty("total");
    expect(r).not.toHaveProperty("deliveryCharge");
    expect(r).not.toHaveProperty("paymentStatus");
    expect(r).not.toHaveProperty("orderStatus");
    expect(Object.keys(r).sort()).toEqual(
      [
        "billing",
        "customer",
        "idempotencyKey",
        "items",
        "pincode",
        "shippingAddress",
      ].sort(),
    );
  });
});

describe("normalizePhone (customer identity)", () => {
  it("canonicalises variants to one identity", () => {
    expect(normalizePhone("+919876543210")).toBe("+919876543210");
    expect(normalizePhone("09876543210")).toBe("+919876543210");
    expect(normalizePhone("9876543210")).toBe("+919876543210");
    expect(normalizePhone("+91 98765 43210")).toBe("+919876543210");
  });
});
