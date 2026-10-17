import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockClient,
  type MockResponder,
} from "@/tests/helpers/supabase-mock";
import { resetRateLimits } from "@/lib/rate-limit/index";

vi.mock("server-only", () => ({}));
// next/cache has no request store in unit tests; revalidation is a
// production-runtime concern, so it is a no-op here.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let authUser: { id: string } | null = { id: "admin-1" };
let adminFlag = true;
let handler: MockResponder = () => {
  throw new Error("unexpected query");
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createMockClient(handler, { authUser }),
}));

import {
  normalizeSlug,
  paiseToDecimal,
  validateProductInput,
  type ProductFormInput,
} from "@/lib/admin/product-validation";
import { POST as activePost } from "@/app/api/admin/products/[id]/active/route";
import { PATCH as stockPatch } from "@/app/api/admin/products/[id]/stock/route";
import {
  GET as detailGet,
  PATCH as detailPatch,
} from "@/app/api/admin/products/[id]/route";
import { GET as listGet, POST as createPost } from "@/app/api/admin/products/route";
import { isValidImageSrc, resolveProductImage } from "@/lib/storage/images";

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

const INPUT: ProductFormInput = {
  name: "Test Trolley",
  slug: "test-trolley",
  description: "A test trolley.",
  priceRupees: "6299.00",
  category: "Trolleys",
  images: ["/images/products/test.jpg"],
  specificationsJson: '{"capacity_kg": 500}',
  stockQuantity: 10,
  lowStockThreshold: 2,
  isActive: true,
  gstRate: "18",
  weightKg: "12.5",
  hsnCode: "87168010",
};

const routePost = (
  fn: (
    req: Request,
    ctx?: { params: Promise<{ id: string }> },
  ) => Promise<Response>,
  body: unknown,
  params?: Record<string, string>,
) =>
  fn(
    new Request("http://localhost/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    // Test-only: routes without dynamic segments ignore the context.
    (params ? { params: Promise.resolve(params) } : undefined) as unknown as {
      params: Promise<{ id: string }>;
    },
  );

describe("validateProductInput", () => {
  it("accepts a valid product and converts money exactly", () => {
    const { errors, value } = validateProductInput(INPUT);
    expect(errors).toEqual({});
    expect(value?.pricePaise).toBe(629900);
    expect(value?.slug).toBe("test-trolley");
    expect(value?.specifications).toEqual({ capacity_kg: 500 });
    expect(value?.gstRate).toBe("18.00");
    expect(value?.hsnCode).toBe("87168010");
  });

  it("accepts a blank HSN as not-configured and rejects bad codes", () => {
    expect(validateProductInput({ ...INPUT, hsnCode: "" }).value?.hsnCode).toBeNull();
    for (const bad of ["12", "12345", "1234567", "123456789", "ABCD1234", "8716 8010"]) {
      expect(
        validateProductInput({ ...INPUT, hsnCode: bad }).errors.hsnCode,
        bad,
      ).toBeTruthy();
    }
    for (const good of ["8716", "871680", "87168010"]) {
      expect(validateProductInput({ ...INPUT, hsnCode: good }).value?.hsnCode).toBe(good);
    }
  });

  it("accepts a blank GST rate as not-configured and rejects bad rates", () => {
    expect(validateProductInput({ ...INPUT, gstRate: "" }).value?.gstRate).toBeNull();
    expect(
      validateProductInput({ ...INPUT, gstRate: "101" }).errors.gstRate,
    ).toBeTruthy();
    expect(
      validateProductInput({ ...INPUT, gstRate: "12.999" }).errors.gstRate,
    ).toBeTruthy();
    expect(
      validateProductInput({ ...INPUT, gstRate: "-5" }).errors.gstRate,
    ).toBeTruthy();
    expect(validateProductInput({ ...INPUT, gstRate: " 5 " }).value?.gstRate).toBe(
      "5.00",
    );
  });

  it("rejects bad name, slug, price, category and stock", () => {
    const { errors, value } = validateProductInput({
      ...INPUT,
      name: "x",
      slug: "Bad Slug!!",
      priceRupees: "12.999",
      category: "",
      stockQuantity: -1,
    });
    expect(value).toBeNull();
    expect(errors.name).toBeTruthy();
    // Slug normalises instead of failing when possible.
    expect(errors.slug).toBeUndefined();
    expect(errors.priceRupees).toContain("2 decimals");
    expect(errors.category).toBeTruthy();
    expect(errors.stockQuantity).toBeTruthy();
  });

  it("validates the low-stock threshold alongside stock", () => {
    expect(validateProductInput(INPUT).value?.lowStockThreshold).toBe(2);
    expect(
      validateProductInput({ ...INPUT, lowStockThreshold: -1 }).errors
        .lowStockThreshold,
    ).toBeTruthy();
    expect(
      validateProductInput({ ...INPUT, lowStockThreshold: 1.5 }).errors
        .lowStockThreshold,
    ).toBeTruthy();
    expect(
      validateProductInput({ ...INPUT, lowStockThreshold: 0 }).errors,
    ).toEqual({});
  });

  it("accepts a valid weight and rejects bad weights", () => {
    expect(validateProductInput(INPUT).value?.weightKg).toBe("12.500");
    expect(validateProductInput({ ...INPUT, weightKg: "" }).value?.weightKg).toBeNull();
    expect(
      validateProductInput({ ...INPUT, weightKg: "12.9999" }).errors.weightKg,
    ).toBeTruthy();
    expect(
      validateProductInput({ ...INPUT, weightKg: "-3" }).errors.weightKg,
    ).toBeTruthy();
    expect(
      validateProductInput({ ...INPUT, weightKg: "0" }).errors.weightKg,
    ).toBeTruthy();
  });

  it("rejects non-object and broken JSON specs", () => {
    expect(
      validateProductInput({ ...INPUT, specificationsJson: "[1]" }).errors
        .specificationsJson,
    ).toBeTruthy();
    expect(
      validateProductInput({ ...INPUT, specificationsJson: "{oops" }).errors
        .specificationsJson,
    ).toBeTruthy();
  });

  it("rejects bad image paths", () => {
    expect(
      validateProductInput({ ...INPUT, images: ["ftp://x/y.jpg"] }).errors.images,
    ).toBeTruthy();
  });

  it("normalises slugs and converts paise back exactly", () => {
    expect(normalizeSlug("Lifting & Stacking!")).toBe("lifting-and-stacking");
    expect(paiseToDecimal(629900)).toBe("6299.00");
  });
});

describe("image handling", () => {
  it.each(["/images/products/a.jpg", "https://cdn.example/a.webp"])(
    "accepts %s",
    (s) => {
      expect(isValidImageSrc(s)).toBe(true);
    },
  );
  it.each(["ftp://x/a.jpg", "/images/../x.jpg", "notaurl", "/images/a.txt"])(
    "rejects %s",
    (s) => {
      expect(isValidImageSrc(s)).toBe(false);
    },
  );
  it("falls back to the placeholder", () => {
    expect(resolveProductImage([])).toContain("placeholder");
    expect(resolveProductImage(["/images/products/a.jpg"])).toBe(
      "/images/products/a.jpg",
    );
  });
});

describe("admin product APIs", () => {
  it("lists with safe projections", async () => {
    handler = (op) => {
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      if (op.table === "products") {
        return {
          rows: [
            {
              id: "p1",
              name: "T",
              slug: "t",
              category: "C",
              price: "10.00",
              stock_quantity: 1,
              images: [],
              is_active: true,
              created_at: "2026-10-04T00:00:00Z",
            },
          ],
          error: null,
          count: 1,
        };
      }
      throw new Error("unreachable");
    };
    const res = await listGet(new Request("http://localhost/api/admin/products"));
    const json = (await res.json()) as {
      ok: boolean;
      data: { products: Array<Record<string, unknown>>; total: number };
    };
    expect(json.ok).toBe(true);
    expect(json.data.total).toBe(1);
    expect(json.data.products[0]).toMatchObject({
      name: "T",
      pricePaise: 1000,
    });
  });

  it("creates products and maps duplicate slugs", async () => {
    handler = (op) => {
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      if (op.table === "products") return { rows: [{ id: "new-1" }], error: null };
      throw new Error("unreachable");
    };
    const res = await routePost(createPost, INPUT);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);

    handler = (op) => {
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      if (op.table === "products") {
        return { rows: [], error: { message: "duplicate", code: "23505" } };
      }
      throw new Error("unreachable");
    };
    const dup = await routePost(createPost, INPUT);
    const json = (await dup.json()) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(json.ok).toBe(false);
    expect(json.error.message).toContain("slug");
  });

  it("rejects invalid prices and unauthorized callers", async () => {
    handler = (op) => {
      if (op.table === "profiles") {
        return {
          rows: adminFlag ? [{ is_admin: true }] : [],
          error: null,
        };
      }
      throw new Error("must not reach the database");
    };
    const bad = await routePost(createPost, { ...INPUT, priceRupees: "-5" });
    expect(bad.status).toBe(422);

    authUser = null;
    const anon = await routePost(createPost, INPUT);
    expect(anon.status).toBe(401);

    authUser = { id: "u1" };
    adminFlag = false;
    const nonAdmin = await routePost(createPost, INPUT);
    expect(nonAdmin.status).toBe(403);
  });

  it("toggles active state", async () => {
    handler = (op) => {
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      if (op.table === "products") return { rows: [{ id: "p1" }], error: null };
      throw new Error("unreachable");
    };
    const res = await activePost(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      }),
      { params: Promise.resolve({ id: "p1" }) },
    );
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });

  it("patches products and 404s on missing rows", async () => {
    handler = (op) => {
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      if (op.table === "products") return { rows: [], error: null };
      throw new Error("unreachable");
    };
    const res = await detailPatch(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(INPUT),
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );
    expect(res.status).toBe(404);
    const detail = await detailGet(
      new Request("http://localhost/x"),
      { params: Promise.resolve({ id: "missing" }) },
    );
    expect(detail.status).toBe(404);
  });
});

describe("quick stock edit (admin list)", () => {
  const stockReq = (body: unknown, id = "p1") =>
    stockPatch(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );

  it("sets stock and writes a signed inventory event", async () => {
    const updates: unknown[] = [];
    const events: unknown[] = [];
    handler = (op) => {
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      if (op.table === "products") {
        if (op.updateValues !== undefined) {
          updates.push(op.updateValues);
          return { rows: [{ id: "p1" }], error: null };
        }
        return { rows: [{ stock_quantity: 3 }], error: null };
      }
      if (op.table === "inventory_events") {
        events.push(op.updateValues);
        return { rows: [], error: null };
      }
      throw new Error(`unexpected table ${op.table}`);
    };
    const res = await stockReq({ stockQuantity: 12 });
    expect(res.status).toBe(200);
    expect(updates).toEqual([{ stock_quantity: 12 }]);
    expect(events).toEqual([
      {
        product_id: "p1",
        order_id: null,
        event: "adjusted",
        quantity: 9,
        balance_after: 12,
        note: "manual stock adjustment (list edit)",
      },
    ]);
  });

  it("no-ops when the value is unchanged", async () => {
    const updates: unknown[] = [];
    const events: unknown[] = [];
    handler = (op) => {
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      if (op.table === "products") {
        if (op.updateValues !== undefined) {
          updates.push(op.updateValues);
          return { rows: [{ id: "p1" }], error: null };
        }
        return { rows: [{ stock_quantity: 7 }], error: null };
      }
      if (op.table === "inventory_events") {
        events.push(op.updateValues);
        return { rows: [], error: null };
      }
      throw new Error(`unexpected table ${op.table}`);
    };
    const res = await stockReq({ stockQuantity: 7 });
    expect(res.status).toBe(200);
    expect(updates).toEqual([]);
    expect(events).toEqual([]);
  });

  it("rejects invalid quantities before touching the database", async () => {
    handler = (op) => {
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      throw new Error("must not reach the database");
    };
    for (const bad of [-1, 1.5, "10", 1_000_001, null]) {
      const res = await stockReq({ stockQuantity: bad });
      expect(res.status, String(bad)).toBe(422);
    }
    const noBody = await stockPatch(
      new Request("http://localhost/x", { method: "PATCH" }),
      { params: Promise.resolve({ id: "p1" }) },
    );
    expect(noBody.status).toBe(400);
  });

  it("404s when the product does not exist", async () => {
    handler = (op) => {
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      if (op.table === "products") return { rows: [], error: null };
      throw new Error("unreachable");
    };
    const res = await stockReq({ stockQuantity: 5 }, "missing");
    expect(res.status).toBe(404);
  });
});
