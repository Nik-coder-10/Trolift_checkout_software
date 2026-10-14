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

import { parseProductCsv } from "@/lib/admin/product-import";
import { escapeCsvCell, toCsv } from "@/lib/admin/csv";
import {
  confirmImport,
  previewImport,
} from "@/lib/admin/importer";
import { exportColumns } from "@/lib/admin/exporter";
import { POST as previewPost } from "@/app/api/admin/import/preview/route";
import { POST as confirmPost } from "@/app/api/admin/import/confirm/route";
import { GET as exportGet } from "@/app/api/admin/export/[type]/route";

beforeEach(() => {
  resetRateLimits();
  authUser = { id: "admin-1" };
  adminFlag = true;
  handler = () => {
    throw new Error("unexpected query");
  };
});

const PRODUCT_CSV = `name,slug,description,category,price,stock,threshold,active,gst,weight
Demo Trolley,demo-trolley,Steel trolley,Trolleys,6299.00,10,5,true,18,32
Old Stacker,old-stacker,,Lifting,100.00,,,false,,`;

const RATE_CSV = `pincode,partner,charge,serviceable,min_order,max_order,eta_min,eta_max
400001,Delhivery,450.00,true,,,2,4`;

const post = (fn: (req: Request) => Promise<Response>, body: unknown) =>
  fn(
    new Request("http://localhost/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

/** Products-side mock: existing slugs + RPC apply + audit sink. */
function wireProducts(existingSlugs: string[] = [], rpc?: { inserted: number; updated: number }) {
  handler = (op) => {
    if (op.table === "products" && !op.updateValues) {
      return {
        rows: existingSlugs.map((slug) => ({ slug })),
        error: null,
      };
    }
    if (op.rpc === "import_products") {
      return { rows: [rpc ?? { inserted: 2, updated: 0 }], error: null };
    }
    if (op.table === "admin_audit_log") {
      return { rows: [{ id: "a1" }], error: null };
    }
    throw new Error(`unexpected ${op.table ?? op.rpc}`);
  };
}

function wireRates() {
  handler = (op) => {
    if (op.table === "delivery_partners") {
      return {
        rows: [{ id: "a1b2c3d4-0001-4000-8000-000000000001", name: "Delhivery" }],
        error: null,
      };
    }
    if (op.table === "delivery_pincode_rates" && !op.updateValues) {
      return { rows: [], error: null };
    }
    if (op.rpc === "import_rates") {
      return { rows: [{ inserted: 1, updated: 0 }], error: null };
    }
    if (op.table === "admin_audit_log") {
      return { rows: [{ id: "a1" }], error: null };
    }
    throw new Error(`unexpected ${op.table ?? op.rpc}`);
  };
}

describe("product CSV parsing", () => {
  it("parses a valid file with defaults", () => {
    const { rows, errors } = parseProductCsv(PRODUCT_CSV);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "Demo Trolley", slug: "demo-trolley" });
  });

  it("rejects bad headers, missing fields and bad flags", () => {
    expect(parseProductCsv("a,b\n1,2").errors.length).toBeGreaterThan(0);
    expect(
      parseProductCsv(
        "name,slug,description,category,price,stock,threshold,active,gst,weight\n,只有slug,,,,,,,,",
      ).errors[0]?.message,
    ).toMatch(/name is required/);
    const bad = parseProductCsv(
      "name,slug,description,category,price,stock,threshold,active,gst,weight\nN,S,D,C,10,0,0,maybe,,",
    );
    expect(bad.errors[0]?.message).toMatch(/active must be/);
  });
});

describe("product import (slug-matched, no SKU invented)", () => {
  it("previews creates vs updates without writing", async () => {
    wireProducts(["old-stacker"]);
    const preview = await previewImport("products", PRODUCT_CSV);
    expect(preview.total).toBe(2);
    expect(preview.valid).toBe(2);
    expect(preview.creates).toBe(1);
    expect(preview.updates).toBe(1);
    expect(preview.invalidTotal).toBe(0);
  });

  it("rejects bad prices, duplicate slugs and bad stock", async () => {
    wireProducts([]);
    const badPrice = await previewImport(
      "products",
      "name,slug,description,category,price,stock,threshold,active,gst,weight\nN,s,D,C,12.999,0,0,,,,\n",
    );
    expect(badPrice.invalidTotal).toBe(1);
    const dup = await previewImport(
      "products",
      "name,slug,description,category,price,stock,threshold,active,gst,weight\nAlpha,dup,Desc,Tools,10,0,0,,,\nBeta,dup,Desc,Tools,10,0,0,,,\n",
    );
    expect(dup.invalidTotal).toBe(1);
    expect(dup.invalid[0]?.message).toMatch(/Duplicate slug/);
    const badStock = await previewImport(
      "products",
      "name,slug,description,category,price,stock,threshold,active,gst,weight\nN,s,D,C,10,nope,0,,,\n",
    );
    expect(badStock.invalidTotal).toBe(1);
  });

  it("confirms atomically and audits the result", async () => {
    wireProducts([]);
    const result = await confirmImport("products", PRODUCT_CSV, "admin-1");
    expect(result.inserted).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.invalidTotal).toBe(0);
  });

  it("confirm rejects invalid files with zero writes", async () => {
    let rpcCalls = 0;
    wireProducts([]);
    handler = (op) => {
      if (op.table === "products" && !op.updateValues) {
        return { rows: [], error: null };
      }
      if (op.rpc === "import_products") {
        rpcCalls++;
        return { rows: [{ inserted: 0, updated: 0 }], error: null };
      }
      throw new Error(`must not write on invalid input: ${op.table ?? op.rpc}`);
    };
    await expect(
      confirmImport(
        "products",
        "name,slug,description,category,price,stock,threshold,active,gst,weight\nN,s,D,C,12.999,0,0,,,\n",
        "admin-1",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    expect(rpcCalls).toBe(0);
  });
});

describe("rates import via unified pipeline", () => {
  it("previews and confirms through the same validators", async () => {
    wireRates();
    const preview = await previewImport("rates", RATE_CSV);
    expect(preview.valid).toBe(1);
    expect(preview.creates).toBe(1);
    const result = await confirmImport("rates", RATE_CSV, "admin-1");
    expect(result.inserted).toBe(1);
  });

  it("flags bad pincodes, unknown partners and duplicates", async () => {
    wireRates();
    const badPin = await previewImport(
      "rates",
      "pincode,partner,charge,serviceable,min_order,max_order,eta_min,eta_max\n123,Delhivery,10,true,,,,\n",
    );
    expect(badPin.invalidTotal).toBe(1);
    const unknown = await previewImport(
      "rates",
      "pincode,partner,charge,serviceable,min_order,max_order,eta_min,eta_max\n400001,Nope,10,true,,,,\n",
    );
    expect(unknown.invalid[0]?.message).toMatch(/Unknown partner/);
    const dup = await previewImport(
      "rates",
      "pincode,partner,charge,serviceable,min_order,max_order,eta_min,eta_max\n400001,Delhivery,10,true,,,,\n400001,Delhivery,11,true,,,,\n",
    );
    expect(dup.invalid[0]?.message).toMatch(/Duplicate/);
  });
});

describe("import routes (whitelist + auth)", () => {
  it("rejects unknown types and anonymous/non-admin callers", async () => {
    wireProducts([]);
    const badType = await post(previewPost, { type: "profiles", csv: "a" });
    expect(badType.status).toBe(400);
    authUser = null;
    expect((await post(previewPost, { type: "products", csv: PRODUCT_CSV })).status).toBe(401);
    expect((await post(confirmPost, { type: "products", csv: PRODUCT_CSV })).status).toBe(401);
    authUser = { id: "u1" };
    adminFlag = false;
    expect((await post(previewPost, { type: "products", csv: PRODUCT_CSV })).status).toBe(403);
    expect((await post(confirmPost, { type: "products", csv: PRODUCT_CSV })).status).toBe(403);
  });

  it("serves preview then confirm over HTTP", async () => {
    wireProducts([]);
    const preview = await post(previewPost, { type: "products", csv: PRODUCT_CSV });
    expect(preview.status).toBe(200);
    const confirm = await post(confirmPost, { type: "products", csv: PRODUCT_CSV });
    expect(confirm.status).toBe(200);
    const json = (await confirm.json()) as {
      ok: boolean;
      data: { inserted: number };
    };
    expect(json.data.inserted).toBe(2);
  });

  it("caps oversized files", async () => {
    wireProducts([]);
    const big = `name,slug,description,category,price,stock,threshold,active,gst,weight\n${"N,s,D,C,10,0,0,,,\n".repeat(2001)}`;
    const res = await post(previewPost, { type: "products", csv: big });
    expect(res.status).toBe(413);
  });
});

describe("product HSN across CSV import/export", () => {
  const V2_CSV = `name,slug,description,category,price,stock,threshold,active,gst,weight,hsn
Demo Trolley,demo-trolley,Steel trolley,Trolleys,6299.00,10,5,true,18,32,87168010
Plain Cart,plain-cart,,Trolleys,100.00,,,true,,,`;

  it("parses the current header with HSN populated and empty", () => {
    const { rows, errors } = parseProductCsv(V2_CSV);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ slug: "demo-trolley", hsn: "87168010" });
    expect(rows[1]).toMatchObject({ slug: "plain-cart", hsn: "" });
  });

  it("accepts legacy 10-column files with a blank HSN", () => {
    const { rows, errors } = parseProductCsv(PRODUCT_CSV);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ slug: "demo-trolley", hsn: "" });
  });

  it("rejects a bad HSN naming the row, not the whole file", async () => {
    wireProducts([]);
    const bad = `name,slug,description,category,price,stock,threshold,active,gst,weight,hsn
Demo Trolley,demo-trolley,Steel trolley,Trolleys,6299.00,10,5,true,18,32,12`;
    const preview = await previewImport("products", bad);
    expect(preview.valid).toBe(0);
    expect(preview.invalidTotal).toBe(1);
    expect(preview.invalid[0]?.message).toMatch(/hsn/i);
  });

  it("export output re-imports with HSN preserved (round trip)", async () => {
    // The export header IS an accepted import header (contract).
    expect(exportColumns("products").join(",")).toBe(
      "name,slug,description,category,price,stock,threshold,active,gst,weight,hsn",
    );
    const exported = `${exportColumns("products").join(",")}
"Demo, Trolley",demo-trolley,Steel trolley,Trolleys,6299.00,10,5,true,18.00,,87168010`;
    const { rows, errors } = parseProductCsv(exported);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ slug: "demo-trolley", hsn: "87168010" });
  });

  it("carries HSN through confirm to the import RPC", async () => {
    let rpcArgs: unknown = null;
    handler = (op) => {
      if (op.table === "products" && !op.updateValues) {
        return { rows: [], error: null };
      }
      if (op.rpc === "import_products") {
        rpcArgs = (op as { rpcArgs?: unknown }).rpcArgs ?? null;
        return { rows: [{ inserted: 1, updated: 0 }], error: null };
      }
      if (op.table === "admin_audit_log") {
        return { rows: [{ id: "a1" }], error: null };
      }
      throw new Error(`unexpected ${op.table ?? op.rpc}`);
    };
    const result = await confirmImport("products", V2_CSV, "admin-1");
    expect(result.inserted).toBe(1);
    const rows = (rpcArgs as { p_rows: Array<Record<string, unknown>> }).p_rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.["hsn_code"]).toBe("87168010");
    expect(rows[1]?.["hsn_code"]).toBe("");
  });
});

describe("exports (allowlisted columns, snapshot orders)", () => {
  const get = (type: string) =>
    exportGet(new Request("http://localhost/x"), {
      params: Promise.resolve({ type }),
    });

  it("rejects unknown datasets and non-admins", async () => {
    const res = await get("profiles");
    expect(res.status).toBe(404);
    authUser = null;
    expect((await get("products")).status).toBe(401);
    authUser = { id: "u1" };
    adminFlag = false;
    expect((await get("products")).status).toBe(403);
  });

  it("exports products with the exact allowlisted header", async () => {
    // Call order is deterministic: exact count first, then pages.
    let productCalls = 0;
    const productRow = {
      slug: "demo-trolley",
      name: "Demo, Trolley",
      description: 'Steel "tough"',
      category: "Trolleys",
      price: "6299.00",
      stock_quantity: 10,
      low_stock_threshold: 5,
      is_active: true,
      gst_rate: "18.00",
      weight_kg: null,
      hsn_code: "87168010",
    };
    handler = (op) => {
      if (op.table === "products" && !op.updateValues) {
        productCalls++;
        if (productCalls === 1) return { rows: [], error: null, count: 1 };
        if (productCalls === 2) return { rows: [productRow], error: null };
        return { rows: [], error: null };
      }
      if (op.table === "admin_audit_log") {
        return { rows: [{ id: "a1" }], error: null };
      }
      throw new Error(`unexpected ${op.table ?? op.rpc}`);
    };
    const res = await get("products");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    const text = await res.text();
    const [header, body] = text.trim().split("\n");
    expect(header).toBe(
      "name,slug,description,category,price,stock,threshold,active,gst,weight,hsn",
    );
    expect(body).toBe(
      '"Demo, Trolley",demo-trolley,"Steel ""tough""",Trolleys,6299.00,10,5,true,18.00,,87168010',
    );
    for (const secret of ["password", "service_role", "SUPABASE", "token"]) {
      expect(text.toLowerCase()).not.toContain(secret);
    }
  });

  it("exports orders from frozen snapshots, never live prices", async () => {
    let orderCalls = 0;
    const orderRow = {
      order_number: "TS-1",
      created_at: "2026-10-01T00:00:00Z",
      customer_name_snapshot: "Acme",
      customer_phone_snapshot: "+919810001111",
      customer_email_snapshot: null,
      gstin_snapshot: "27ABCDE1234F1Z0",
      billing_name: null,
      billing_address_line: null,
      billing_city: null,
      billing_state: null,
      billing_pincode: null,
      subtotal: "12598.00",
      delivery_charge: "450.00",
      taxable_amount: "12598.00",
      cgst_amount: "1133.82",
      sgst_amount: "1133.82",
      igst_amount: "0.00",
      total_amount: "15315.64",
      payment_status: "paid",
      order_status: "confirmed",
      delivery_pincode: "400001",
      delivery_partner_name: "Delhivery",
    };
    handler = (op) => {
      if (op.table === "orders" && !op.updateValues) {
        orderCalls++;
        if (orderCalls === 1) return { rows: [], error: null, count: 1 };
        if (orderCalls === 2) return { rows: [orderRow], error: null };
        return { rows: [], error: null };
      }
      if (op.table === "admin_audit_log") {
        return { rows: [{ id: "a1" }], error: null };
      }
      throw new Error(`unexpected ${op.table ?? op.rpc}`);
    };
    const res = await get("orders");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("TS-1");
    expect(text).toContain("15315.64");
    expect(text).toContain("27ABCDE1234F1Z0");
    // No live-catalogue read may occur for an order export.
    expect(exportColumns("orders")).not.toContain("price");
  });

  it("exports customers and rates with exact headers", async () => {
    handler = (op) => {
      if (
        (op.table === "customers" || op.table === "delivery_pincode_rates") &&
        !op.updateValues
      ) {
        // Count query first, then an empty page — header-only output.
        return { rows: [], error: null, count: 0 };
      }
      if (op.table === "admin_audit_log") {
        return { rows: [{ id: "a1" }], error: null };
      }
      throw new Error(`unexpected ${op.table ?? op.rpc}`);
    };
    const customers = await get("customers");
    expect(customers.status).toBe(200);
    expect((await customers.text()).split("\n")[0]).toBe(
      exportColumns("customers").join(","),
    );
    const rates = await get("rates");
    expect(rates.status).toBe(200);
    expect((await rates.text()).split("\n")[0]).toBe(
      "pincode,partner,charge,serviceable,min_order,max_order,eta_min,eta_max",
    );
  });
});

describe("CSV utilities", () => {
  it("escapes cells and round-trips tables", () => {
    expect(escapeCsvCell('Steel "tough", heavy')).toBe('"Steel ""tough"", heavy"');
    expect(escapeCsvCell("plain")).toBe("plain");
    const csv = toCsv(["a", "b"], [["1", "x,y"], ["2", "z"]]);
    expect(csv).toBe("a,b\n1,\"x,y\"\n2,z\n");
  });

  it("streams large datasets in bounded chunks", async () => {
    // 700 product rows through the real chunked exporter. The mock
    // cannot introspect ranges, so pages are served by call count:
    // full page, partial page, empty page → the exporter must stop
    // after exactly three page queries (never one giant pull, never
    // an infinite loop).
    const { buildExport } = await import("@/lib/admin/exporter");
    const row = (slug: string) => ({
      slug,
      name: `P ${slug}`,
      description: "",
      category: "Trolleys",
      price: "10.00",
      stock_quantity: 1,
      low_stock_threshold: 5,
      is_active: true,
      gst_rate: null,
      weight_kg: null,
    });
    const fullPage = Array.from({ length: 500 }, (_, i) => row(`p-${i}`));
    const partPage = Array.from({ length: 200 }, (_, i) => row(`q-${i}`));
    const pages = [fullPage, partPage, []];
    let productCalls = 0;
    handler = (op) => {
      if (op.table === "products" && !op.updateValues) {
        productCalls++;
        // First call is the exact-count query; the rest are pages.
        if (productCalls === 1) return { rows: [], error: null, count: 700 };
        const page = pages[Math.min(productCalls - 2, pages.length - 1)] ?? [];
        return { rows: page, error: null };
      }
      if (op.table === "admin_audit_log") {
        return { rows: [{ id: "a1" }], error: null };
      }
      throw new Error(`unexpected ${op.table ?? op.rpc}`);
    };
    const handle = await buildExport("products", "admin-1");
    expect(handle.rowCount).toBe(700);
    const text = await new Response(handle.stream).text();
    const lines = text.trim().split("\n");
    expect(lines[0]).toBe(exportColumns("products").join(","));
    // Header + all 700 rows, first and last in order.
    expect(lines).toHaveLength(701);
    expect(lines[1]).toContain("p-0");
    expect(lines[700]).toContain("q-199");
    // Count + three page queries (full, partial, empty-then-close).
    expect(productCalls).toBe(4);
  });
});
