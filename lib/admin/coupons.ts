import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { AppError } from "@/lib/api/errors";
import { COUPON_CODE_RE, normalizeCouponCode } from "@/lib/coupons/code";

/**
 * Admin redeem-code management (server-only, admins only).
 * Validation mirrors the table constraints (uppercase code shape,
 * positive rupee discount, ordered window) so bad input is rejected
 * with a message instead of a database error.
 */

export interface AdminCoupon {
  id: string;
  code: string;
  discountPaise: number;
  firstOrderOnly: boolean;
  isActive: boolean;
  validFrom: string | null;
  validUntil: string | null;
  updatedAt: string;
}

export interface CouponFormInput {
  code: string;
  discountPaise: number;
  firstOrderOnly: boolean;
  isActive: boolean;
  validFrom: string | null;
  validUntil: string | null;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

function parseWindow(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  if (!ISO_RE.test(raw)) {
    throw new AppError("BAD_REQUEST", "Validity dates must be ISO timestamps.", 400);
  }
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    throw new AppError("BAD_REQUEST", "Validity dates must be ISO timestamps.", 400);
  }
  return new Date(parsed).toISOString();
}

export function validateCouponInput(body: unknown): CouponFormInput {
  if (typeof body !== "object" || body === null) {
    throw new AppError("BAD_REQUEST", "Redeem code details are required.", 400);
  }
  const r = body as Record<string, unknown>;
  const code = normalizeCouponCode(r["code"]);
  if (!COUPON_CODE_RE.test(code)) {
    throw new AppError(
      "BAD_REQUEST",
      "Codes are 3–32 letters and digits (A–Z, 0–9).",
      400,
    );
  }
  const rupees = Number(r["discountRupees"] ?? NaN);
  if (!Number.isFinite(rupees) || rupees <= 0) {
    throw new AppError("BAD_REQUEST", "Enter a discount amount above zero.", 400);
  }
  const discountPaise = Math.round(rupees * 100);
  if (!Number.isSafeInteger(discountPaise) || discountPaise <= 0) {
    throw new AppError("BAD_REQUEST", "Enter a discount amount above zero.", 400);
  }
  const validFrom = parseWindow(r["validFrom"]);
  const validUntil = parseWindow(r["validUntil"]);
  if (validFrom !== null && validUntil !== null && validUntil <= validFrom) {
    throw new AppError(
      "BAD_REQUEST",
      "The end of the validity window must come after its start.",
      400,
    );
  }
  return {
    code,
    discountPaise,
    firstOrderOnly: r["firstOrderOnly"] === true,
    isActive: r["isActive"] !== false,
    validFrom,
    validUntil,
  };
}

interface CouponRow {
  id: string;
  code: string;
  discount_paise: string | number;
  first_order_only: boolean;
  active: boolean;
  valid_from: string | null;
  valid_until: string | null;
  updated_at: string;
}

function toAdminCoupon(row: CouponRow): AdminCoupon {
  return {
    id: row.id,
    code: row.code,
    discountPaise: Math.round(Number(row.discount_paise)),
    firstOrderOnly: row.first_order_only,
    isActive: row.active,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    updatedAt: row.updated_at,
  };
}

export async function listCoupons(): Promise<AdminCoupon[]> {
  await requireAdmin();
  const client = await createClient();
  const { data, error } = await client
    .from("coupons")
    .select(
      "id,code,discount_paise,first_order_only,active,valid_from,valid_until,updated_at",
    )
    .order("updated_at", { ascending: false });
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not load redeem codes.", 500);
  }
  return ((data ?? []) as unknown as CouponRow[]).map(toAdminCoupon);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

export async function createCoupon(input: CouponFormInput): Promise<string> {
  await requireAdmin();
  const client = await createClient();
  const { data, error } = await client
    .from("coupons")
    .insert({
      code: input.code,
      discount_paise: input.discountPaise,
      first_order_only: input.firstOrderOnly,
      active: input.isActive,
      valid_from: input.validFrom,
      valid_until: input.validUntil,
    })
    .select("id")
    .single();
  if (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("BAD_REQUEST", "That redeem code already exists.", 400);
    }
    throw new AppError("INTERNAL_ERROR", "Could not create the redeem code.", 500);
  }
  return (data as { id: string }).id;
}

export async function updateCoupon(
  id: string,
  input: CouponFormInput,
): Promise<void> {
  await requireAdmin();
  const client = await createClient();
  const { error } = await client
    .from("coupons")
    .update({
      code: input.code,
      discount_paise: input.discountPaise,
      first_order_only: input.firstOrderOnly,
      active: input.isActive,
      valid_from: input.validFrom,
      valid_until: input.validUntil,
    })
    .eq("id", id);
  if (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("BAD_REQUEST", "That redeem code already exists.", 400);
    }
    throw new AppError("INTERNAL_ERROR", "Could not update the redeem code.", 500);
  }
}
