import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppError } from "@/lib/api/errors";
import { logWarn } from "@/lib/observability/logger";
import { getBusinessDetails } from "@/lib/invoices/business";
import {
  getBankDetails,
  getDeliveryGstRate,
  getDeliveryLineCopy,
  getDeliverySac,
  getQuotationAbout,
  getQuotationTerms,
  getSignatory,
} from "@/lib/quotations/config";
import { getBusinessStateCode } from "@/lib/tax/india";
import type { QuotationData } from "@/lib/quotations/data";
import {
  buildManualQuotation,
  parseManualQuotationInput,
  type ManualQuotationContext,
  type PartyType,
  type QuotableProduct,
} from "@/lib/quotations/manual";

/**
 * Quotation maker service (server-only).
 *
 * One staff-typed quotation in, one frozen document out:
 *   1. The payload is re-validated server-side (the form's checks are UX
 *      only) — every amount is parsed to integer paise or rejected.
 *   2. A number is claimed from the SAME QTN-TS sequence the order
 *      quotations use, so numbers never collide across both sources.
 *   3. The canonical document is built from the form + server
 *      configuration, and the row is written ONCE with its data. There
 *      is no draft state and no update path: a quotation the customer
 *      received never changes, so reprints are always identical.
 *
 * Reads/writes use the service-role client server-side only; callers
 * (admin routes and pages) own authorization via requireAdmin().
 */

interface ManualQuotationRow {
  id: string;
  quotation_number: string;
  quotation_date: string;
  valid_till: string;
  party_type: string;
  party_name: string;
  party_phone: string | null;
  party_gstin: string | null;
  total_paise: number | string;
  created_at: string;
}

export interface ManualQuotationSummary {
  id: string;
  quotationNumber: string;
  quotationDate: string;
  validTill: string;
  partyType: PartyType;
  partyName: string;
  partyPhone: string | null;
  partyGstin: string | null;
  totalPaise: number;
  createdAt: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** YYYY-MM-DD plus N calendar days (no DST surprises). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function toPaise(value: number | string): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

/**
 * NUMERIC(12,2) rupees → exact integer paise. Catalogue prices arrive
 * as decimal strings (or JSON numbers) of RUPEES, unlike total_paise
 * columns — a plain Number() would read "24999.00" as 24,999 paise.
 */
function rupeesToPaise(value: number | string): number {
  const text = typeof value === "number" ? value.toFixed(2) : value.trim();
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return 0;
  const paise = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(paise) && paise >= 0 ? paise : 0;
}

function asFrozenQuotation(data: unknown): QuotationData | null {
  if (
    typeof data === "object" &&
    data !== null &&
    (data as { version?: unknown }).version === 1 &&
    (data as { kind?: unknown }).kind === "quotation"
  ) {
    return data as QuotationData;
  }
  return null;
}

function toSummary(row: ManualQuotationRow): ManualQuotationSummary {
  const partyType = row.party_type as PartyType;
  return {
    id: row.id,
    quotationNumber: row.quotation_number,
    quotationDate: row.quotation_date.slice(0, 10),
    validTill: row.valid_till.slice(0, 10),
    partyType:
      partyType === "dealer" ||
      partyType === "distributor" ||
      partyType === "customer"
        ? partyType
        : "customer",
    partyName: row.party_name,
    partyPhone: row.party_phone,
    partyGstin: row.party_gstin,
    totalPaise: toPaise(row.total_paise),
    createdAt: row.created_at,
  };
}

export interface CreatedManualQuotation {
  id: string;
  quotationNumber: string;
  totalPaise: number;
}

/**
 * Create a manual quotation. Throws:
 *   VALIDATION_ERROR (422) with per-field details,
 *   INTERNAL_ERROR  (500) when numbering or the write fails.
 */
export async function createManualQuotation(
  payload: unknown,
  actorUserId: string | null,
): Promise<CreatedManualQuotation> {
  const parsed = parseManualQuotationInput(payload);
  if (!parsed.ok) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Some details need fixing before this quotation can be issued.",
      422,
      parsed.errors,
    );
  }
  const input = parsed.value;
  const admin = createAdminClient();

  const business = await getBusinessDetails();

  const { data: numberData, error: numberError } = await admin.rpc(
    "generate_quotation_number",
  );
  if (numberError || typeof numberData !== "string") {
    throw new AppError("INTERNAL_ERROR", "Could not number the quotation.", 500);
  }
  const quotationNumber = numberData;

  const today = new Date().toISOString().slice(0, 10);
  const data = buildManualQuotation(input, {
    quotationNumber,
    quotationDate: today,
    validTill: addDays(today, input.validityDays),
    business,
    bank: getBankDetails(),
    signatory: getSignatory(),
    terms: getQuotationTerms(),
    about: getQuotationAbout(),
    deliveryGstRate: input.withGst ? getDeliveryGstRate() : null,
    deliverySac: getDeliverySac(),
    deliveryLine: getDeliveryLineCopy(),
    businessStateCode: getBusinessStateCode(),
  } satisfies ManualQuotationContext);

  const { data: inserted, error: insertError } = await admin
    .from("manual_quotations")
    .insert({
      quotation_number: quotationNumber,
      quotation_date: today,
      valid_till: data.validTill,
      party_type: input.partyType,
      party_name: input.name,
      party_phone: input.phone,
      party_gstin: input.gstin,
      total_paise: data.totals.grandTotalPaise,
      data,
      created_by: actorUserId,
    })
    .select("id")
    .single();
  const row = inserted as { id: string } | null;
  if (insertError || !row) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Could not save the quotation. Please try again.",
      500,
    );
  }

  return {
    id: row.id,
    quotationNumber,
    totalPaise: data.totals.grandTotalPaise,
  };
}

/** Recent manual quotations, newest first (admin list). */
export async function listManualQuotations(
  limit = 50,
): Promise<ManualQuotationSummary[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("manual_quotations")
    .select(
      "id,quotation_number,quotation_date,valid_till,party_type,party_name," +
        "party_phone,party_gstin,total_paise,created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not load quotations.", 500);
  }
  return ((data ?? []) as unknown as ManualQuotationRow[]).map(toSummary);
}

/**
 * Active catalogue items, for the maker's "pick a listed item" picker.
 *
 * Fails OPEN (empty list): the quotation maker still works with typed
 * items when the catalogue read fails, so a storefront data problem
 * never blocks a dealer quote.
 */
export async function listQuotableProducts(): Promise<QuotableProduct[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("products")
      .select("id,name,description,hsn_code,gst_rate,price")
      .eq("is_active", true)
      .order("name", { ascending: true })
      .limit(500);
    if (error) throw error;
    return ((data ?? []) as unknown as Array<{
      id: string;
      name: string;
      description: string | null;
      hsn_code: string | null;
      gst_rate: string | number | null;
      price: string | number;
    }>).map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      hsn: row.hsn_code,
      gstRate: row.gst_rate === null ? null : String(row.gst_rate),
      pricePaise: rupeesToPaise(row.price),
    }));
  } catch {
    logWarn("Could not load catalogue items for the quotation maker.", {
      category: "quotations",
      operation: "listQuotableProducts",
    });
    return [];
  }
}

export interface LoadedManualQuotation {
  summary: ManualQuotationSummary;
  data: QuotationData;
}

/** One frozen manual quotation (reprint path). 404 for unknown ids. */
export async function getManualQuotation(
  id: string,
): Promise<LoadedManualQuotation> {
  if (!UUID_RE.test(id)) {
    throw new AppError("NOT_FOUND", "Quotation not found.", 404);
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("manual_quotations")
    .select(
      "id,quotation_number,quotation_date,valid_till,party_type,party_name," +
        "party_phone,party_gstin,total_paise,created_at,data",
    )
    .eq("id", id)
    .maybeSingle();
  const row = data as unknown as (ManualQuotationRow & { data: unknown }) | null;
  if (error || !row) {
    throw new AppError("NOT_FOUND", "Quotation not found.", 404);
  }
  const document = asFrozenQuotation(row.data);
  if (!document) {
    throw new AppError("INTERNAL_ERROR", "Could not load the quotation.", 500);
  }
  return { summary: toSummary(row), data: document };
}
