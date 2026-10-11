import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { AppError } from "@/lib/api/errors";
import {
  paiseToDecimal as rateDecimal,
  validateCategoryRuleInput,
  validatePartnerInput,
  validateRateInput,
  validateSlabInput,
  type CategoryRuleFormInput,
  type PartnerFormInput,
  type RateFormInput,
  type SlabBand,
  type SlabFormInput,
} from "@/lib/admin/delivery-validation";

/**
 * Admin delivery management (server-only, admins only).
 * Partners + pincode rates via the RLS-respecting server client after
 * requireAdmin(). Selection logic stays in lib/delivery/engine.ts —
 * this module never duplicates it.
 */

type AdminClient = Awaited<ReturnType<typeof createClient>>;

export interface AdminPartner {
  id: string;
  name: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  priority: number;
  isActive: boolean;
  rateCount: number;
  createdAt: string;
}

export async function listDeliveryPartners(): Promise<AdminPartner[]> {
  await requireAdmin();
  const client = await createClient();
  const { data, error } = await client
    .from("delivery_partners")
    .select("id,name,contact_name,contact_phone,contact_email,priority,is_active,created_at")
    .order("priority", { ascending: true })
    .order("name", { ascending: true });
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not load delivery partners.", 500);
  }
  const partners = (data ?? []) as unknown as Array<{
    id: string;
    name: string;
    contact_name: string | null;
    contact_phone: string | null;
    contact_email: string | null;
    priority: number;
    is_active: boolean;
    created_at: string;
  }>;
  const { data: rates } = await client
    .from("delivery_pincode_rates")
    .select("delivery_partner_id")
    .limit(100000);
  const counts = new Map<string, number>();
  for (const r of (rates ?? []) as unknown as Array<{ delivery_partner_id: string }>) {
    counts.set(r.delivery_partner_id, (counts.get(r.delivery_partner_id) ?? 0) + 1);
  }
  return partners.map((p) => ({
    id: p.id,
    name: p.name,
    contactName: p.contact_name,
    contactPhone: p.contact_phone,
    contactEmail: p.contact_email,
    priority: p.priority,
    isActive: p.is_active,
    rateCount: counts.get(p.id) ?? 0,
    createdAt: p.created_at,
  }));
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

async function writePartner(
  client: AdminClient,
  input: PartnerFormInput,
  partnerId?: string,
): Promise<string> {
  const { errors, value } = validatePartnerInput(input);
  if (!value) {
    throw new AppError("VALIDATION_ERROR", "Partner details are invalid.", 422, errors);
  }
  const row = {
    name: value.name,
    contact_name: value.contactName,
    contact_phone: value.contactPhone,
    contact_email: value.contactEmail,
    priority: value.priority,
    is_active: value.isActive,
  };
  if (!partnerId) {
    const { data, error } = await client
      .from("delivery_partners")
      .insert(row)
      .select("id")
      .maybeSingle();
    if (error) {
      if (isUniqueViolation(error)) {
        throw new AppError("VALIDATION_ERROR", "A partner with that name exists.", 422);
      }
      throw new AppError("INTERNAL_ERROR", "Could not create the partner.", 500);
    }
    const created = data as unknown as { id: string } | null;
    if (!created) throw new AppError("INTERNAL_ERROR", "Could not create the partner.", 500);
    return created.id;
  }
  const { data, error } = await client
    .from("delivery_partners")
    .update(row)
    .eq("id", partnerId)
    .select("id");
  if (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("VALIDATION_ERROR", "A partner with that name exists.", 422);
    }
    throw new AppError("INTERNAL_ERROR", "Could not update the partner.", 500);
  }
  if (((data ?? []) as unknown as Array<unknown>).length === 0) {
    throw new AppError("NOT_FOUND", "Partner not found.", 404);
  }
  return partnerId;
}

export async function createDeliveryPartner(input: PartnerFormInput): Promise<string> {
  await requireAdmin();
  return writePartner(await createClient(), input);
}

export async function updateDeliveryPartner(
  partnerId: string,
  input: PartnerFormInput,
): Promise<string> {
  await requireAdmin();
  return writePartner(await createClient(), input, partnerId);
}

export async function setPartnerActive(partnerId: string, isActive: boolean): Promise<void> {
  await requireAdmin();
  const client = await createClient();
  const { data, error } = await client
    .from("delivery_partners")
    .update({ is_active: isActive })
    .eq("id", partnerId)
    .select("id");
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not update the partner.", 500);
  }
  if (((data ?? []) as unknown as Array<unknown>).length === 0) {
    throw new AppError("NOT_FOUND", "Partner not found.", 404);
  }
}

// ─── Pincode rates ────────────────────────────────────────────────────

export interface AdminRateRow {
  id: string;
  pincode: string;
  partnerId: string;
  partnerName: string;
  partnerActive: boolean;
  serviceable: boolean;
  chargePaise: number;
  remoteSurchargePaise: number;
  minOrderPaise: number | null;
  maxOrderPaise: number | null;
  etaMinDays: number | null;
  etaMaxDays: number | null;
  createdAt: string;
}

export type AdminRateSort = "pincode" | "newest" | "charge_asc" | "charge_desc";

export interface AdminRateQuery {
  q?: string;
  partnerId?: string;
  serviceable?: boolean;
  sort: AdminRateSort;
  page: number;
  pageSize: number;
}

export const ADMIN_RATE_PAGE_SIZE = 20;

export function parseAdminRateQuery(
  sp: Record<string, string | string[] | undefined>,
): AdminRateQuery {
  const first = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  const q = first(sp["q"]).slice(0, 10);
  const partnerId = first(sp["partner"]);
  const svc = first(sp["serviceable"]);
  const sortRaw = first(sp["sort"]);
  const page = Number(first(sp["page"]));
  return {
    ...(q === "" ? {} : { q }),
    ...(partnerId === "" ? {} : { partnerId }),
    ...(svc === "true"
      ? { serviceable: true as const }
      : svc === "false"
        ? { serviceable: false as const }
        : {}),
    sort:
      sortRaw === "newest" || sortRaw === "charge_asc" || sortRaw === "charge_desc"
        ? sortRaw
        : "pincode",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    pageSize: ADMIN_RATE_PAGE_SIZE,
  };
}

const toPaise = (decimal: string): number => Math.round(Number(decimal) * 100);
const toOptPaise = (decimal: string | null): number | null =>
  decimal === null ? null : Math.round(Number(decimal) * 100);

interface RateDbRow {
  id: string;
  pincode: string;
  delivery_partner_id: string;
  serviceable: boolean;
  delivery_charge: string;
  remote_surcharge: string;
  min_order_amount: string | null;
  max_order_amount: string | null;
  eta_min_days: number | null;
  eta_max_days: number | null;
  created_at: string;
  delivery_partners: { name: string; is_active: boolean } | null;
}

function mapRate(r: RateDbRow): AdminRateRow {
  return {
    id: r.id,
    pincode: r.pincode,
    partnerId: r.delivery_partner_id,
    partnerName: r.delivery_partners?.name ?? "—",
    partnerActive: r.delivery_partners?.is_active ?? false,
    serviceable: r.serviceable,
    chargePaise: toPaise(r.delivery_charge),
    remoteSurchargePaise: toPaise(r.remote_surcharge),
    minOrderPaise: toOptPaise(r.min_order_amount),
    maxOrderPaise: toOptPaise(r.max_order_amount),
    etaMinDays: r.eta_min_days,
    etaMaxDays: r.eta_max_days,
    createdAt: r.created_at,
  };
}

const RATE_COLUMNS =
  "id,pincode,delivery_partner_id,serviceable,delivery_charge,remote_surcharge," +
  "min_order_amount,max_order_amount,eta_min_days,eta_max_days,created_at," +
  "delivery_partners!inner(name,is_active)";

export async function listDeliveryRates(query: AdminRateQuery): Promise<{
  rates: AdminRateRow[];
  total: number;
  page: number;
  totalPages: number;
}> {
  await requireAdmin();
  const client = await createClient();
  let builder = client.from("delivery_pincode_rates").select(RATE_COLUMNS, { count: "exact" });
  if (query.q) {
    builder = builder.ilike("pincode", `%${query.q.replace(/[%_\\]/g, "")}%`);
  }
  if (query.partnerId) builder = builder.eq("delivery_partner_id", query.partnerId);
  if (query.serviceable !== undefined) builder = builder.eq("serviceable", query.serviceable);
  switch (query.sort) {
    case "newest":
      builder = builder.order("created_at", { ascending: false });
      break;
    case "charge_asc":
      builder = builder.order("delivery_charge", { ascending: true });
      break;
    case "charge_desc":
      builder = builder.order("delivery_charge", { ascending: false });
      break;
    case "pincode":
    default:
      builder = builder.order("pincode", { ascending: true });
      builder = builder.order("delivery_charge", { ascending: true });
      break;
  }
  const from = (query.page - 1) * query.pageSize;
  const { data, error, count } = await builder.range(from, from + query.pageSize - 1);
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not load pincode rates.", 500);
  }
  const total = count ?? 0;
  return {
    rates: ((data ?? []) as unknown as RateDbRow[]).map(mapRate),
    total,
    page: query.page,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
  };
}

/** Create or update the (pincode, partner) rule — the pair is unique. */
export async function upsertDeliveryRate(
  input: RateFormInput,
): Promise<{ id: string; created: boolean }> {
  await requireAdmin();
  const { errors, value } = validateRateInput(input);
  if (!value) {
    throw new AppError("VALIDATION_ERROR", "Rate details are invalid.", 422, errors);
  }
  const client = await createClient();
  const { data: partner, error: partnerError } = await client
    .from("delivery_partners")
    .select("id")
    .eq("id", value.partnerId)
    .maybeSingle();
  if (partnerError || !partner) {
    throw new AppError("VALIDATION_ERROR", "Selected partner does not exist.", 422);
  }
  const existing = await client
    .from("delivery_pincode_rates")
    .select("id")
    .eq("pincode", value.pincode)
    .eq("delivery_partner_id", value.partnerId)
    .maybeSingle();
  const row = {
    pincode: value.pincode,
    delivery_partner_id: value.partnerId,
    serviceable: value.serviceable,
    delivery_charge: rateDecimal(value.chargePaise),
    remote_surcharge: rateDecimal(value.remoteSurchargePaise),
    min_order_amount: value.minOrderPaise === null ? null : rateDecimal(value.minOrderPaise),
    max_order_amount: value.maxOrderPaise === null ? null : rateDecimal(value.maxOrderPaise),
    eta_min_days: value.etaMinDays,
    eta_max_days: value.etaMaxDays,
  };
  if (existing.error) {
    throw new AppError("INTERNAL_ERROR", "Could not save the rate.", 500);
  }
  const existingRow = existing.data as unknown as { id: string } | null;
  if (existingRow) {
    const { error } = await client
      .from("delivery_pincode_rates")
      .update(row)
      .eq("id", existingRow.id);
    if (error) {
      throw new AppError("INTERNAL_ERROR", "Could not save the rate.", 500);
    }
    return { id: existingRow.id, created: false };
  }
  const { data, error } = await client
    .from("delivery_pincode_rates")
    .insert(row)
    .select("id")
    .maybeSingle();
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not save the rate.", 500);
  }
  const created = data as unknown as { id: string } | null;
  if (!created) throw new AppError("INTERNAL_ERROR", "Could not save the rate.", 500);
  return { id: created.id, created: true };
}

export async function deleteDeliveryRate(rateId: string): Promise<void> {
  await requireAdmin();
  const client = await createClient();
  const { data, error } = await client
    .from("delivery_pincode_rates")
    .delete()
    .eq("id", rateId)
    .select("id");
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not delete the rate.", 500);
  }
  if (((data ?? []) as unknown as Array<unknown>).length === 0) {
    throw new AppError("NOT_FOUND", "Rate not found.", 404);
  }
}

// ─── Weight slabs ───────────────────────────────────────────────────

export interface AdminWeightSlab {
  id: string;
  partnerId: string;
  partnerName: string;
  minKg: string;
  maxKg: string | null;
  chargePaise: number;
  createdAt: string;
}

export async function listWeightSlabs(): Promise<AdminWeightSlab[]> {
  await requireAdmin();
  const client = await createClient();
  const { data, error } = await client
    .from("delivery_weight_slabs")
    .select(
      "id,delivery_partner_id,min_weight_kg,max_weight_kg,charge,created_at," +
        "delivery_partners!inner(name)",
    )
    .order("min_weight_kg", { ascending: true });
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not load weight slabs.", 500);
  }
  return ((data ?? []) as unknown as Array<{
    id: string;
    delivery_partner_id: string;
    min_weight_kg: string;
    max_weight_kg: string | null;
    charge: string;
    created_at: string;
    delivery_partners: { name: string } | null;
  }>).map((r) => ({
    id: r.id,
    partnerId: r.delivery_partner_id,
    partnerName: r.delivery_partners?.name ?? "—",
    minKg: r.min_weight_kg,
    maxKg: r.max_weight_kg,
    chargePaise: toPaise(r.charge),
    createdAt: r.created_at,
  }));
}

/**
 * Create a weight band. Overlaps are rejected against the partner's
 * live bands (same rule the engine relies on for determinism), so
 * ambiguous configurations are structurally impossible.
 */
export async function createWeightSlab(input: SlabFormInput): Promise<{ id: string }> {
  await requireAdmin();
  const client = await createClient();
  const [{ data: partner, error: partnerError }, { data: siblings, error: siblingError }] =
    await Promise.all([
      client
        .from("delivery_partners")
        .select("id")
        .eq("id", input.partnerId)
        .maybeSingle(),
      client
        .from("delivery_weight_slabs")
        .select("min_weight_kg,max_weight_kg")
        .eq("delivery_partner_id", input.partnerId),
    ]);
  if (partnerError || !partner) {
    throw new AppError("VALIDATION_ERROR", "Selected partner does not exist.", 422);
  }
  if (siblingError) {
    throw new AppError("INTERNAL_ERROR", "Could not check existing bands.", 500);
  }
  const existing: SlabBand[] = ((siblings ?? []) as unknown as Array<{
    min_weight_kg: string;
    max_weight_kg: string | null;
  }>).map((r) => ({
    minKg: Number(r.min_weight_kg),
    maxKg: r.max_weight_kg === null ? null : Number(r.max_weight_kg),
  }));
  const { errors, value } = validateSlabInput(input, existing);
  if (!value) {
    throw new AppError("VALIDATION_ERROR", "Slab details are invalid.", 422, errors);
  }
  const { data, error } = await client
    .from("delivery_weight_slabs")
    .insert({
      delivery_partner_id: value.partnerId,
      min_weight_kg: value.minKg,
      max_weight_kg: value.maxKg,
      charge: rateDecimal(value.chargePaise),
    })
    .select("id")
    .maybeSingle();
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not create the slab.", 500);
  }
  const created = data as unknown as { id: string } | null;
  if (!created) throw new AppError("INTERNAL_ERROR", "Could not create the slab.", 500);
  return { id: created.id };
}

export async function deleteWeightSlab(slabId: string): Promise<void> {
  await requireAdmin();
  const client = await createClient();
  const { data, error } = await client
    .from("delivery_weight_slabs")
    .delete()
    .eq("id", slabId)
    .select("id");
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not delete the slab.", 500);
  }
  if (((data ?? []) as unknown as Array<unknown>).length === 0) {
    throw new AppError("NOT_FOUND", "Slab not found.", 404);
  }
}

/** Id + name catalogue for the quote preview tool (admin view). */
export async function listDeliveryProducts(): Promise<
  Array<{ id: string; name: string }>
> {
  await requireAdmin();
  const client = await createClient();
  const { data, error } = await client
    .from("products")
    .select("id,name")
    .order("name", { ascending: true });
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not load products.", 500);
  }
  return ((data ?? []) as unknown as Array<{ id: string; name: string }>).map(
    (p) => ({ id: p.id, name: p.name }),
  );
}

// ─── Category handling rules ────────────────────────────────────────

export interface AdminCategoryRule {
  id: string;
  category: string;
  surchargePaise: number;
  note: string | null;
  createdAt: string;
}

export async function listCategoryRules(): Promise<AdminCategoryRule[]> {
  await requireAdmin();
  const client = await createClient();
  const { data, error } = await client
    .from("delivery_category_rules")
    .select("id,category,surcharge,note,created_at")
    .order("category", { ascending: true });
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not load category rules.", 500);
  }
  return ((data ?? []) as unknown as Array<{
    id: string;
    category: string;
    surcharge: string;
    note: string | null;
    created_at: string;
  }>).map((r) => ({
    id: r.id,
    category: r.category,
    surchargePaise: toPaise(r.surcharge),
    note: r.note,
    createdAt: r.created_at,
  }));
}

/** One rule per category (UNIQUE) — no ambiguity by construction. */
export async function createCategoryRule(
  input: CategoryRuleFormInput,
): Promise<{ id: string }> {
  await requireAdmin();
  const { errors, value } = validateCategoryRuleInput(input);
  if (!value) {
    throw new AppError("VALIDATION_ERROR", "Rule details are invalid.", 422, errors);
  }
  const client = await createClient();
  const { data, error } = await client
    .from("delivery_category_rules")
    .insert({
      category: value.category,
      surcharge: rateDecimal(value.surchargePaise),
      note: value.note,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(
        "VALIDATION_ERROR",
        "A rule for that category already exists.",
        422,
      );
    }
    throw new AppError("INTERNAL_ERROR", "Could not create the rule.", 500);
  }
  const created = data as unknown as { id: string } | null;
  if (!created) throw new AppError("INTERNAL_ERROR", "Could not create the rule.", 500);
  return { id: created.id };
}

export async function deleteCategoryRule(ruleId: string): Promise<void> {
  await requireAdmin();
  const client = await createClient();
  const { data, error } = await client
    .from("delivery_category_rules")
    .delete()
    .eq("id", ruleId)
    .select("id");
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not delete the rule.", 500);
  }
  if (((data ?? []) as unknown as Array<unknown>).length === 0) {
    throw new AppError("NOT_FOUND", "Rule not found.", 404);
  }
}
