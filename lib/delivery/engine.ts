import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isValidPincode, normalizePincode } from "@/lib/validations/common";
import { AppError } from "@/lib/api/errors";
import {
  lookupDelhiveryPincode,
  type PincodeCoverage,
} from "@/lib/delivery/delhivery-pincodes";

/**
 * Production delivery engine (server-only).
 *
 * One question in, one authoritative answer out: is this pincode
 * serviceable, by whom, for how much. The browser may ask
 * "check this pincode" — it never decides the charge, the partner,
 * the weight or the rules.
 *
 * RULE PRECEDENCE (first match wins, documented for operators):
 *   0. Pincode coverage — the Delhivery pincode list
 *      (lib/delivery/delhivery-pincodes) decides whether the pincode is
 *      deliverable at all: ODA false → deliverable; ODA true, blank or
 *      unlisted → not deliverable, before any rate lookup runs. This is
 *      the one rule that answers without the database.
 *   1. Category handling surcharges — flat per-order additions for
 *      configured product categories (partner-independent, so they
 *      never affect partner choice).
 *   2. Weight slabs — per-partner bands ([min, max) kg, last band may
 *      be open) whose charge REPLACES the pincode base charge when the
 *      whole shipment weighs in-band and every item's weight is known.
 *      Unknown weight anywhere → slabs are skipped, never guessed.
 *   3. Pincode-partner base charge + remote-area surcharge.
 *   4. Selection among qualifying partners: lowest priority number,
 *      then lowest partner total (slab-or-base + remote). Min/max
 *      order windows gate candidacy as before.
 *
 * All money is integer paise; all weights are integer grams (NUMERIC
 * inputs carry at most 3 decimals, so both conversions are exact).
 *
 * COVERAGE vs PRICE: a pincode the list covers still needs a configured
 * rate row to be priced. With no rows at all (or an unreachable
 * database) the quote reports it as deliverable with no selected option
 * and a charge-to-be-confirmed reason. Rows that exist but qualify
 * nothing (serviceable=false, inactive partner, order windows) are the
 * operator's explicit "no" and stay not serviceable.
 */

/** Verdict for a pincode the list covers but no rate row prices yet. */
const UNPRICED_REASON =
  "Delivery is available for this pincode, but the delivery charge isn't configured yet. Please contact us to confirm it.";

/**
 * Customer-facing verdict for an unserviceable pincode. Delivery
 * charges are included in catalogue prices, so the check only answers
 * serviceable-or-not — and points the customer to a nearby pincode
 * when this one is out of reach. Shared by the order API and the
 * /api/delivery/check endpoint so the wording never diverges.
 */
export const NOT_SERVICEABLE_MESSAGE =
  "Please give us a nearby pincode that could be serviceable and please try again.";

export interface DeliveryLineInput {
  productId: string;
  quantity: number;
}

export interface RateOption {
  partnerId: string;
  partnerName: string;
  /** Lower wins. From delivery_partners.priority (default 100). */
  partnerPriority: number;
  /**
   * Integer paise partner total: slab-or-base freight + remote
   * surcharge. Category handling is order-level and added after
   * selection, so it never distorts partner choice.
   */
  deliveryChargePaise: number;
  etaDays?: { min: number; max: number };
  minOrderPaise: number | null;
  maxOrderPaise: number | null;
}

export interface DeliveryPartnerRef {
  id: string;
  name: string;
}

export interface DeliveryQuote {
  pincode: string;
  /** True when the pincode is deliverable (Delhivery list coverage). */
  serviceable: boolean;
  /**
   * Priced option, or null when coverage exists but no rate is
   * configured yet. Orders cannot be placed in that state — the order
   * API requires a selected partner and charge.
   */
  selected: {
    partner: DeliveryPartnerRef;
    deliveryChargePaise: number;
    etaDays?: { min: number; max: number };
  } | null;
  /** All viable options, selection order (price-transparent UI). */
  options: Array<{
    partner: { id: string; name: string };
    deliveryChargePaise: number;
  }>;
  /** Shipment weight in kg (3dp) when lines were supplied. */
  totalWeightKg: number | null;
  /** Winner's slab-or-base freight (paise, excl. remote/handling). */
  freightPaise: number | null;
  /** Winner's remote-area surcharge (paise). */
  remotePaise: number | null;
  /** Order-level category handling total (paise). */
  handlingPaise: number | null;
  /** Human-readable rules that priced this quote (no internal IDs). */
  appliedRules: string[];
  /** Effective subtotal used for order windows (paise). */
  subtotalPaise: number | null;
  /** Delhivery list coverage for this pincode (always present). */
  coverage: PincodeCoverage;
  reason?: string;
}

/** Pure selection — unit-tested, no I/O. */
export function selectDeliveryOption(
  options: RateOption[],
): RateOption | null {
  const viable = options.filter((o) => o.deliveryChargePaise >= 0);
  if (viable.length === 0) return null;
  const [best] = [...viable].sort(
    (a, b) =>
      a.partnerPriority - b.partnerPriority ||
      a.deliveryChargePaise - b.deliveryChargePaise,
  );
  return best ?? null;
}

/** Order-window gate. Skipped when no subtotal is given (see below). */
export function withinOrderWindow(
  option: RateOption,
  subtotalPaise: number,
): boolean {
  if (option.minOrderPaise !== null && subtotalPaise < option.minOrderPaise) {
    return false;
  }
  if (option.maxOrderPaise !== null && subtotalPaise > option.maxOrderPaise) {
    return false;
  }
  return true;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LINE_QTY = 999;

/** NUMERIC(10,3) kg → integer grams (exact, at most 3 decimals). */
export function kgToGrams(kg: string | null): number | null {
  if (kg === null) return null;
  const grams = Math.round(Number(kg) * 1000);
  if (!Number.isSafeInteger(grams) || grams <= 0) return null;
  return grams;
}

/** Integer grams → display kg trimmed of trailing zeros. */
export function formatKg(grams: number): string {
  return `${(grams / 1000).toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg`;
}

interface RateRow {
  delivery_partner_id: string;
  serviceable: boolean;
  delivery_charge: string;
  remote_surcharge: string;
  eta_min_days: number | null;
  eta_max_days: number | null;
  min_order_amount: string | null;
  max_order_amount: string | null;
  delivery_partners: { name: string; is_active: boolean; priority: number } | null;
}

interface SlabRow {
  delivery_partner_id: string;
  min_weight_kg: string;
  max_weight_kg: string | null;
  charge: string;
}

interface CategoryRuleRow {
  category: string;
  surcharge: string;
}

interface ProductWeightRow {
  id: string;
  weight_kg: string | null;
  category: string;
  price: string;
}

const toPaise = (decimal: string): number => Math.round(Number(decimal) * 100);

function validateLines(lines: DeliveryLineInput[]): void {
  for (const line of lines) {
    if (!UUID_RE.test(line.productId)) {
      throw new AppError("VALIDATION_ERROR", "One of the products is invalid.", 422);
    }
    if (
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > MAX_LINE_QTY
    ) {
      throw new AppError(
        "VALIDATION_ERROR",
        `Quantities must be whole numbers from 1 to ${MAX_LINE_QTY}.`,
        422,
      );
    }
  }
}

/**
 * Quote delivery for a pincode. Pass the order subtotal (paise) so
 * min/max order windows apply; omit it for a pure coverage check
 * (windows are then enforced later with the real subtotal). Pass cart
 * lines (IDs + quantities only — weights, categories and prices are
 * always re-fetched live) for weight/category-aware pricing.
 */
export async function quoteDelivery(
  rawPincode: string,
  subtotalPaise?: number,
  lines: DeliveryLineInput[] = [],
): Promise<DeliveryQuote> {
  const pincode = normalizePincode(rawPincode);
  if (!isValidPincode(pincode)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Enter a valid 6-digit delivery pincode.",
      422,
    );
  }
  if (
    subtotalPaise !== undefined &&
    (!Number.isInteger(subtotalPaise) || subtotalPaise < 0)
  ) {
    throw new AppError("VALIDATION_ERROR", "Invalid order subtotal.", 422);
  }
  validateLines(lines);

  // Coverage first (pure, no database): the Delhivery pincode list
  // decides whether the pincode is deliverable at all, so a "no"
  // resolves before any rate lookup and works without Supabase.
  const coverage = lookupDelhiveryPincode(pincode);

  const empty: DeliveryQuote = {
    pincode,
    serviceable: false,
    selected: null,
    options: [],
    totalWeightKg: null,
    freightPaise: null,
    remotePaise: null,
    handlingPaise: null,
    appliedRules: [],
    subtotalPaise: subtotalPaise ?? null,
    coverage,
  };

  if (!coverage.deliverable) {
    return {
      ...empty,
      reason: coverage.reason ?? "Delivery is not available for this pincode.",
    };
  }

  // Indexed pincode lookup (pincode_rates_pincode_idx) — one narrow
  // query, never a table scan — plus the small rule tables. An
  // unconfigured/unreachable database degrades to "coverage yes, charge
  // to be confirmed" instead of failing: coverage is already answered
  // and no money is decided here.
  let supabase: Awaited<ReturnType<typeof createClient>> | null = null;
  try {
    supabase = await createClient();
  } catch {
    return { ...empty, serviceable: true, reason: UNPRICED_REASON };
  }
  const ids = lines.length > 0 ? [...new Set(lines.map((l) => l.productId))] : [];
  const [
    { data: rateData, error: rateError },
    { data: slabData },
    { data: ruleData },
    { data: rawProductData, error: rawProductError },
  ] = await Promise.all([
    supabase
      .from("delivery_pincode_rates")
      .select(
        "delivery_partner_id, serviceable, delivery_charge, remote_surcharge," +
          "eta_min_days, eta_max_days, min_order_amount, max_order_amount," +
          "delivery_partners!inner(name, is_active, priority)",
      )
      .eq("pincode", pincode),
    supabase
      .from("delivery_weight_slabs")
      .select("delivery_partner_id,min_weight_kg,max_weight_kg,charge"),
    supabase
      .from("delivery_category_rules")
      .select("category,surcharge"),
    ids.length > 0
      ? supabase
          .from("products")
          .select("id,weight_kg,category,price")
          .in("id", ids)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (rateError) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Could not check delivery availability. Please try again.",
      500,
    );
  }

  const rows = (rateData ?? []) as unknown as RateRow[];
  if (rows.length === 0) {
    // The list covers this pincode but no rate is configured for it:
    // deliverable, unpriced, and not orderable until a rate exists.
    return { ...empty, serviceable: true, reason: UNPRICED_REASON };
  }
  const slabs = (slabData ?? []) as unknown as SlabRow[];
  const categoryRules = (ruleData ?? []) as unknown as CategoryRuleRow[];

  // Live product facts for the lines (weight, category, price). Client
  // weight/price figures are never accepted — see validateLines: IDs
  // and quantities are the entire client surface.
  let totalGrams = 0;
  let weightKnown = lines.length > 0;
  let derivedSubtotal = 0;
  const lineCategories = new Set<string>();
  if (lines.length > 0) {
    if (rawProductError) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Could not check delivery availability. Please try again.",
        500,
      );
    }
    const byId = new Map(
      ((rawProductData ?? []) as unknown as ProductWeightRow[]).map((p) => [p.id, p]),
    );
    for (const line of lines) {
      const product = byId.get(line.productId);
      if (!product) {
        throw new AppError(
          "VALIDATION_ERROR",
          "One of the products is no longer available.",
          422,
        );
      }
      const grams = kgToGrams(product.weight_kg);
      if (grams === null) {
        weightKnown = false;
      } else {
        totalGrams += grams * line.quantity;
      }
      derivedSubtotal += Math.round(Number(product.price) * 100) * line.quantity;
      lineCategories.add(product.category);
    }
  }
  const effectiveSubtotal =
    lines.length > 0 ? derivedSubtotal : subtotalPaise;

  // Category handling: flat per-order surcharges for configured
  // categories present in the shipment (partner-independent).
  let handlingPaise = 0;
  const handlingRules: string[] = [];
  for (const rule of categoryRules) {
    if (lineCategories.has(rule.category)) {
      const surcharge = toPaise(rule.surcharge);
      if (surcharge > 0) {
        handlingPaise += surcharge;
        handlingRules.push(`${rule.category} handling`);
      }
    }
  }

  const trimKg = (decimal: string): string =>
    String(Number(decimal));
  const slabsFor = (partnerId: string) =>
    slabs
      .filter((s) => s.delivery_partner_id === partnerId)
      .map((s) => ({
        minGrams: Math.round(Number(s.min_weight_kg) * 1000),
        maxGrams:
          s.max_weight_kg === null
            ? null
            : Math.round(Number(s.max_weight_kg) * 1000),
        chargePaise: toPaise(s.charge),
        label: `Weight ${trimKg(s.min_weight_kg)}–${
          s.max_weight_kg === null ? "∞" : trimKg(s.max_weight_kg)
        } kg`,
      }))
      .sort((a, b) => a.minGrams - b.minGrams);

  const candidates: RateOption[] = [];
  const freightByPartner = new Map<string, { freightPaise: number; remotePaise: number; rule: string | null }>();
  for (const r of rows) {
    if (!r.serviceable || !(r.delivery_partners?.is_active ?? false)) continue;
    const basePaise = toPaise(r.delivery_charge);
    const remotePaise = toPaise(r.remote_surcharge ?? "0");
    let freightPaise = basePaise;
    let slabRule: string | null = null;
    if (weightKnown && lines.length > 0) {
      const match = slabsFor(r.delivery_partner_id).find(
        (s) =>
          totalGrams >= s.minGrams &&
          (s.maxGrams === null || totalGrams < s.maxGrams),
      );
      if (match) {
        freightPaise = match.chargePaise;
        slabRule = match.label;
      }
    }
    const candidate: RateOption = {
      partnerId: r.delivery_partner_id,
      partnerName: r.delivery_partners?.name ?? "Delivery partner",
      partnerPriority: r.delivery_partners?.priority ?? 100,
      deliveryChargePaise: freightPaise + remotePaise,
      ...(r.eta_min_days !== null && r.eta_max_days !== null
        ? { etaDays: { min: r.eta_min_days, max: r.eta_max_days } }
        : {}),
      minOrderPaise:
        r.min_order_amount === null ? null : toPaise(r.min_order_amount),
      maxOrderPaise:
        r.max_order_amount === null ? null : toPaise(r.max_order_amount),
    };
    if (effectiveSubtotal === undefined || withinOrderWindow(candidate, effectiveSubtotal)) {
      candidates.push(candidate);
      freightByPartner.set(r.delivery_partner_id, {
        freightPaise,
        remotePaise,
        rule: slabRule,
      });
    }
  }

  if (candidates.length === 0) {
    // Name the binding minimum when one exists — actionable, and still
    // no internal configuration leaks.
    const minima = rows
      .filter((r) => r.serviceable && (r.delivery_partners?.is_active ?? false))
      .map((r) => (r.min_order_amount === null ? null : toPaise(r.min_order_amount)))
      .filter((n): n is number => n !== null);
    const floor = minima.length > 0 ? Math.min(...minima) : null;
    return {
      ...empty,
      totalWeightKg: weightKnown ? totalGrams / 1000 : null,
      subtotalPaise: effectiveSubtotal ?? null,
      reason:
        floor !== null && (effectiveSubtotal ?? 0) < floor
          ? `Minimum order of Rs. ${(floor / 100).toLocaleString("en-IN")} applies for this pincode.`
          : "Our delivery partners do not serve this pincode yet.",
    };
  }

  const selected = selectDeliveryOption(candidates);
  if (!selected) {
    return {
      ...empty,
      totalWeightKg: weightKnown ? totalGrams / 1000 : null,
      subtotalPaise: effectiveSubtotal ?? null,
      reason: "No valid delivery option for this pincode.",
    };
  }

  const won = freightByPartner.get(selected.partnerId) ?? {
    freightPaise: selected.deliveryChargePaise,
    remotePaise: 0,
    rule: null,
  };
  const appliedRules: string[] = [];
  if (won.rule) appliedRules.push(won.rule);
  if (won.remotePaise > 0) appliedRules.push("Remote-area surcharge");
  appliedRules.push(...handlingRules);

  const ordered = [...candidates].sort(
    (a, b) =>
      a.partnerPriority - b.partnerPriority ||
      a.deliveryChargePaise - b.deliveryChargePaise,
  );
  return {
    pincode,
    serviceable: true,
    coverage,
    selected: {
      partner: { id: selected.partnerId, name: selected.partnerName },
      deliveryChargePaise: selected.deliveryChargePaise + handlingPaise,
      ...(selected.etaDays ? { etaDays: selected.etaDays } : {}),
    },
    options: ordered.map((o) => ({
      partner: { id: o.partnerId, name: o.partnerName },
      deliveryChargePaise: o.deliveryChargePaise,
    })),
    totalWeightKg: weightKnown ? totalGrams / 1000 : null,
    freightPaise: won.freightPaise,
    remotePaise: won.remotePaise,
    handlingPaise,
    appliedRules,
    subtotalPaise: effectiveSubtotal ?? null,
  };
}
