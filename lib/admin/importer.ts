import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { AppError } from "@/lib/api/errors";
import { logAdminAudit } from "@/lib/admin/audit";
import { parseRateCsv, type CsvRateRow } from "@/lib/admin/delivery-import";
import {
  PRODUCT_CSV_HEADER,
  parseProductCsv,
  type CsvProductRow,
} from "@/lib/admin/product-import";
import {
  normalizeSlug,
  validateProductInput,
  type ProductFormInput,
} from "@/lib/admin/product-validation";
import { validateRateInput } from "@/lib/admin/delivery-validation";

/**
 * Unified bulk-import pipeline (server-only, admins only).
 *
 *   Upload → Parse → Validate → Preview → Confirm → Atomic import → Report
 *
 * Nothing is written before Confirm, and Confirm re-validates from the
 * raw CSV (a preview is never trusted as proof). Validation gates are
 * all-or-nothing: any invalid row rejects the whole file with per-row
 * errors and zero writes. Valid files apply inside a single database
 * transaction (import_products / import_rates RPCs), so Confirm cannot
 * partially corrupt production data — a mid-apply failure rolls back
 * and is reported + audited as failed.
 *
 * Matching is deterministic and never name-based for identity:
 * products match on slug (the schema's stable unique handle — there
 * is no SKU column), rates on (pincode, partner).
 */

export type ImportDataset = "products" | "rates";

export const IMPORT_DATASETS: ImportDataset[] = ["products", "rates"];

/** Hard caps: keep uploads and applies bounded for the ops scale. */
export const MAX_IMPORT_ROWS = 2000;
export const MAX_CSV_BYTES = 500_000;
const MAX_REPORTED_ERRORS = 50;

export interface ImportRowError {
  line: number;
  message: string;
}

export interface ImportPreview {
  dataset: ImportDataset;
  total: number;
  valid: number;
  creates: number;
  updates: number;
  /** Valid rows not applied (preview never writes). */
  skipped: number;
  invalid: ImportRowError[];
  invalidTotal: number;
}

export interface ImportResult extends ImportPreview {
  inserted: number;
  updated: number;
}

type AdminClient = Awaited<ReturnType<typeof createClient>>;

function checkBudget(csv: string): void {
  if (csv.length > MAX_CSV_BYTES) {
    throw new AppError(
      "BAD_REQUEST",
      `CSV is too large (${MAX_CSV_BYTES / 1000} KB limit).`,
      413,
    );
  }
}

function firstError(errors: Record<string, string | undefined>): string {
  const first = Object.entries(errors)[0];
  return first ? `${first[0]}: ${first[1]}` : "Invalid row.";
}

interface ValidatedProduct {
  line: number;
  input: ProductFormInput;
}

/** Parse + field-validate product rows (pure apart from signature). */
function validateProductRows(rows: CsvProductRow[]): {
  valid: ValidatedProduct[];
  invalid: ImportRowError[];
} {
  const valid: ValidatedProduct[] = [];
  const invalid: ImportRowError[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const slug = normalizeSlug(row.slug);
    if (slug === "") {
      invalid.push({ line: row.line, message: "slug is invalid." });
      continue;
    }
    if (seen.has(slug)) {
      invalid.push({ line: row.line, message: `Duplicate slug in file: ${slug}.` });
      continue;
    }
    seen.add(slug);
    const intOr = (
      raw: string,
      fallback: number,
    ): number | "invalid" => {
      const v = raw.trim();
      if (v === "") return fallback;
      if (!/^\d+$/.test(v)) return "invalid";
      const n = Number(v);
      return Number.isSafeInteger(n) && n <= 1_000_000 ? n : "invalid";
    };
    const stock = intOr(row.stock, 0);
    const threshold = intOr(row.threshold, 5);
    if (stock === "invalid" || threshold === "invalid") {
      invalid.push({
        line: row.line,
        message: "stock/threshold must be blank or a whole number 0–1000000.",
      });
      continue;
    }
    const input: ProductFormInput = {
      name: row.name.trim(),
      slug,
      description: row.description,
      priceRupees: row.priceRupees.trim(),
      category: row.category.trim(),
      images: [],
      specificationsJson: "{}",
      stockQuantity: stock,
      lowStockThreshold: threshold,
      isActive: row.active === "" ? true : row.active === "true",
      gstRate: row.gst.trim(),
      weightKg: row.weight.trim(),
    };
    const { errors, value } = validateProductInput(input);
    if (!value) {
      invalid.push({ line: row.line, message: firstError(errors) });
      continue;
    }
    valid.push({ line: row.line, input });
  }
  return { valid, invalid };
}

interface ValidatedRate {
  line: number;
  pincode: string;
  partnerId: string;
  serviceable: boolean;
  charge: string;
  remoteSurcharge: string;
  minOrder: string;
  maxOrder: string;
  etaMin: number | null;
  etaMax: number | null;
}

/** Resolve partners + field-validate rate rows. */
async function validateRateRows(
  client: AdminClient,
  rows: CsvRateRow[],
): Promise<{ valid: ValidatedRate[]; invalid: ImportRowError[] }> {
  const [{ data: partners, error: partnerError }, { data: stored }] = await Promise.all([
    client
      .from("delivery_partners")
      .select("id,name")
      .limit(1000),
    client
      .from("delivery_pincode_rates")
      .select("pincode,delivery_partner_id,remote_surcharge")
      .limit(100000),
  ]);
  if (partnerError) {
    throw new AppError("INTERNAL_ERROR", "Could not load partners.", 500);
  }
  const byName = new Map(
    ((partners ?? []) as unknown as Array<{ id: string; name: string }>).map(
      (p) => [p.name.toLowerCase(), p.id],
    ),
  );
  // Remote surcharges live outside the CSV: carry stored values through
  // so re-imports never wipe them.
  const storedRemote = new Map(
    ((stored ?? []) as unknown as Array<{
      pincode: string;
      delivery_partner_id: string;
      remote_surcharge: string;
    }>).map((r) => [`${r.pincode}::${r.delivery_partner_id}`, r.remote_surcharge]),
  );

  const valid: ValidatedRate[] = [];
  const invalid: ImportRowError[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const partnerId = byName.get(row.partnerName.toLowerCase());
    if (!partnerId) {
      invalid.push({ line: row.line, message: `Unknown partner: ${row.partnerName}` });
      continue;
    }
    const key = `${row.pincode.trim()}::${partnerId}`;
    if (seen.has(key)) {
      invalid.push({ line: row.line, message: "Duplicate (pincode, partner) in file." });
      continue;
    }
    seen.add(key);
    const { errors, value } = validateRateInput({
      pincode: row.pincode,
      partnerId,
      serviceable: row.serviceable,
      chargeRupees: row.chargeRupees,
      remoteSurchargeRupees: storedRemote.get(key) ?? "",
      minOrderRupees: row.minOrderRupees,
      maxOrderRupees: row.maxOrderRupees,
      etaMinDays: row.etaMinDays,
      etaMaxDays: row.etaMaxDays,
    });
    if (!value) {
      invalid.push({ line: row.line, message: firstError(errors) });
      continue;
    }
    const dec = (paise: number | null): string =>
      paise === null ? "" : (paise / 100).toFixed(2);
    valid.push({
      line: row.line,
      pincode: value.pincode,
      partnerId: value.partnerId,
      serviceable: value.serviceable,
      charge: (value.chargePaise / 100).toFixed(2),
      remoteSurcharge: dec(value.remoteSurchargePaise),
      minOrder: dec(value.minOrderPaise),
      maxOrder: dec(value.maxOrderPaise),
      etaMin: value.etaMinDays,
      etaMax: value.etaMaxDays,
    });
  }
  return { valid, invalid };
}

/** Existing slugs for create/update classification (one narrow query). */
async function existingSlugs(client: AdminClient): Promise<Set<string>> {
  const { data, error } = await client.from("products").select("slug").limit(100000);
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not match existing products.", 500);
  }
  return new Set(
    ((data ?? []) as unknown as Array<{ slug: string }>).map((r) => r.slug),
  );
}

/** Existing (pincode, partner) pairs for create/update classification. */
async function existingPairs(client: AdminClient): Promise<Set<string>> {
  const { data, error } = await client
    .from("delivery_pincode_rates")
    .select("pincode,delivery_partner_id")
    .limit(100000);
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not match existing rates.", 500);
  }
  return new Set(
    ((data ?? []) as unknown as Array<{
      pincode: string;
      delivery_partner_id: string;
    }>).map((r) => `${r.pincode}::${r.delivery_partner_id}`),
  );
}

/**
 * Preview an import: full parse + validation + create/update counts.
 * Reads only — never writes.
 */
export async function previewImport(
  dataset: ImportDataset,
  csv: string,
): Promise<ImportPreview> {
  await requireAdmin();
  checkBudget(csv);
  const client = await createClient();

  if (dataset === "products") {
    const parsed = parseProductCsv(csv);
    if (parsed.rows.length + parsed.errors.length === 0) {
      throw new AppError("BAD_REQUEST", "CSV content is required.", 400);
    }
    if (parsed.rows.length > MAX_IMPORT_ROWS) {
      throw new AppError(
        "BAD_REQUEST",
        `Too many rows (limit ${MAX_IMPORT_ROWS}). Split the file.`,
        413,
      );
    }
    const { valid, invalid } = validateProductRows(parsed.rows);
    const allInvalid = [...parsed.errors, ...invalid];
    const slugs = await existingSlugs(client);
    let creates = 0;
    for (const v of valid) {
      if (slugs.has(v.input.slug)) continue;
      creates++;
    }
    return {
      dataset,
      total: parsed.rows.length + parsed.errors.length,
      valid: valid.length,
      creates,
      updates: valid.length - creates,
      skipped: valid.length,
      invalid: allInvalid.slice(0, MAX_REPORTED_ERRORS),
      invalidTotal: allInvalid.length,
    };
  }

  const parsed = parseRateCsv(csv);
  if (parsed.rows.length + parsed.errors.length === 0) {
    throw new AppError("BAD_REQUEST", "CSV content is required.", 400);
  }
  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    throw new AppError(
      "BAD_REQUEST",
      `Too many rows (limit ${MAX_IMPORT_ROWS}). Split the file.`,
      413,
    );
  }
  const { valid, invalid } = await validateRateRows(client, parsed.rows);
  const allInvalid = [...parsed.errors, ...invalid];
  const pairs = await existingPairs(client);
  let creates = 0;
  for (const v of valid) {
    if (pairs.has(`${v.pincode}::${v.partnerId}`)) continue;
    creates++;
  }
  return {
    dataset,
    total: parsed.rows.length + parsed.errors.length,
    valid: valid.length,
    creates,
    updates: valid.length - creates,
    skipped: valid.length,
    invalid: allInvalid.slice(0, MAX_REPORTED_ERRORS),
    invalidTotal: allInvalid.length,
  };
}

const paiseToDecimal = (paise: number): string => (paise / 100).toFixed(2);

/**
 * Confirm an import: re-parse + re-validate from raw CSV, reject the
 * whole file on any invalid row (zero writes), otherwise apply inside
 * ONE database transaction via the import_* RPCs and audit the result.
 */
export async function confirmImport(
  dataset: ImportDataset,
  csv: string,
  actorUserId: string | null,
): Promise<ImportResult> {
  await requireAdmin();
  checkBudget(csv);
  const client = await createClient();

  // All-or-nothing validation gate: any invalid row rejects the file
  // with per-row errors and ZERO writes (no audit — nothing happened).
  const rejectInvalid = (allInvalid: ImportRowError[]): never => {
    throw new AppError(
      "VALIDATION_ERROR",
      `${allInvalid.length} invalid row(s) — nothing was imported. Fix and retry.`,
      422,
      {
        invalid: allInvalid.slice(0, MAX_REPORTED_ERRORS),
        invalidTotal: allInvalid.length,
      },
    );
  };

  if (dataset === "products") {
    const parsed = parseProductCsv(csv);
    if (parsed.rows.length + parsed.errors.length === 0) {
      throw new AppError("BAD_REQUEST", "CSV content is required.", 400);
    }
    if (parsed.rows.length > MAX_IMPORT_ROWS) {
      throw new AppError("BAD_REQUEST", `Too many rows (limit ${MAX_IMPORT_ROWS}).`, 413);
    }
    const { valid, invalid } = validateProductRows(parsed.rows);
    const allInvalid = [...parsed.errors, ...invalid];
    if (allInvalid.length > 0) {
      rejectInvalid(allInvalid);
    }
    const rpcRows = valid.map((v) => {
      const { errors, value } = validateProductInput(v.input);
      if (!value) {
        throw new AppError("INTERNAL_ERROR", "Row failed re-validation.", 500, errors);
      }
      return {
        name: value.name,
        slug: value.slug,
        description: value.description,
        category: value.category,
        price: paiseToDecimal(value.pricePaise),
        stock_quantity: value.stockQuantity,
        low_stock_threshold: value.lowStockThreshold,
        is_active: value.isActive,
        gst_rate: value.gstRate ?? "",
        weight_kg: value.weightKg ?? "",
      };
    });
    try {
      const { data, error } = await client.rpc("import_products", { p_rows: rpcRows });
      if (error) throw error;
      const result = data as unknown as { inserted: number; updated: number };
      await logAdminAudit({
        actorUserId,
        operation: "import.products.confirm",
        dataset: "products",
        totalRows: valid.length,
        insertedRows: result.inserted,
        updatedRows: result.updated,
        failedRows: 0,
        result: "success",
        summary: { source: "csv-confirm" },
      });
      return {
        dataset,
        total: valid.length,
        valid: valid.length,
        creates: result.inserted,
        updates: result.updated,
        skipped: 0,
        invalid: [],
        invalidTotal: 0,
        inserted: result.inserted,
        updated: result.updated,
      };
    } catch (e) {
      await logAdminAudit({
        actorUserId,
        operation: "import.products.confirm",
        dataset: "products",
        totalRows: valid.length,
        insertedRows: 0,
        updatedRows: 0,
        failedRows: valid.length,
        result: "failed",
        summary: { error: e instanceof Error ? e.message : "unknown" },
      });
      throw new AppError("INTERNAL_ERROR", "Import failed — nothing was committed.", 500);
    }
  }

  const parsed = parseRateCsv(csv);
  if (parsed.rows.length + parsed.errors.length === 0) {
    throw new AppError("BAD_REQUEST", "CSV content is required.", 400);
  }
  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    throw new AppError("BAD_REQUEST", `Too many rows (limit ${MAX_IMPORT_ROWS}).`, 413);
  }
  const { valid, invalid } = await validateRateRows(client, parsed.rows);
  const allInvalid = [...parsed.errors, ...invalid];
  if (allInvalid.length > 0) {
    rejectInvalid(allInvalid);
  }
  const rpcRows = valid.map((v) => ({
    pincode: v.pincode,
    partner_id: v.partnerId,
    serviceable: v.serviceable,
    charge: v.charge,
    remote_surcharge: v.remoteSurcharge,
    min_order: v.minOrder,
    max_order: v.maxOrder,
    eta_min: v.etaMin,
    eta_max: v.etaMax,
  }));
  try {
    const { data, error } = await client.rpc("import_rates", { p_rows: rpcRows });
    if (error) throw error;
    const result = data as unknown as { inserted: number; updated: number };
    await logAdminAudit({
      actorUserId,
      operation: "import.rates.confirm",
      dataset: "rates",
      totalRows: valid.length,
      insertedRows: result.inserted,
      updatedRows: result.updated,
      failedRows: 0,
      result: "success",
      summary: { source: "csv-confirm" },
    });
    return {
      dataset,
      total: valid.length,
      valid: valid.length,
      creates: result.inserted,
      updates: result.updated,
      skipped: 0,
      invalid: [],
      invalidTotal: 0,
      inserted: result.inserted,
      updated: result.updated,
    };
  } catch (e) {
    await logAdminAudit({
      actorUserId,
      operation: "import.rates.confirm",
      dataset: "rates",
      totalRows: valid.length,
      insertedRows: 0,
      updatedRows: 0,
      failedRows: valid.length,
      result: "failed",
      summary: { error: e instanceof Error ? e.message : "unknown" },
    });
    throw new AppError("INTERNAL_ERROR", "Import failed — nothing was committed.", 500);
  }
}

export { PRODUCT_CSV_HEADER };
