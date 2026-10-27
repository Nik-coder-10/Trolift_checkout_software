import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// server-only modules throw outside the Next server runtime by design.
vi.mock("server-only", () => ({}));

import {
  createMockClient,
  type MockOp,
  type MockResponder,
} from "@/tests/helpers/supabase-mock";
import { resetRateLimits } from "@/lib/rate-limit/index";

const inserts: Array<Record<string, unknown>> = [];
let failInsert = false;
let catalogueRows: Array<Record<string, unknown>> = [];
let catalogueError = false;

const handler: MockResponder = (op: MockOp) => {
  if (op.rpc === "generate_quotation_number") {
    return { rows: ["QTN-TS0000123456"], error: null };
  }
  if (op.table === "products") {
    return {
      rows: catalogueError ? [] : catalogueRows,
      error: catalogueError ? { message: "boom", code: "500" } : null,
    };
  }
  if (op.table === "manual_quotations") {
    if (op.updateValues !== undefined && !op.isDelete) {
      inserts.push(op.updateValues as Record<string, unknown>);
      if (failInsert) {
        return { rows: [], error: { message: "insert failed", code: "500" } };
      }
      return { rows: [{ id: "quote-1" }], error: null };
    }
    return { rows: [], error: null };
  }
  throw new Error(`unexpected query ${op.table ?? op.rpc}`);
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createMockClient(handler),
}));

let authUser: { id: string } | null = { id: "admin-1" };
let adminFlag = true;
vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    createMockClient(
      (op) => {
        if (op.table === "profiles") {
          return { rows: adminFlag ? [{ is_admin: true }] : [], error: null };
        }
        throw new Error(`unexpected server table ${op.table}`);
      },
      { authUser },
    ),
}));

import {
  buildManualQuotation,
  computeManualQuotationTotals,
  manualLineFromProduct,
  parseManualQuotationInput,
  type ManualQuotationItem,
} from "@/lib/quotations/manual";
import { listQuotableProducts } from "@/lib/quotations/manual-service";
import { POST } from "@/app/api/admin/quotations/route";

const business = {
  name: "Trolift Solutions",
  address: "Jaipur, Rajasthan",
  phone: null,
  email: null,
  gstin: "08ABCDE1234F1Z0",
};

function payload(overrides: Record<string, unknown> = {}) {
  return {
    partyType: "dealer",
    name: "Sharma Traders",
    businessName: "Sharma Traders",
    phone: "9876543210",
    email: "dealer@example.com",
    gstin: "",
    addressLine: "12 Transport Nagar",
    city: "Jaipur",
    state: "Rajasthan",
    pincode: "302001",
    items: [
      {
        name: "Hydraulic Hand Pallet Truck 2500 kg",
        description: "",
        hsn: "87168010",
        quantity: "2",
        unitPrice: "24999.00",
        gstRate: "18",
      },
    ],
    deliveryCharge: "800",
    withGst: true,
    validityDays: "7",
    ...overrides,
  };
}

const originalEnv = { ...process.env };

beforeEach(() => {
  inserts.length = 0;
  failInsert = false;
  catalogueError = false;
  catalogueRows = [
    {
      id: "prod-1",
      name: "Hydraulic Hand Pallet Truck 2500 kg",
      description: "Capacity 2500 kg",
      hsn_code: "87168010",
      gst_rate: "18.00",
      price: "24999.00",
    },
  ];
  authUser = { id: "admin-1" };
  adminFlag = true;
  resetRateLimits();
  process.env.TROLIFT_BUSINESS_NAME = "Trolift Solutions";
  process.env.TROLIFT_BUSINESS_ADDRESS = "Jaipur, Rajasthan";
  process.env.TROLIFT_STATE_CODE = "08";
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("parseManualQuotationInput", () => {
  it("normalises the party and converts every amount to integer paise", () => {
    const parsed = parseManualQuotationInput(payload());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.phone).toBe("+919876543210");
    expect(parsed.value.deliveryChargePaise).toBe(80_000);
    expect(parsed.value.items[0]?.unitPricePaise).toBe(2_499_900);
    expect(parsed.value.items[0]?.quantity).toBe(2);
    expect(parsed.value.items[0]?.gstRate).toBe("18");
    expect(parsed.value.state).toBe("Rajasthan");
  });

  it("reports per-field errors instead of guessing", () => {
    const parsed = parseManualQuotationInput(
      payload({
        name: "",
        phone: "12345",
        state: "",
        items: [{ name: "", quantity: "0", unitPrice: "abc", gstRate: "40" }],
        deliveryCharge: "-5",
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(Object.keys(parsed.errors).sort()).toEqual(
      [
        "deliveryCharge",
        "items.0.gstRate",
        "items.0.name",
        "items.0.quantity",
        "items.0.unitPrice",
        "name",
        "phone",
        "state",
      ].sort(),
    );
  });

  it("rejects a GSTIN with a bad checksum but accepts a valid one", () => {
    const bad = parseManualQuotationInput(payload({ gstin: "08ABCDE1234F1Z9" }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.gstin).toBeTruthy();

    const good = parseManualQuotationInput(payload({ gstin: "08ABCDE1234F1Z0" }));
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.value.gstin).toBe("08ABCDE1234F1Z0");
  });

  it("drops the GSTIN on a non-GST quotation", () => {
    const parsed = parseManualQuotationInput(
      payload({ withGst: false, gstin: "08ABCDE1234F1Z0" }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.withGst).toBe(false);
    expect(parsed.value.gstin).toBeNull();
    expect(parsed.value.items[0]?.gstRate).toBeNull();
  });

  it("requires at least one item", () => {
    const parsed = parseManualQuotationInput(payload({ items: [] }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.items).toBeTruthy();
  });

  it("defaults shipping address to billing address when sameAsBilling is true", () => {
    const parsed = parseManualQuotationInput(
      payload({
        sameAsBilling: true,
        addressLine: "12 Transport Nagar",
        city: "Jaipur",
        state: "Rajasthan",
        pincode: "302001",
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.sameAsBilling).toBe(true);
    expect(parsed.value.shippingAddressLine).toBe("12 Transport Nagar");
    expect(parsed.value.shippingCity).toBe("Jaipur");
    expect(parsed.value.shippingState).toBe("Rajasthan");
    expect(parsed.value.shippingPincode).toBe("302001");
  });

  it("supports distinct shipping address when sameAsBilling is false", () => {
    const parsed = parseManualQuotationInput(
      payload({
        sameAsBilling: false,
        addressLine: "12 Transport Nagar",
        city: "Jaipur",
        state: "Rajasthan",
        pincode: "302001",
        shippingAddressLine: "Plot 45, MIDC Industrial Area",
        shippingCity: "Pune",
        shippingState: "Maharashtra",
        shippingPincode: "411018",
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.sameAsBilling).toBe(false);
    expect(parsed.value.addressLine).toBe("12 Transport Nagar");
    expect(parsed.value.shippingAddressLine).toBe("Plot 45, MIDC Industrial Area");
    expect(parsed.value.shippingCity).toBe("Pune");
    expect(parsed.value.shippingState).toBe("Maharashtra");
    expect(parsed.value.shippingPincode).toBe("411018");
  });

  it("validates shipping pincode and state when sameAsBilling is false", () => {
    const parsed = parseManualQuotationInput(
      payload({
        sameAsBilling: false,
        shippingPincode: "012345",
        shippingState: "InvalidStateName",
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.shippingPincode).toBeTruthy();
    expect(parsed.errors.shippingState).toBeTruthy();
  });
});

describe("manualLineFromProduct", () => {
  it("turns a GST-inclusive catalogue price into an ex-GST rate", () => {
    const line = manualLineFromProduct({
      name: "Hydraulic Hand Pallet Truck 2500 kg",
      description: "Capacity 2500 kg",
      hsn: "87168010",
      gstRate: "18",
      pricePaise: 2_499_900,
    });
    // 24,999.00 inclusive @18% → 21,185.59 ex-GST (tax adds back to 24,999.00).
    expect(line.unitPrice).toBe("21185.59");
    expect(line.gstRate).toBe("18");
    expect(line.quantity).toBe("1");
    expect(line.hsn).toBe("87168010");
    expect(line.name).toBe("Hydraulic Hand Pallet Truck 2500 kg");
    expect(line.description).toBe("Capacity 2500 kg");
  });

  it("leaves a zero-rated item's price untouched", () => {
    const line = manualLineFromProduct({
      name: "Service kit",
      gstRate: null,
      pricePaise: 500_000,
    });
    expect(line.unitPrice).toBe("5000.00");
    expect(line.gstRate).toBe("0");
    expect(line.hsn).toBe("");
  });

  it("round-trips: the prefilled line totals the catalogue price once tax is added", () => {
    const line = manualLineFromProduct({
      name: "Pallet truck",
      gstRate: "18",
      pricePaise: 2_499_900,
    });
    const parsed = parseManualQuotationInput(
      payload({
        items: [{ ...line, quantity: "1" }],
        deliveryCharge: "0",
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const totals = computeManualQuotationTotals({
      items: parsed.value.items,
      deliveryChargePaise: 0,
      deliveryGstRate: "18.00",
      sameState: true,
    });
    // 21,185.59 + 18% (3,813.41) = 24,999.00 exactly.
    expect(totals.grandTotalPaise).toBe(2_499_900);
  });
});

describe("listQuotableProducts", () => {
  it("maps active catalogue rows into picker entries in paise", async () => {
    const products = await listQuotableProducts();
    expect(products).toEqual([
      {
        id: "prod-1",
        name: "Hydraulic Hand Pallet Truck 2500 kg",
        description: "Capacity 2500 kg",
        hsn: "87168010",
        gstRate: "18.00",
        pricePaise: 2_499_900,
      },
    ]);
  });

  it("fails open with an empty list when the catalogue read fails", async () => {
    catalogueError = true;
    await expect(listQuotableProducts()).resolves.toEqual([]);
  });
});

describe("computeManualQuotationTotals", () => {
  const items: ManualQuotationItem[] = [
    {
      name: "Pallet truck",
      description: "",
      hsn: null,
      quantity: 2,
      unitPricePaise: 2_499_900,
      gstRate: "18",
    },
    {
      name: "Platform trolley",
      description: "",
      hsn: null,
      quantity: 1,
      unitPricePaise: 629_900,
      gstRate: "5",
    },
  ];

  it("adds per-line GST and delivery GST, then splits intra-state", () => {
    const totals = computeManualQuotationTotals({
      items,
      deliveryChargePaise: 80_000,
      deliveryGstRate: "18.00",
      sameState: true,
    });
    // 2 × 24,999 = 49,998 @18% = 8,999.64 → 8,999.64 + 6,299 @5% = 314.95
    expect(totals.lineTaxesPaise).toEqual([899_964, 31_495]);
    expect(totals.lineTaxPaise).toBe(931_459);
    // 80,000 base @18% = 14,400
    expect(totals.deliveryTaxPaise).toBe(14_400);
    expect(totals.totalTaxPaise).toBe(945_859);
    expect(totals.subtotalPaise).toBe(5_709_700);
    expect(totals.cgstPaise + totals.sgstPaise).toBe(totals.totalTaxPaise);
    expect(totals.igstPaise).toBe(0);
    expect(totals.grandTotalPaise).toBe(
      totals.subtotalPaise + totals.totalTaxPaise,
    );
  });

  it("puts the whole tax in IGST for an inter-state party", () => {
    const totals = computeManualQuotationTotals({
      items,
      deliveryChargePaise: 80_000,
      deliveryGstRate: "18.00",
      sameState: false,
    });
    expect(totals.igstPaise).toBe(totals.totalTaxPaise);
    expect(totals.cgstPaise).toBe(0);
    expect(totals.sgstPaise).toBe(0);
  });

  it("charges no tax at all without GST", () => {
    const totals = computeManualQuotationTotals({
      items: items.map((i) => ({ ...i, gstRate: null })),
      deliveryChargePaise: 80_000,
      deliveryGstRate: null,
      sameState: true,
    });
    expect(totals.totalTaxPaise).toBe(0);
    expect(totals.grandTotalPaise).toBe(5_709_700);
  });
});

describe("buildManualQuotation", () => {
  const ctx = {
    quotationNumber: "QTN-TS0000123456",
    quotationDate: "2026-10-26",
    validTill: "2026-11-02",
    business,
    bank: null,
    signatory: null,
    terms: ["Payment: 100% advance"],
    about: "Trolift Solutions makes trolleys.",
    deliveryGstRate: "18.00",
    deliverySac: "996812",
    deliveryLine: { name: "Cartage - delivery charge", description: "By road" },
    businessStateCode: "08",
  };

  it("freezes the same document shape as an order quotation", () => {
    const parsed = parseManualQuotationInput(payload({ gstin: "08ABCDE1234F1Z0" }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const doc = buildManualQuotation(parsed.value, ctx);

    expect(doc.version).toBe(1);
    expect(doc.kind).toBe("quotation");
    expect(doc.source).toBe("manual");
    expect(doc.quotationNumber).toBe("QTN-TS0000123456");
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0]?.taxPaise).toBe(899_964);
    expect(doc.items[0]?.lineTotalPaise).toBe(4_999_800 + 899_964);
    expect(doc.cartage.chargePaise).toBe(80_000);
    expect(doc.cartage.taxPaise).toBe(14_400);
    // One line only: 49,998 goods + 80,000 delivery + (8,999.64 + 144) GST.
    expect(doc.totals.grandTotalPaise).toBe(5_994_164);
    expect(doc.placeOfSupply).toBe("Rajasthan");
    expect(doc.totals.cgstPaise + doc.totals.sgstPaise).toBe(914_364);
  });

  it("prints the delivery line as included when the charge is zero", () => {
    const parsed = parseManualQuotationInput(payload({ deliveryCharge: "0" }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const doc = buildManualQuotation(parsed.value, ctx);
    expect(doc.cartage.chargePaise).toBe(0);
    expect(doc.cartage.taxPaise).toBe(0);
    expect(doc.cartage.description).toBe("Included in the quoted item prices");
    expect(doc.totals.grandTotalPaise).toBe(5_899_764);
  });

  it("stores distinct billing and shipping addresses when sameAsBilling is false", () => {
    const parsed = parseManualQuotationInput(
      payload({
        sameAsBilling: false,
        addressLine: "12 Transport Nagar",
        city: "Jaipur",
        state: "Rajasthan",
        pincode: "302001",
        shippingAddressLine: "Warehouse 4B, Bhiwandi",
        shippingCity: "Thane",
        shippingState: "Maharashtra",
        shippingPincode: "421302",
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const doc = buildManualQuotation(parsed.value, ctx);
    expect(doc.billing.addressLine).toBe("12 Transport Nagar");
    expect(doc.billing.city).toBe("Jaipur");
    expect(doc.billing.state).toBe("Rajasthan");
    expect(doc.billing.pincode).toBe("302001");

    expect(doc.shipping.addressLine).toBe("Warehouse 4B, Bhiwandi");
    expect(doc.shipping.city).toBe("Thane");
    expect(doc.shipping.state).toBe("Maharashtra");
    expect(doc.shipping.pincode).toBe("421302");
  });
});

describe("POST /api/admin/quotations", () => {
  const post = (body: unknown) =>
    POST(
      new Request("http://localhost/api/admin/quotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  it("issues a numbered, frozen quotation for an admin", async () => {
    const res = await post(payload());
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      ok: boolean;
      data: { id: string; quotationNumber: string; totalPaise: number };
    };
    expect(json.ok).toBe(true);
    expect(json.data.quotationNumber).toBe("QTN-TS0000123456");
    expect(json.data.id).toBe("quote-1");
    expect(json.data.totalPaise).toBe(5_994_164);

    expect(inserts).toHaveLength(1);
    const row = inserts[0]!;
    expect(row.quotation_number).toBe("QTN-TS0000123456");
    expect(row.party_type).toBe("dealer");
    expect(row.party_name).toBe("Sharma Traders");
    expect(row.total_paise).toBe(json.data.totalPaise);
    const data = row.data as { source?: string; kind?: string };
    expect(data.source).toBe("manual");
    expect(data.kind).toBe("quotation");
  });

  it("returns per-field validation errors without writing a row", async () => {
    const res = await post(payload({ name: "", items: [] }));
    expect(res.status).toBe(422);
    const json = (await res.json()) as {
      ok: boolean;
      error: { code: string; details: Record<string, string> };
    };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.details.name).toBeTruthy();
    expect(json.error.details.items).toBeTruthy();
    expect(inserts).toHaveLength(0);
  });

  it("refuses anonymous callers", async () => {
    authUser = null;
    const res = await post(payload());
    expect(res.status).toBe(401);
    expect(inserts).toHaveLength(0);
  });

  it("refuses signed-in non-admins", async () => {
    authUser = { id: "user-9" };
    adminFlag = false;
    const res = await post(payload());
    expect(res.status).toBe(403);
    expect(inserts).toHaveLength(0);
  });

  it("surfaces a failed write as a 500 without leaking details", async () => {
    failInsert = true;
    const res = await post(payload());
    expect(res.status).toBe(500);
    const json = (await res.json()) as { ok: boolean; error: { message: string } };
    expect(json.ok).toBe(false);
    expect(json.error.message).not.toContain("insert failed");
  });
});
