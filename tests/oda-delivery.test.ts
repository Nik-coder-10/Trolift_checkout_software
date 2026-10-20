import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockClient,
  type MockResponder,
} from "@/tests/helpers/supabase-mock";
import { resetRateLimits } from "@/lib/rate-limit/index";
import { lookupDelhiveryPincode } from "@/lib/delivery/delhivery-pincodes";
import {
  getOdaChargePaise,
  splitOdaCharge,
  isOdaOrder,
} from "@/lib/delivery/oda";
import {
  deliveryStatusLine,
  buildCustomerOrderMessage,
  type OrderMessageInput,
} from "@/lib/notifications/order-message";

beforeEach(() => resetRateLimits());

vi.mock("server-only", () => ({}));

let serverHandler: MockResponder = () => {
  throw new Error("unexpected server query");
};
let adminHandler: MockResponder = () => {
  throw new Error("unexpected admin query");
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createMockClient(serverHandler),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createMockClient(adminHandler),
}));

import { POST as postOrder } from "@/app/api/orders/route";
import { POST as postCheck } from "@/app/api/delivery/check/route";
import { parseOrderRequestBody } from "@/lib/orders/request";
import { quoteOrder } from "@/lib/orders/quote";

// 673305 is listed with oda=true on the shipped Delhivery list
// (Kerala). 400001 is a regular serviceable pincode. 744101 is
// unlisted. All three verdicts come from the real generated list, so
// these tests pin the ODA scope to "listed + oda=true" only.
const ODA_PIN = "673305";
const OK_PIN = "400001";
const UNLISTED_PIN = "744101";

const P1 = "b1c2d3e4-0004-4000-8000-000000000004";
const PARTNER = "a1b2c3d4-0001-4000-8000-000000000001";
const KEY = "c0ffee00-0001-4000-8000-000000000001";
const CREATED_ORDER_ID = "123e4567-e89b-12d3-a456-426614174001";

const rateRow = {
  delivery_partner_id: PARTNER,
  serviceable: true,
  delivery_charge: "0",
  eta_min_days: 2,
  eta_max_days: 4,
  min_order_amount: null,
  max_order_amount: null,
  delivery_partners: { name: "Delhivery", is_active: true, priority: 100 },
};

function wireServerForQuote() {
  serverHandler = (op) => {
    if (op.table === "products") {
      return {
        rows: [{ id: P1, name: "Trolley", price: "6299.00", gst_rate: "18", hsn_code: "8302", is_active: true }],
        error: null,
      };
    }
    if (op.rpc === "product_availability") {
      return {
        rows: [{ product_id: P1, available: 50, low_stock_threshold: 5, status: "in_stock" }],
        error: null,
      };
    }
    if (op.table === "delivery_pincode_rates") {
      // Rates only match serviceable pincodes; the ODA/unlisted
      // verdicts come from the coverage list, not the rate table.
      return { rows: [rateRow], error: null };
    }
    if (op.table === "delivery_weight_slabs" || op.table === "delivery_category_rules") {
      return { rows: [], error: null };
    }
    throw new Error(`unexpected server op on ${op.table}`);
  };
}

function wireDbForOrder(charge: string) {
  wireServerForQuote();
  const subtotal = (6299.0 * 2).toFixed(2);
  const total = (Number(subtotal) + Number(charge)).toFixed(2);
  adminHandler = (op) => {
    if (op.rpc === "create_order") {
      return { rows: CREATED_ORDER_ID as unknown as unknown[], error: null };
    }
    if (op.table === "order_access_tokens") {
      if (op.updateValues !== undefined) {
        return { rows: [{ id: "tok-1" }], error: null };
      }
      return { rows: [], error: null };
    }
    if (op.table === "order_events") {
      return { rows: [], error: null };
    }
    if (op.table === "orders") {
      return {
        rows: [
          {
            id: CREATED_ORDER_ID,
            order_number: "TS-261021-0001",
            subtotal,
            delivery_charge: charge,
            total_amount: total,
            payment_status: "pending",
            order_status: "pending_payment",
          },
        ],
        error: null,
      };
    }
    throw new Error(`unexpected admin op on ${op.table ?? op.rpc}`);
  };
}

const post = (body: unknown) =>
  postOrder(
    new Request("http://localhost/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const validBody = (over: Record<string, unknown> = {}) => ({
  items: [{ productId: P1, quantity: 2 }],
  customer: { name: "Demo Traders", phone: "+919876543210" },
  pincode: ODA_PIN,
  shippingAddress: "24, MG Road, Idukki, Kerala 673305",
  idempotencyKey: KEY,
  ...over,
});

describe("ODA charge config", () => {
  it("defaults to ₹800 (80000 paise) and honours the env override", () => {
    const prev = process.env.TROLIFT_ODA_CHARGE_PAISE;
    try {
      delete process.env.TROLIFT_ODA_CHARGE_PAISE;
      expect(getOdaChargePaise()).toBe(80000);
      process.env.TROLIFT_ODA_CHARGE_PAISE = "125000";
      expect(getOdaChargePaise()).toBe(125000);
      process.env.TROLIFT_ODA_CHARGE_PAISE = "not-a-number";
      expect(getOdaChargePaise()).toBe(80000);
      process.env.TROLIFT_ODA_CHARGE_PAISE = "-5";
      expect(getOdaChargePaise()).toBe(80000);
    } finally {
      if (prev === undefined) delete process.env.TROLIFT_ODA_CHARGE_PAISE;
      else process.env.TROLIFT_ODA_CHARGE_PAISE = prev;
    }
  });

  it("extracts GST-inclusive freight so freight + tax = the flat charge", () => {
    const split = splitOdaCharge({ chargePaise: 80000, gstRate: "18.00" });
    expect(split.freightPaise + split.taxPaise).toBe(80000);
    expect(split.freightPaise).toBe(67797);
    expect(split.taxPaise).toBe(12203);
  });

  it("passes the charge through untouched on non-GST quotes", () => {
    expect(splitOdaCharge({ chargePaise: 80000, gstRate: null })).toEqual({
      freightPaise: 80000,
      taxPaise: 0,
    });
  });

  it("marks only positive charges as ODA orders", () => {
    expect(isOdaOrder(0)).toBe(false);
    expect(isOdaOrder(80000)).toBe(true);
  });
});

describe("ODA pincode scope (real Delhivery list)", () => {
  it("flags 673305 as listed + oda, and 400001 / 744101 as not ODA", () => {
    expect(lookupDelhiveryPincode(ODA_PIN)).toMatchObject({
      listed: true,
      oda: true,
      deliverable: false,
    });
    expect(lookupDelhiveryPincode(OK_PIN)).toMatchObject({
      listed: true,
      oda: false,
      deliverable: true,
    });
    expect(lookupDelhiveryPincode(UNLISTED_PIN)).toMatchObject({
      listed: false,
      oda: null,
      deliverable: false,
    });
  });
});

describe("parseOrderRequestBody — odaDoorDelivery", () => {
  const baseBody = {
    items: [{ productId: P1, quantity: 1 }],
    customer: { name: "Rahul Sharma", phone: "+919876543210" },
    pincode: ODA_PIN,
    shippingAddress: "24, MG Road, Idukki, Kerala 673305",
    idempotencyKey: KEY,
  };

  it("defaults the flag to false when absent", () => {
    const parsed = parseOrderRequestBody(baseBody);
    expect(parsed.odaDoorDelivery).toBe(false);
  });

  it("accepts a strict boolean true", () => {
    const parsed = parseOrderRequestBody({ ...baseBody, odaDoorDelivery: true });
    expect(parsed.odaDoorDelivery).toBe(true);
  });

  it("rejects a non-boolean flag", () => {
    expect(() =>
      parseOrderRequestBody({ ...baseBody, odaDoorDelivery: "yes" }),
    ).toThrow(/ODA delivery option is invalid/);
  });
});

describe("quoteOrder — ODA door delivery", () => {
  beforeEach(() => {
    wireServerForQuote();
  });

  it("charges the flat ODA fee when the flag meets a listed ODA pincode", async () => {
    const quote = await quoteOrder({
      items: [{ productId: P1, quantity: 2 }],
      pincode: ODA_PIN,
      odaDoorDelivery: true,
    });
    expect(quote.deliveryChargePaise).toBe(80000);
    expect(quote.deliveryPartnerId).toBeNull();
    expect(quote.deliveryPartnerName).toBe("ODA Door Delivery");
    expect(quote.etaDays).toBeNull();
    expect(quote.deliveryRuleSummary).toContain("ODA");
    // total = subtotal(ex-GST) + goods GST + ODA charge
    expect(quote.totalPaise).toBe(
      quote.subtotalPaise + quote.tax.totalGstPaise + 80000,
    );
  });

  it("still refuses an ODA pincode when the flag is absent", async () => {
    await expect(
      quoteOrder({
        items: [{ productId: P1, quantity: 2 }],
        pincode: ODA_PIN,
      }),
    ).rejects.toThrow(/nearby pincode/i);
  });

  it("ignores the flag on a serviceable pincode (all-inclusive, no charge)", async () => {
    const quote = await quoteOrder({
      items: [{ productId: P1, quantity: 2 }],
      pincode: OK_PIN,
      odaDoorDelivery: true,
    });
    expect(quote.deliveryChargePaise).toBe(0);
    expect(quote.totalPaise).toBe(quote.subtotalPaise + quote.tax.totalGstPaise);
  });

  it("refuses the flag on an unlisted pincode", async () => {
    await expect(
      quoteOrder({
        items: [{ productId: P1, quantity: 2 }],
        pincode: UNLISTED_PIN,
        odaDoorDelivery: true,
      }),
    ).rejects.toThrow(/nearby pincode/i);
  });
});

describe("POST /api/delivery/check — ODA charge in the verdict", () => {
  const check = (pincode: string) =>
    postCheck(
      new Request("http://localhost/api/delivery/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pincode }),
      }),
    );

  beforeEach(() => {
    wireServerForQuote();
  });

  it("returns odaChargePaise on a listed ODA pincode", async () => {
    const res = await check(ODA_PIN);
    const json = (await res.json()) as {
      ok: boolean;
      data: { serviceable: boolean; odaChargePaise: number | null };
    };
    expect(json.ok).toBe(true);
    expect(json.data.serviceable).toBe(false);
    expect(json.data.odaChargePaise).toBe(80000);
  });

  it("returns a null charge on a serviceable pincode", async () => {
    const res = await check(OK_PIN);
    const json = (await res.json()) as {
      ok: boolean;
      data: { serviceable: boolean; odaChargePaise: number | null };
    };
    expect(json.data.serviceable).toBe(true);
    expect(json.data.odaChargePaise).toBeNull();
  });

  it("returns a null charge on an unlisted pincode (hard no)", async () => {
    const res = await check(UNLISTED_PIN);
    const json = (await res.json()) as {
      ok: boolean;
      data: { serviceable: boolean; odaChargePaise: number | null };
    };
    expect(json.data.serviceable).toBe(false);
    expect(json.data.odaChargePaise).toBeNull();
  });
});

describe("POST /api/orders — ODA order end to end", () => {
  it("persists the ODA charge and returns the inflated total", async () => {
    wireDbForOrder("800.00");
    const res = await post(validBody({ odaDoorDelivery: true }));
    const json = (await res.json()) as {
      ok: boolean;
      data: { totalPaise: number; deliveryChargePaise?: number };
    };
    expect(json.ok).toBe(true);
    // 2 × 6299.00 inclusive → subtotal(ex-GST) 10675.42 + GST 1922.58
    // + ODA 800.00 = 13398.00 inclusive total.
    expect(json.data.totalPaise).toBe(1339800);
  });

  it("rejects an ODA pincode without the opt-in", async () => {
    wireDbForOrder("0");
    const res = await post(validBody());
    const json = (await res.json()) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("customer message — ODA lines", () => {
  const base: OrderMessageInput = {
    orderNumber: "TS-000123",
    customerName: "Rahul Sharma",
    customerPhone: "+919876543210",
    customerEmail: "rahul@example.com",
    businessName: null,
    billingAddress: null,
    gstin: null,
    lines: [{ productName: "Trolley", quantity: 1, lineTotalPaise: 629900 }],
    taxPaise: 96086,
    taxType: "cgst_sgst",
    deliveryPartnerName: "ODA Door Delivery",
    deliveryChargePaise: 80000,
    etaDays: null,
    totalPaise: 709900,
    discountPaise: 0,
    couponCode: null,
    pincode: ODA_PIN,
    shippingAddress: "Somewhere, Idukki, Kerala",
    paymentWindowHours: 24,
    siteUrl: "https://trolift.example",
    hasPaymentQr: true,
    quotationNumber: null,
  };

  it("reports ODA door delivery instead of 'not deliverable'", () => {
    const line = deliveryStatusLine(base);
    expect(line).toContain("ODA door delivery arranged");
    expect(line).toContain("800.00");
    expect(line).not.toContain("not deliverable");
  });

  it("names the ODA charge in the money summary", () => {
    const text = buildCustomerOrderMessage(base);
    expect(text).toContain("ODA delivery charge: ₹800.00");
    expect(text).not.toContain("Delivery: Included");
  });

  it("keeps the 'included' lines on normal orders", () => {
    const normal = {
      ...base,
      pincode: OK_PIN,
      deliveryChargePaise: 0,
      deliveryPartnerName: "Delhivery",
    };
    expect(deliveryStatusLine(normal)).toContain("serviceable");
    expect(buildCustomerOrderMessage(normal)).toContain("Delivery: Included");
  });
});
