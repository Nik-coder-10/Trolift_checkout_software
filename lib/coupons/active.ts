import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

export interface ActiveOffer {
  code: string;
  discountPaise: number;
  firstOrderOnly: boolean;
  label: string;
}

function offerLabel(code: string): string {
  if (code.includes("DUSSHERA")) return "Dussehra Offer";
  if (code.includes("DIWALI")) return "Early Diwali";
  if (code.includes("NAVRATRI")) return "Navratri Offer";
  if (code.startsWith("FIRST")) return "First order offer";
  return "Limited offer";
}

async function fetchActiveOffers(): Promise<ActiveOffer[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("coupons")
      .select("code, discount_paise, first_order_only, valid_from, valid_until")
      .eq("active", true)
      .order("created_at", { ascending: true })
      .limit(6);
    if (error || !data) return [];
    const now = Date.now();
    const offers: ActiveOffer[] = [];
    for (const row of data) {
      if (row.valid_from !== null && now < Date.parse(row.valid_from)) continue;
      if (row.valid_until !== null && now >= Date.parse(row.valid_until)) continue;
      offers.push({
        code: row.code,
        discountPaise: Number(row.discount_paise),
        firstOrderOnly: row.first_order_only,
        label: offerLabel(row.code),
      });
    }
    return offers;
  } catch {
    return [];
  }
}

export const getActiveOffers = unstable_cache(
  fetchActiveOffers,
  ["active-coupon-offers"],
  { revalidate: 60, tags: ["coupons"] },
);
