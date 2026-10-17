import type { Metadata } from "next";
import { AdminShell } from "@/components/layout/admin/AdminShell";
import { CouponManager } from "@/components/admin/coupons/CouponManager";
import { listCoupons } from "@/lib/admin/coupons";

export const metadata: Metadata = {
  title: "Redeem codes",
  robots: { index: false, follow: false },
};

/**
 * Redeem-code management: create codes, set rupee discounts and
 * validity windows, and switch them on or off. Checkout validates
 * every code server-side against this list.
 */
export default async function AdminCouponsPage() {
  let coupons = null;
  try {
    coupons = await listCoupons();
  } catch {
    coupons = null;
  }

  return (
    <AdminShell
      title="Redeem codes"
      subtitle="Discounts applied in the checkout order summary"
    >
      {coupons === null ? (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-5">
          <p className="font-bold text-red-800">Couldn&apos;t load redeem codes.</p>
        </div>
      ) : (
        <CouponManager coupons={coupons} />
      )}
    </AdminShell>
  );
}
