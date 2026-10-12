import { parseCsvTable } from "@/lib/admin/csv";

/**
 * Product CSV parsing (pure, unit-tested).
 *
 * Columns (exact header, current format):
 *   name,slug,description,category,price,stock,threshold,active,gst,weight,hsn
 * The previous 10-column header (without hsn) is still accepted for
 * backward compatibility; those rows import with a blank HSN. Anything
 * else is rejected naming the current header.
 * Only name, slug and price are required; everything else falls back
 * to the same defaults as the admin form (stock 0, threshold 5,
 * active true, blank gst/weight/hsn). images and specifications are NOT
 * importable — they stay form-managed (documented, not silent: the
 * sample CSV and UI say so).
 *
 * Matching is deterministic on slug (the schema's stable unique
 * handle — there is no SKU column, and none is invented here):
 * existing slugs update in place, new slugs insert. Slugs are
 * normalized exactly like the product form before matching.
 *
 * Nothing is written here — callers validate every row first and
 * report per-row errors without committing anything.
 */

export const PRODUCT_CSV_HEADER = [
  "name",
  "slug",
  "description",
  "category",
  "price",
  "stock",
  "threshold",
  "active",
  "gst",
  "weight",
];

/** Current import header: legacy columns plus trailing HSN. */
export const PRODUCT_CSV_HEADER_V2 = [...PRODUCT_CSV_HEADER, "hsn"];

export interface CsvProductRow {
  line: number;
  name: string;
  slug: string;
  description: string;
  category: string;
  priceRupees: string;
  stock: string;
  threshold: string;
  active: string;
  gst: string;
  weight: string;
  hsn: string;
}

export interface CsvProductParseResult {
  rows: CsvProductRow[];
  errors: Array<{ line: number; message: string }>;
}

const ACTIVE_RE = /^(true|false)$/i;

function isHeaderMismatch(errors: Array<{ line: number; message: string }>): boolean {
  return errors.some((e) => e.message.startsWith("Header must be:"));
}

export function parseProductCsv(text: string): CsvProductParseResult {
  const errors: Array<{ line: number; message: string }> = [];
  const rows: CsvProductRow[] = [];
  // Current format first; legacy 10-column files (no hsn) fall back to
  // the old header with a blank HSN rather than failing. A file matching
  // neither header reports the CURRENT header (never a stale one).
  let table = parseCsvTable(text, PRODUCT_CSV_HEADER_V2);
  if (isHeaderMismatch(table.errors)) {
    const legacy = parseCsvTable(text, PRODUCT_CSV_HEADER);
    if (!isHeaderMismatch(legacy.errors)) {
      table = legacy;
    }
  }
  errors.push(...table.errors);
  for (const row of table.rows) {
    const [
      name, slug, description, category, priceRupees,
      stock, threshold, active, gst, weight, hsn,
    ] = row.cells;
    if ((name ?? "") === "") {
      errors.push({ line: row.line, message: "name is required." });
      continue;
    }
    if ((slug ?? "") === "") {
      errors.push({ line: row.line, message: "slug is required." });
      continue;
    }
    if ((priceRupees ?? "") === "") {
      errors.push({ line: row.line, message: "price is required." });
      continue;
    }
    const act = (active ?? "").toLowerCase();
    if (act !== "" && !ACTIVE_RE.test(act)) {
      errors.push({ line: row.line, message: "active must be true, false or blank." });
      continue;
    }
    rows.push({
      line: row.line,
      name: name ?? "",
      slug: slug ?? "",
      description: description ?? "",
      category: category ?? "",
      priceRupees: priceRupees ?? "",
      stock: stock ?? "",
      threshold: threshold ?? "",
      // Normalized to "" | "true" | "false" for the boolean step below.
      active: act,
      gst: gst ?? "",
      weight: weight ?? "",
      // Legacy 10-column rows have no 11th cell: blank HSN, never garbage.
      hsn: hsn ?? "",
    });
  }
  return { rows, errors };
}
