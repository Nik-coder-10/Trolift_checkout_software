import "server-only";
import { AppError } from "@/lib/api/errors";
import { COUPON_CODE_RE, normalizeCouponCode } from "@/lib/coupons/code";
import { createAdminClient } from "@/lib/supabase/admin";

export { COUPON_CODE_RE, normalizeCouponCode } from "@/lib/coupons/code";

/**
 * Redeem-code resolution (server-only, unit-tested).
 *
 * Both entry points — POST /api/coupons/validate (checkout preview)
 * and POST /api/orders (money) — call this one function, so the rules
 * that show a green tick can never disagree with the rules that move
 * rupees. Codes are looked up with the service role: the coupons table
 * grants nothing to anon, so codes are never enumerable.
 */

export interface ResolvedCoupon {
  code: string;
  discountPaise: number;
  firstOrderOnly: boolean;
}

function fail(message: string): never {
  throw new AppError("VALIDATION_ERROR", message, 422);
}

function internal(message: string): never {
  throw new AppError("INTERNAL_ERROR", message, 500);
}

export async function resolveCoupon(input: {
  code: string;
  /** Normalized E.164 mobile, or null when the buyer typed none yet. */
  phone: string | null;
  /**
   * Inclusive order total in paise. When given, the discount must
   * leave at least one paise — a free order would violate the
   * payments.amount > 0 contract.
   */
  totalPaise?: number;
}): Promise<ResolvedCoupon> {
  const code = normalizeCouponCode(input.code);
  if (!COUPON_CODE_RE.test(code)) {
    fail("Enter a valid redeem code.");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("coupons")
    .select("code, discount_paise, first_order_only, active, valid_from, valid_until")
    .eq("code", code)
    .maybeSingle();
  if (error) {
    internal("Could not check this redeem code. Please try again.");
  }
  const row = data as {
    code: string;
    discount_paise: number | string;
    first_order_only: boolean;
    active: boolean;
    valid_from: string | null;
    valid_until: string | null;
  } | null;
  if (!row || !row.active) {
    fail("This redeem code is not valid.");
  }

  const now = Date.now();
  if (row.valid_from !== null && now < Date.parse(row.valid_from)) {
    fail("This redeem code is not active yet.");
  }
  if (row.valid_until !== null && now >= Date.parse(row.valid_until)) {
    fail("This redeem code has expired.");
  }

  if (row.first_order_only) {
    if (input.phone === null) {
      fail("Enter your mobile number to use this code.");
    }
    const prior = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("customer_phone_snapshot", input.phone);
    if (prior.error) {
      internal("Could not verify this redeem code. Please try again.");
    }
    if ((prior.count ?? 0) > 0) {
      fail("This code is only for first-time buyers.");
    }
  }

  const discountPaise = Number(row.discount_paise);
  if (input.totalPaise !== undefined && discountPaise >= input.totalPaise) {
    fail("Add more items to this order to use this code.");
  }

  return { code: row.code, discountPaise, firstOrderOnly: row.first_order_only };
}
