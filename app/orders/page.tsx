import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { MyOrdersForm } from "@/components/orders/MyOrdersForm";

export const metadata: Metadata = {
  title: "My orders",
  description: "View your Trolift orders, payment status and quotations.",
  robots: { index: false, follow: false },
};

/** Order history lookup by mobile number (rate-limited, phone-only). */
export default function MyOrdersPage() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-6 sm:px-6">
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "My orders" },
        ]}
      />
      <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-zinc-900">
        My orders
      </h1>
      <p className="mt-1 text-sm text-zinc-600">
        Enter the mobile number used at checkout to see your orders — track
        delivery, complete payment, and download quotations and invoices.
      </p>
      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-5">
        <MyOrdersForm />
      </div>
    </div>
  );
}
