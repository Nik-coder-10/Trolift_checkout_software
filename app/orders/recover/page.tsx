import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { RecoverForm } from "@/components/orders/RecoverForm";

export const metadata: Metadata = {
  title: "Recover order access",
  description: "Restore access to your Trolift order.",
  robots: { index: false, follow: false },
};

/** Lost-access recovery (order number + mobile, generic failures). */
export default function RecoverPage() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-6 sm:px-6">
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Recover order access" },
        ]}
      />
      <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-zinc-900">
        Recover order access
      </h1>
      <p className="mt-1 text-sm text-zinc-600">
        Lost your order link? Enter the order number and the mobile number
        used for the order and we will restore access on this device.
      </p>
      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-5">
        <RecoverForm />
      </div>
    </div>
  );
}
