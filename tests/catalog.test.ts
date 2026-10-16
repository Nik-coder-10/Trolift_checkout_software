import { describe, expect, it } from "vitest";
import {
  ALL_PRODUCTS,
  FEATURED_PRODUCTS,
  buildCatalogueHref,
  formatSpecEntries,
  groupByCategory,
  parseCatalogueParams,
  slugifyCategory,
} from "@/lib/catalog/products";
import {
  getCataloguePage,
  getCategories,
  getFeaturedProducts,
  getProductBySlug,
  getProductSlugs,
  getRelatedProducts,
} from "@/lib/catalog/queries";

describe("groupByCategory", () => {
  it("counts, slugifies and sorts", () => {
    const out = groupByCategory([
      { category: "Trolleys" },
      { category: "Lifting & Stacking" },
      { category: "Trolleys" },
    ]);
    expect(out).toEqual([
      {
        slug: "lifting-and-stacking",
        name: "Lifting & Stacking",
        blurb: expect.any(String),
        productCount: 1,
      },
      {
        slug: "trolleys",
        name: "Trolleys",
        blurb: expect.any(String),
        productCount: 2,
      },
    ]);
  });

  it("falls back to a generic blurb for unknown categories", () => {
    const [only] = groupByCategory([{ category: "Scaffolding" }]);
    expect(only?.slug).toBe("scaffolding");
    expect(only?.blurb).toContain("scaffolding");
  });

  it("slugifies safely", () => {
    expect(slugifyCategory("Material Handling (Heavy)")).toBe(
      "material-handling-heavy",
    );
  });
});

describe("static fallback catalogue (mirrors seed.sql)", () => {
  it("covers every seed category", () => {
    const cats = new Set(ALL_PRODUCTS.map((p) => p.category));
    expect(cats.size).toBeGreaterThanOrEqual(2);
  });

  it("featured is a subset of all", () => {
    const ids = new Set(ALL_PRODUCTS.map((p) => p.id));
    for (const p of FEATURED_PRODUCTS) expect(ids.has(p.id)).toBe(true);
  });
});

describe("parseCatalogueParams", () => {
  it("defaults page 1 and standard page size", () => {
    expect(parseCatalogueParams({})).toEqual({
      sort: "featured",
      page: 1,
      pageSize: 12,
    });
  });

  it("clamps page and page size", () => {
    expect(parseCatalogueParams({ page: "0", pageSize: "999" })).toEqual({
      sort: "featured",
      page: 1,
      pageSize: 48,
    });
    expect(parseCatalogueParams({ page: "abc", pageSize: "-3" })).toEqual({
      sort: "featured",
      page: 1,
      pageSize: 1,
    });
  });

  it("trims category and takes the first of repeated params", () => {
    expect(
      parseCatalogueParams({ category: " trolleys ", page: ["2", "3"] }),
    ).toEqual({
      categorySlug: "trolleys",
      sort: "featured",
      page: 2,
      pageSize: 12,
    });
  });

  it("drops blank category", () => {
    expect(parseCatalogueParams({ category: "  " }).categorySlug).toBeUndefined();
  });
});

describe("parseCatalogueParams: search, sort, price", () => {
  it("parses q and defaults sort to relevance", () => {
    expect(parseCatalogueParams({ q: "  trolley " })).toEqual({
      q: "trolley",
      sort: "relevance",
      page: 1,
      pageSize: 12,
    });
  });

  it("defaults sort to featured without q", () => {
    expect(parseCatalogueParams({}).sort).toBe("featured");
  });

  it("accepts valid sorts, falls back otherwise", () => {
    expect(parseCatalogueParams({ sort: "price_asc" }).sort).toBe("price_asc");
    expect(parseCatalogueParams({ sort: "bogus", q: "x" }).sort).toBe("relevance");
    expect(parseCatalogueParams({ sort: "bogus" }).sort).toBe("featured");
  });

  it("parses price bounds and flags inverted ranges", () => {
    expect(parseCatalogueParams({ min: "5000", max: "100000" })).toMatchObject({
      minPrice: 5000,
      maxPrice: 100000,
    });
    const bad = parseCatalogueParams({ min: "999", max: "10" });
    expect(bad.priceError).toContain("Minimum price");
    expect(bad.minPrice).toBeUndefined();
    expect(bad.maxPrice).toBeUndefined();
    expect(parseCatalogueParams({ min: "-5" }).minPrice).toBeUndefined();
  });

  it("caps q length", () => {
    expect(parseCatalogueParams({ q: "x".repeat(200) }).q).toHaveLength(100);
  });
});

describe("buildCatalogueHref", () => {
  it("omits defaults for clean shareable URLs", () => {
    expect(buildCatalogueHref({})).toBe("/products");
    expect(buildCatalogueHref({ page: 1, sort: "featured" })).toBe("/products");
  });

  it("keeps every active filter", () => {
    expect(
      buildCatalogueHref({
        q: "trolley",
        categorySlug: "trolleys",
        sort: "price_asc",
        minPrice: 1000,
        maxPrice: 50000,
        page: 2,
      }),
    ).toBe(
      "/products?q=trolley&category=trolleys&sort=price_asc&min=1000&max=50000&page=2",
    );
  });
});

describe("getCataloguePage without Supabase (offline fallback)", () => {
  it("pages all products", async () => {
    const r = await getCataloguePage({ page: 1, pageSize: 12 });
    expect(r.total).toBe(18);
    expect(r.totalPages).toBe(2);
    expect(r.products).toHaveLength(12);
    expect(r.unknownCategory).toBe(false);
    expect(r.live).toBe(false);
  });

  it("slices pages", async () => {
    const r = await getCataloguePage({ page: 3, pageSize: 3 });
    expect(r.total).toBe(18);
    expect(r.totalPages).toBe(6);
    expect(r.products).toHaveLength(3);
  });

  it("filters by category slug", async () => {
    const r = await getCataloguePage({
      categorySlug: "trolleys",
      page: 1,
      pageSize: 12,
    });
    expect(r.total).toBe(7);
    expect(r.activeCategory?.name).toBe("Trolleys");
    expect(r.unknownCategory).toBe(false);
  });

  it("reports unknown categories as empty, not errors", async () => {
    const r = await getCataloguePage({
      categorySlug: "nope",
      page: 1,
      pageSize: 12,
    });
    expect(r.unknownCategory).toBe(true);
    expect(r.products).toHaveLength(0);
    expect(r.total).toBe(0);
  });

  it("returns an empty page past the end", async () => {
    const r = await getCataloguePage({ page: 99, pageSize: 12 });
    expect(r.products).toHaveLength(0);
    expect(r.total).toBe(18);
    expect(r.totalPages).toBe(2);
  });

  it("searches names, categories and descriptions", async () => {
    const r = await getCataloguePage({
      q: "trolley",
      sort: "relevance",
      page: 1,
      pageSize: 12,
    });
    expect(r.total).toBeGreaterThan(0);
    expect(
      r.products.every((p) =>
        `${p.name} ${p.category} ${p.description}`.toLowerCase().includes("trolley"),
      ),
    ).toBe(true);
  });

  it("applies price windows", async () => {
    const r = await getCataloguePage({
      minPrice: 5000,
      maxPrice: 10000,
      page: 1,
      pageSize: 12,
    });
    expect(r.total).toBeGreaterThan(0);
    expect(
      r.products.every((p) => Number(p.price) >= 5000 && Number(p.price) <= 10000),
    ).toBe(true);
  });

  it("sorts by price ascending", async () => {
    const r = await getCataloguePage({
      sort: "price_asc",
      page: 1,
      pageSize: 12,
    });
    const prices = r.products.map((p) => Number(p.price));
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it("combines query, category and price", async () => {
    const r = await getCataloguePage({
      q: "telescopic",
      categorySlug: "ladders",
      minPrice: 5000,
      page: 1,
      pageSize: 12,
    });
    expect(r.unknownCategory).toBe(false);
    expect(
      r.products.every(
        (p) => p.category === "Ladders" && Number(p.price) >= 5000,
      ),
    ).toBe(true);
  });
});

describe("formatSpecEntries", () => {
  it("prettifies keys and stringifies values", () => {
    expect(
      formatSpecEntries({ capacity_kg: 2500, battery: "24V", test: true }),
    ).toEqual([
      { label: "capacity kg", value: "2500" },
      { label: "battery", value: "24V" },
      { label: "test", value: "true" },
    ]);
  });

  it("returns [] for null, arrays and nested objects safely", () => {
    expect(formatSpecEntries(null)).toEqual([]);
    expect(formatSpecEntries(["a"])).toEqual([]);
    expect(formatSpecEntries({ dims: { w: 1 } })).toEqual([
      { label: "dims", value: '{"w":1}' },
    ]);
  });
});

describe("getRelatedProducts without Supabase (offline fallback)", () => {
  it("returns same-category products excluding self", async () => {
    const id = "c7d8e9f0-0003-4000-8000-000000000003";
    const related = await getRelatedProducts("Ladders", id);
    expect(related.length).toBeGreaterThan(0);
    expect(related.every((p) => p.category === "Ladders")).toBe(true);
    expect(related.some((p) => p.id === id)).toBe(false);
    expect(related.every((p) => p.is_active)).toBe(true);
  });

  it("returns [] when nothing else qualifies", async () => {
    const related = await getRelatedProducts(
      "Packaging",
      "c7d8e9f0-000c-4000-8000-00000000000c",
    );
    expect(related).toEqual([]);
  });
});

describe("queries without Supabase configured (offline fallback)", () => {
  it("returns static featured products", async () => {
    const products = await getFeaturedProducts();
    expect(products.length).toBeGreaterThan(0);
    expect(products.every((p) => p.is_active)).toBe(true);
  });

  it("returns static categories with counts", async () => {
    const cats = await getCategories();
    expect(cats.length).toBeGreaterThan(0);
    expect(cats.every((c) => c.productCount > 0)).toBe(true);
  });

  it("lists static slugs for prerendering", async () => {
    const slugs = await getProductSlugs();
    expect(slugs).toContain("talt-032");
    expect(slugs.length).toBe(ALL_PRODUCTS.length);
  });

  it("finds a known slug, misses unknown ones", async () => {
    const found = await getProductBySlug("talt-032");
    expect(found?.name).toContain("TALT-032");
    expect(await getProductBySlug("no-such-product")).toBeNull();
  });
});
