import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));

import {
  fallbackImageSrc,
  isValidImageSrc,
  normalizeImageSrc,
  PRODUCT_IMAGE_PLACEHOLDER,
  resolveProductImage,
} from "@/lib/storage/images";
import { ProductImage } from "@/components/ui/ProductImage";

const REPO = join(__dirname, "..");
const ASSETS_DIR = join(REPO, "public", "images", "products");

/** Display paths referenced by the development seed data. */
function seedImagePaths(): string[] {
  const sql = readFileSync(join(REPO, "supabase", "seed", "seed.sql"), "utf8");
  return [...new Set([...sql.matchAll(/\/images\/products\/[A-Za-z0-9._-]+/g)].map((m) => m[0]))].sort();
}

function repoFile(rel: string): string {
  return readFileSync(join(REPO, rel), "utf8");
}

describe("normalizeImageSrc (malformed src never reaches the browser)", () => {
  it("passes valid local paths and https URLs through, trimmed", () => {
    expect(normalizeImageSrc("/images/products/pallet.jpg")).toBe(
      "/images/products/pallet.jpg",
    );
    expect(normalizeImageSrc("  https://cdn.example/a.webp  ")).toBe(
      "https://cdn.example/a.webp",
    );
  });

  it.each([
    "",
    "   ",
    "notaurl",
    "ftp://x/y.jpg",
    "/images/../secret.jpg",
    "/images/products/a.txt",
    "/images/products/a b.jpg",
    "http://insecure.example/a.jpg",
  ])("falls back to the placeholder for %j", (bad) => {
    expect(normalizeImageSrc(bad)).toBe(PRODUCT_IMAGE_PLACEHOLDER);
  });

  it("handles null/undefined safely", () => {
    expect(normalizeImageSrc(null)).toBe(PRODUCT_IMAGE_PLACEHOLDER);
    expect(normalizeImageSrc(undefined)).toBe(PRODUCT_IMAGE_PLACEHOLDER);
  });

  it("accepts legitimate URLs with query strings or fragments", () => {
    // Signed/optimizer delivery URLs carry parameters after the file name;
    // the extension gate applies to the path, not the parameters.
    const good = [
      "/images/products/pallet.jpg?v=2",
      "https://cdn.example/photo.jpg?token=abc123",
      "https://cdn.example/a.png?Expires=123&Signature=xyz",
      "https://cdn.example/A.WEBP#frag",
      "https://example.supabase.co/storage/v1/object/sign/imgs/a.jpeg?token=eyJhbGciOiJIUzI1NiJ9",
      "  https://cdn.example/spaced.jpg?x=1  ",
    ];
    for (const src of good) {
      expect(isValidImageSrc(src), src).toBe(true);
      expect(normalizeImageSrc(src), src).toBe(src.trim());
      expect(fallbackImageSrc(src), src).toBe(PRODUCT_IMAGE_PLACEHOLDER);
    }
  });

  it("still rejects unsafe schemes and malformed inputs with parameters", () => {
    const bad = [
      "javascript:alert(1)?.jpg",
      "javascript:whatever.jpg",
      "data:image/png;base64,iVBORw0KGgo=",
      "data:text/plain;.jpg",
      "ftp://x/y.jpg?token=abc",
      "http://insecure.example/a.jpg?token=abc",
      "//host/x.jpg?token=abc",
      "https://cdn.example/noext?x=.jpg",
      "https://cdn.example/a.jpg?x=with space",
      "?x=1",
      "#a.jpg",
      "/images/products/a.jpg?x=with space",
    ];
    for (const src of bad) {
      expect(isValidImageSrc(src), src).toBe(false);
      expect(normalizeImageSrc(src), src).toBe(PRODUCT_IMAGE_PLACEHOLDER);
      expect(fallbackImageSrc(src), src).toBeNull();
    }
  });
});

describe("fallbackImageSrc (a failing placeholder cannot loop)", () => {
  it("offers the placeholder for a real src that failed to load", () => {
    expect(fallbackImageSrc("/images/products/missing-1.jpg")).toBe(
      PRODUCT_IMAGE_PLACEHOLDER,
    );
    expect(fallbackImageSrc("https://cdn.example/gone.jpg")).toBe(
      PRODUCT_IMAGE_PLACEHOLDER,
    );
  });

  it("returns null once the placeholder itself is showing — terminally", () => {
    // First error on a real image: swap allowed.
    const first = fallbackImageSrc("/images/products/missing-1.jpg");
    expect(first).toBe(PRODUCT_IMAGE_PLACEHOLDER);

    // Placeholder error: no further swap is possible, at any depth.
    let next: string | null = PRODUCT_IMAGE_PLACEHOLDER;
    for (let i = 0; i < 5; i += 1) {
      next = fallbackImageSrc(next);
      expect(next).toBeNull();
    }
  });

  it("never swaps for a src that would already render the placeholder", () => {
    for (const already of ["", "   ", null, undefined, "notaurl"]) {
      expect(fallbackImageSrc(already)).toBeNull();
    }
  });

  it("is idempotent applied to its own output", () => {
    const once = fallbackImageSrc("/images/products/missing-2.jpg");
    expect(once).toBe(PRODUCT_IMAGE_PLACEHOLDER);
    expect(fallbackImageSrc(once)).toBeNull();
  });

  it("keeps valid images untouched until an error is reported", () => {
    const src = "/images/products/real-photo.jpg";
    expect(normalizeImageSrc(src)).toBe(src);
    expect(fallbackImageSrc(src)).toBe(PRODUCT_IMAGE_PLACEHOLDER);
  });
});

describe("placeholder asset (aspect ratio + real file)", () => {
  it("exists and is a 4:3 SVG matching the product image boxes", () => {
    const svg = readFileSync(join(ASSETS_DIR, "placeholder.svg"), "utf8");
    expect(svg.trimStart().startsWith("<svg")).toBe(true);
    expect(svg).toMatch(/viewBox="0 0 400 300"/);
    // Same 4:3 ratio the card/gallery boxes use with object-cover.
    expect(400 / 300).toBeCloseTo(4 / 3, 5);
  });

  it("contains only real image files (no fabricated/empty assets)", () => {
    for (const name of readdirSync(ASSETS_DIR)) {
      const bytes = readFileSync(join(ASSETS_DIR, name));
      expect(bytes.byteLength).toBeGreaterThan(64);
      const head = bytes.subarray(0, 16);
      const isJpeg = head[0] === 0xff && head[1] === 0xd8;
      const isPng = head.subarray(0, 4).toString("hex") === "89504e47";
      const isWebp = head.subarray(0, 4).toString() === "RIFF";
      const isSvg = head.toString("utf8").trimStart().startsWith("<svg");
      expect(
        isJpeg || isPng || isWebp || isSvg,
        `${name} is not a real image`,
      ).toBe(true);
    }
  });
});

describe("seed image paths (V1 verification: missing assets, not typos)", () => {
  const paths = seedImagePaths();

  it("supplies an images value for every product row (paths arrive with the photo drop)", () => {
    // The live-range catalogue replaces the demo seed before product
    // photos land, so empty arrays are expected today — but the column
    // must stay in the insert and every row must carry a value (either
    // '{}' or at least one path, which the tests below then validate).
    const sql = readFileSync(
      join(REPO, "supabase", "seed", "seed.sql"),
      "utf8",
    );
    const start = sql.indexOf("insert into public.products");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = sql.indexOf(";", start);
    expect(end).toBeGreaterThan(start);
    const block = sql.slice(start, end);
    expect(block).toMatch(/\(\s*id,\s*name,[\s\S]*\bimages\b/);
    const rows = block
      .slice(block.indexOf("values"))
      .split(/^\s*\(\s*$/m)
      .slice(1);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toMatch(/'{}'|\/images\/products\//);
    }
  });

  it("is well-formed for every referenced path (no typos, no traversal)", () => {
    for (const p of paths) {
      expect(isValidImageSrc(p), p).toBe(true);
    }
  });

  it("reports which referenced assets are not shipped yet, and covers them", () => {
    const missing = paths.filter((p) => !existsSync(join(REPO, "public", p)));
    // Asset files are supplied later; until then every missing path must
    // resolve to the placeholder instead of a broken request/icon.
    for (const p of missing) {
      expect(normalizeImageSrc(p)).toBe(p); // still attempted…
      expect(fallbackImageSrc(p)).toBe(PRODUCT_IMAGE_PLACEHOLDER); // …then replaced
    }
    // Present paths render normally.
    for (const p of paths.filter((x) => existsSync(join(REPO, "public", x)))) {
      expect(normalizeImageSrc(p)).toBe(p);
    }
    // Intended assets are never rewritten to the placeholder in data.
    expect(paths).not.toContain(PRODUCT_IMAGE_PLACEHOLDER);
  });

  it("resolves a card image for every seed product, always displayable", () => {
    // resolveProductImage() is what the card/cart snapshot use.
    for (const p of paths) {
      expect(isValidImageSrc(resolveProductImage([p]))).toBe(true);
    }
    expect(resolveProductImage([])).toBe(PRODUCT_IMAGE_PLACEHOLDER);
    expect(resolveProductImage(["", "notaurl"])).toBe(PRODUCT_IMAGE_PLACEHOLDER);
  });
});

describe("render-site contract (fallback cannot be bypassed)", () => {
  const sites = [
    "components/products/ProductCard.tsx",
    "components/products/ProductGallery.tsx",
    "components/cart/CartView.tsx",
    "app/admin/(protected)/products/page.tsx",
    "app/admin/(protected)/products/[id]/page.tsx",
  ];

  it.each(sites)("%s renders products through ProductImage", (rel) => {
    const src = repoFile(rel);
    expect(src).toContain("@/components/ui/ProductImage");
    expect(src).toContain("<ProductImage");
    expect(src).not.toContain('from "next/image"');
  });

  it("keeps object-cover so the placeholder never distorts or shifts layout", () => {
    for (const rel of sites) {
      expect(repoFile(rel), rel).toContain("object-cover");
    }
  });

  it("routes the fallback decision through the shared helper", () => {
    const src = repoFile("components/ui/ProductImage.tsx");
    expect(src).toContain("fallbackImageSrc(current)");
    expect(src).toContain("onError");
    expect(src).toContain("normalizeImageSrc(src)");
  });

  it("renders remote sources unoptimized (unconfigured-host crash guard)", () => {
    // Verified failure: next/image throws during render for a hostname not
    // listed in images.remotePatterns — e.g. a legitimate `https://…`
    // product photo — which took the whole cart page down with it. The
    // loader is skipped entirely when unoptimized is set, so remote srcs
    // must never be sent through it.
    const src = repoFile("components/ui/ProductImage.tsx");
    expect(src).toMatch(/isRemote\s*=\s*\/\^https\?:/);
    expect(src).toContain("unoptimized={isRemote}");
  });

  it("snapshots the resolved card image into the cart input", () => {
    const card = repoFile("components/products/ProductCard.tsx");
    expect(card).toContain("resolveProductImage(product.images)");
    expect(card).toMatch(/image:\s*image,/);
  });

  it("dims and de-links out-of-stock cards behind a diagonal ribbon", () => {
    const card = repoFile("components/products/ProductCard.tsx");
    expect(card).toContain('product.availability === "out_of_stock"');
    // Ribbon: rotated band over the unclickable card.
    expect(card).toContain("rotate-45");
    expect(card).toContain("Out of stock");
    // Un-clickable: no View/Add links in the OOS branch, disabled anchor instead.
    expect(card).toContain('aria-disabled="true"');
    expect(card).toContain("Sold out");
    // The card dims but stays fully rendered (specs/description visible).
    expect(card).toContain("opacity-60");
  });
});

describe("rendered output (static markup — exercises the real component)", () => {
  function render(src: string, alt = ""): string {
    return renderToStaticMarkup(
      createElement(ProductImage, {
        src,
        alt,
        width: 400,
        height: 300,
        className: "object-cover",
      }),
    );
  }

  it("renders the placeholder (no fallback flag) for an unusable src", () => {
    const html = render("notaurl");
    expect(html).toContain("placeholder.svg");
    expect(html).not.toContain("data-fallback");
    expect(html).toContain('alt=""');
  });

  it("passes a valid signed remote src through unoptimized", () => {
    const src = "https://cdn.example/photo.jpg?token=abc123";
    const html = render(src, "Pallet truck");
    // Unoptimized remotes keep their exact URL (query included).
    expect(html).toContain(src);
    expect(html).toContain('alt="Pallet truck"');
    expect(html).not.toContain("data-fallback");
  });

  it("renders a valid local src without the fallback flag", () => {
    const html = render("/images/products/pallet.jpg", "Pallet truck");
    expect(html).not.toContain("data-fallback");
    expect(html).toContain('alt="Pallet truck"');
  });
});
