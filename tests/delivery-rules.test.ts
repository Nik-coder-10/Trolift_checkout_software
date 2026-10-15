import { beforeEach, describe, expect, it, vi } from "vitest";

// server-only modules throw outside the Next server runtime by design.
vi.mock("server-only", () => ({}));
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

let adminHandler: MockResponder = () => {
  throw new Error("unexpected admin query");
};
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createMockClient(adminHandler),
}));

import {
  formatKg,
  kgToGrams,
  quoteDelivery,
} from "@/lib/delivery/engine";
import {
  validateCategoryRuleInput,
  validateSlabInput,
} from "@/lib/admin/delivery-validation";
import { POST as checkPost } from "@/app/api/delivery/check/route";
import { POST as slabsPost } from "@/app/api/admin/delivery/slabs/route";
import { POST as categoryPost } from "@/app/api/admin/delivery/category-rules/route";

const P1 = "b1c2d3e4-0004-4000-8000-000000000004";
const PARTNER_A = "a1b2c3d4-0001-4000-8000-000000000001";
const PARTNER_B = "a1b2c3d4-0002-4000-8000-000000000002";

const rate = (over: Record<string, unknown> = {}) => ({
  delivery_partner_id: PARTNER_A,
  serviceable: true,
  delivery_charge: "450.00",
  remote_surcharge: "0.00",
  eta_min_days: 2,
  eta_max_days: 4,
  min_order_amount: null,
  max_order_amount: null,
  delivery_partners: { name: "Delhivery", is_active: true, priority: 100 },
  ...over,
});

const product = (over: Record<string, unknown> = {}) => ({
  id: P1,
  weight_kg: "32.000",
  category: "Trolleys",
  price: "6299.00",
  ...over,
});

/** Wire the four engine reads; slabs/rules/products default to empty. */
function wireEngine(opts: {
  rates: unknown[];
  slabs?: unknown[];
  rules?: unknown[];
  products?: unknown[];
}) {
  handler = (op) => {
    if (op.table === "delivery_pincode_rates") return { rows: opts.rates, error: null };
    if (op.table === "delivery_weight_slabs") {
      return { rows: opts.slabs ?? [], error: null };
    }
    if (op.table === "delivery_category_rules") {
      return { rows: opts.rules ?? [], error: null };
    }
    if (op.table === "products") return { rows: opts.products ?? [], error: null };
    throw new Error(`unexpected table ${op.table}`);
  };
}

beforeEach(() => {
  resetRateLimits();
  authUser = { id: "admin-1" };
  adminFlag = true;
  handler = () => {
    throw new Error("unexpected query");
  };
});

describe("weight primitives (exact integer grams)", () => {
  it("converts NUMERIC(10,3) kg without float drift", () => {
    expect(kgToGrams("32.000")).toBe(32000);
    expect(kgToGrams("18.250")).toBe(18250);
    expect(kgToGrams(null)).toBeNull();
    expect(kgToGrams("0")).toBeNull();
    expect(kgToGrams("-3")).toBeNull();
    expect(kgToGrams("nope")).toBeNull();
  });

  it("formats display weights compactly", () => {
    expect(formatKg(32000)).toContain("32");
    expect(formatKg(18250)).toContain("18.25");
  });
});

describe("slab + category validation (no ambiguous rules)", () => {
  const existing = [
    { minKg: 0, maxKg: 10 },
    { minKg: 10, maxKg: 25 },
  ];

  it("accepts a clean adjacent band and an open top band", () => {
    const base = { partnerId: PARTNER_A, chargeRupees: "950.00" };
    expect(
      validateSlabInput({ ...base, minKg: "25", maxKg: "50" }, existing).value,
    ).toMatchObject({ minKg: "25.000", maxKg: "50.000", chargePaise: 95000 });
    expect(
      validateSlabInput({ ...base, minKg: "25", maxKg: "" }, []).value?.maxKg,
    ).toBeNull();
  });

  it("rejects overlapping bands (including open-ended)", () => {
    const base = { partnerId: PARTNER_A, chargeRupees: "100.00" };
    expect(
      validateSlabInput({ ...base, minKg: "5", maxKg: "15" }, existing).errors.minKg,
    ).toBeTruthy();
    expect(
      validateSlabInput({ ...base, minKg: "20", maxKg: "" }, existing).errors.minKg,
    ).toBeTruthy();
  });

  it("rejects bad bands, partners and charges", () => {
    const base = { partnerId: PARTNER_A, chargeRupees: "100.00" };
    expect(
      validateSlabInput({ ...base, minKg: "25", maxKg: "25" }, []).errors.maxKg,
    ).toBeTruthy();
    expect(
      validateSlabInput({ ...base, minKg: "abc", maxKg: "" }, []).errors.minKg,
    ).toBeTruthy();
    expect(
      validateSlabInput({ ...base, partnerId: "nope", minKg: "0", maxKg: "" }, [])
        .errors.partnerId,
    ).toBeTruthy();
  });

  it("validates category rules (one per category by UNIQUE)", () => {
    expect(
      validateCategoryRuleInput({ category: "Trolleys", surchargeRupees: "250.00", note: "" })
        .value,
    ).toMatchObject({ category: "Trolleys", surchargePaise: 25000, note: null });
    expect(
      validateCategoryRuleInput({ category: "X", surchargeRupees: "1.00", note: "" })
        .errors.category,
    ).toBeTruthy();
    expect(
      validateCategoryRuleInput({ category: "Trolleys", surchargeRupees: "1.999", note: "" })
        .errors.surchargeRupees,
    ).toBeTruthy();
  });
});

describe("rule engine (precedence + selection)", () => {
  it("prices plain pincode rates when no rules match", async () => {
    wireEngine({ rates: [rate()], products: [product()] });
    const q = await quoteDelivery("400001", 1259800, [
      { productId: P1, quantity: 2 },
    ]);
    expect(q.serviceable).toBe(true);
    expect(q.selected?.deliveryChargePaise).toBe(45000);
    expect(q.appliedRules).toEqual([]);
    expect(q.totalWeightKg).toBe(64);
    expect(q.freightPaise).toBe(45000);
    expect(q.remotePaise).toBe(0);
    expect(q.handlingPaise).toBe(0);
  });

  it("replaces the base charge with a matching weight slab", async () => {
    wireEngine({
      rates: [rate()],
      slabs: [
        { delivery_partner_id: PARTNER_A, min_weight_kg: "0.000", max_weight_kg: "10.000", charge: "280.00" },
        { delivery_partner_id: PARTNER_A, min_weight_kg: "10.000", max_weight_kg: "25.000", charge: "520.00" },
      ],
      products: [product({ weight_kg: "12.500" })],
    });
    const q = await quoteDelivery("400001", undefined, [
      { productId: P1, quantity: 1 },
    ]);
    expect(q.selected?.deliveryChargePaise).toBe(52000);
    expect(q.appliedRules).toEqual(["Weight 10–25 kg"]);
    expect(q.freightPaise).toBe(52000);
  });

  it("skips slabs when any weight is unknown (never guesses)", async () => {
    wireEngine({
      rates: [rate()],
      slabs: [
        { delivery_partner_id: PARTNER_A, min_weight_kg: "0.000", max_weight_kg: null, charge: "999.00" },
      ],
      products: [product({ weight_kg: null })],
    });
    const q = await quoteDelivery("400001", undefined, [
      { productId: P1, quantity: 1 },
    ]);
    expect(q.selected?.deliveryChargePaise).toBe(45000);
    expect(q.appliedRules).toEqual([]);
    // Unknown weight is reported as unknown (null) — 0 would be a
    // fabricated measurement and could silently select a slab.
    expect(q.totalWeightKg).toBeNull();
  });

  it("prefers priority, then the lowest partner total", async () => {
    wireEngine({
      rates: [
        rate(),
        rate({
          delivery_partner_id: PARTNER_B,
          delivery_charge: "300.00",
          delivery_partners: { name: "BlueDart", is_active: true, priority: 200 },
        }),
      ],
      products: [product()],
    });
    const q = await quoteDelivery("400001");
    // Priority 100 beats the cheaper priority-200 partner.
    expect(q.selected?.partner.name).toBe("Delhivery");
    expect(q.options.map((o) => o.partner.name)).toEqual(["Delhivery", "BlueDart"]);
  });

  it("adds the remote surcharge as an explicit rule", async () => {
    wireEngine({
      rates: [rate({ remote_surcharge: "120.00" })],
      products: [product()],
    });
    const q = await quoteDelivery("400001", undefined, [
      { productId: P1, quantity: 1 },
    ]);
    expect(q.selected?.deliveryChargePaise).toBe(57000);
    expect(q.remotePaise).toBe(12000);
    expect(q.appliedRules).toEqual(["Remote-area surcharge"]);
  });

  it("adds category handling on top of the winning partner", async () => {
    wireEngine({
      rates: [rate()],
      rules: [{ category: "Trolleys", surcharge: "250.00" }],
      products: [product()],
    });
    const q = await quoteDelivery("400001", undefined, [
      { productId: P1, quantity: 1 },
    ]);
    expect(q.selected?.deliveryChargePaise).toBe(70000);
    expect(q.handlingPaise).toBe(25000);
    expect(q.appliedRules).toEqual(["Trolleys handling"]);
  });

  it("combines slab + remote + handling in precedence order", async () => {
    wireEngine({
      rates: [rate({ remote_surcharge: "120.00" })],
      slabs: [
        { delivery_partner_id: PARTNER_A, min_weight_kg: "0.000", max_weight_kg: "100.000", charge: "520.00" },
      ],
      rules: [{ category: "Trolleys", surcharge: "250.00" }],
      products: [product({ weight_kg: "12.500" })],
    });
    const q = await quoteDelivery("400001", undefined, [
      { productId: P1, quantity: 1 },
    ]);
    expect(q.selected?.deliveryChargePaise).toBe(52000 + 12000 + 25000);
    expect(q.appliedRules).toEqual([
      "Weight 0–100 kg",
      "Remote-area surcharge",
      "Trolleys handling",
    ]);
  });

  it("names the minimum order when windows block every option", async () => {
    wireEngine({
      rates: [rate({ min_order_amount: "25000.00" })],
      products: [product()],
    });
    const q = await quoteDelivery("400001", 100000, [
      { productId: P1, quantity: 1 },
    ]);
    expect(q.serviceable).toBe(false);
    expect(q.reason).toContain("25,000");
  });

  it("blocks out-of-area pincodes without touching the database", async () => {
    // `handler` still throws "unexpected query": the Delhivery list
    // veto must resolve before any Supabase read.
    const q = await quoteDelivery("680522");
    expect(q.serviceable).toBe(false);
    expect(q.selected).toBeNull();
    expect(q.coverage).toMatchObject({
      listed: true,
      oda: true,
      deliverable: false,
    });
    expect(q.reason).toContain("outside our delivery area");
    expect(JSON.stringify(q)).not.toContain("delivery_weight_slabs");
  });

  it("cannot be overridden by a configured rate for an out-of-area pincode", async () => {
    wireEngine({ rates: [rate()], products: [product()] });
    const q = await quoteDelivery("680522", undefined, [
      { productId: P1, quantity: 1 },
    ]);
    expect(q.serviceable).toBe(false);
    expect(q.selected).toBeNull();
  });

  it("reports a covered pincode with no configured rate as deliverable but unpriced", async () => {
    wireEngine({ rates: [] });
    const q = await quoteDelivery("799001");
    expect(q.serviceable).toBe(true);
    expect(q.selected).toBeNull();
    expect(q.coverage.deliverable).toBe(true);
    expect(q.reason).toContain("charge");
    expect(JSON.stringify(q)).not.toContain("delivery_weight_slabs");
  });
});

describe("check API (forged figures are structurally ignored)", () => {
  const postCheck = (body: unknown) =>
    checkPost(
      new Request("http://localhost/api/delivery/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  beforeEach(() => {
    wireEngine({ rates: [rate()], products: [product()] });
  });

  it("derives weight and value from live rows, not the body", async () => {
    const res = await postCheck({
      pincode: "400001",
      subtotalPaise: 1,
      items: [
        {
          productId: P1,
          quantity: 2,
          weightKg: "0.001",
          price: "1.00",
          deliveryChargePaise: 1,
          available: 999,
        },
      ],
    });
    const json = (await res.json()) as {
      ok: boolean;
      data: Record<string, unknown>;
    };
    expect(json.ok).toBe(true);
    // Live: 2 × 32 kg and 2 × ₹6299 — forged 0.001 kg / ₹1 ignored.
    expect(json.data.totalWeightKg).toBe(64);
    expect(json.data.subtotalPaise).toBe(1259800);
    expect(json.data.deliveryChargePaise).toBe(45000);
    expect(json.data.coverage).toMatchObject({
      pincode: "400001",
      listed: true,
      oda: false,
      state: "Maharashtra",
      deliverable: true,
    });
  });

  it("answers out-of-area coverage from the list without a database", async () => {
    handler = () => {
      throw new Error("unexpected query");
    };
    const res = await postCheck({ pincode: "680522" });
    const json = (await res.json()) as {
      ok: boolean;
      data: Record<string, unknown>;
    };
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.serviceable).toBe(false);
    expect(json.data.selected).toBeNull();
    expect(json.data.coverage).toMatchObject({
      listed: true,
      oda: true,
      deliverable: false,
    });
  });

  it("rejects malformed items without touching the engine", async () => {
    const res = await postCheck({
      pincode: "400001",
      items: [{ productId: "nope", quantity: 1 }],
    });
    expect(res.status).toBe(400);
    const res2 = await postCheck({
      pincode: "400001",
      items: [{ productId: P1, quantity: 0 }],
    });
    expect(res2.status).toBe(400);
  });
});

describe("snapshots + live configuration", () => {
  it("freezes weight and rule summary into the order payload", async () => {
    const { persistOrder } = await import("@/lib/orders/create");
    let captured: unknown = null;
    adminHandler = (op) => {
      if (op.rpc === "create_order") {
        captured = op.rpcArgs;
        return { rows: ["order-1"], error: null };
      }
      if (op.table === "orders") {
        return {
          rows: [
            {
              id: "order-1",
              order_number: "TS-1",
              subtotal: "12598.00",
              delivery_charge: "770.00",
              total_amount: "13368.00",
              payment_status: "pending",
              order_status: "pending_payment",
            },
          ],
          error: null,
        };
      }
      throw new Error(`unexpected ${op.table ?? op.rpc}`);
    };
    await persistOrder({
      idempotencyKey: "c0ffee00-0001-4000-8000-000000000001",
      customer: { name: "D", phone: "+919876543210", email: null, gstin: null },
      quote: {
        lines: [],
        subtotalPaise: 1259800,
        tax: {
          treatment: "non_gst",
          type: "none",
          taxablePaise: 0,
          cgstPaise: 0,
          sgstPaise: 0,
          igstPaise: 0,
          totalGstPaise: 0,
        },
        billing: {
          gstin: null,
          stateCode: null,
          name: null,
          addressLine: null,
          city: null,
          state: null,
          pincode: null,
        },
        deliveryPartnerId: PARTNER_A,
        deliveryPartnerName: "Delhivery",
        deliveryChargePaise: 77000,
        deliveryWeightKg: 64,
        deliveryRuleSummary: "Weight 25–50 kg + Remote-area surcharge",
        totalPaise: 1336800,
        pincode: "400001",
      },
    });
    const payload = captured as {
      p_order: Record<string, unknown>;
    };
    expect(payload.p_order.delivery_weight_kg).toBe("64.000");
    expect(payload.p_order.delivery_rule_summary).toBe(
      "Weight 25–50 kg + Remote-area surcharge",
    );
  });

  it("reads configuration on every quote (no stale cache)", async () => {
    wireEngine({ rates: [rate()], products: [product()] });
    const plain = await quoteDelivery("400001", undefined, [
      { productId: P1, quantity: 1 },
    ]);
    wireEngine({
      rates: [rate({ remote_surcharge: "120.00" })],
      products: [product()],
    });
    const remote = await quoteDelivery("400001", undefined, [
      { productId: P1, quantity: 1 },
    ]);
    expect(plain.selected?.deliveryChargePaise).toBe(45000);
    expect(remote.selected?.deliveryChargePaise).toBe(57000);
  });
});

describe("admin-only rule modification", () => {
  const post = (
    fn: (req: Request) => Promise<Response>,
    body: unknown,
  ) =>
    fn(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  const slabBody = {
    partnerId: PARTNER_A,
    minKg: "0",
    maxKg: "10",
    chargeRupees: "280.00",
  };

  it("rejects anonymous and non-admin writers", async () => {
    authUser = null;
    expect((await post(slabsPost, slabBody)).status).toBe(401);
    expect(
      (await post(categoryPost, { category: "Trolleys", surchargeRupees: "1.00", note: "" }))
        .status,
    ).toBe(401);
    authUser = { id: "u1" };
    adminFlag = false;
    expect((await post(slabsPost, slabBody)).status).toBe(403);
    expect(
      (await post(categoryPost, { category: "Trolleys", surchargeRupees: "1.00", note: "" }))
        .status,
    ).toBe(403);
  });

  it("creates slabs and rules through validated writers", async () => {
    handler = (op) => {
      if (op.table === "delivery_partners") {
        return { rows: [{ id: PARTNER_A }], error: null };
      }
      if (op.table === "delivery_weight_slabs" && !op.updateValues) {
        return { rows: [], error: null };
      }
      if (op.table === "delivery_weight_slabs" && op.updateValues) {
        return { rows: [{ id: "s1" }], error: null };
      }
      if (op.table === "delivery_category_rules") {
        return { rows: [{ id: "c1" }], error: null };
      }
      throw new Error(`unexpected ${op.table}`);
    };
    // NOTE: vi.mock next/cache stubs revalidatePath (see top of file).
    const slabRes = await post(slabsPost, slabBody);
    expect(slabRes.status).toBe(201);
    const catRes = await post(categoryPost, {
      category: "Trolleys",
      surchargeRupees: "250.00",
      note: "",
    });
    expect(catRes.status).toBe(201);
  });
});
