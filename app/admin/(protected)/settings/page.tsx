import type { Metadata } from "next";
import { AdminShell } from "@/components/layout/admin/AdminShell";
import { SettingsForm } from "@/components/admin/SettingsForm";
import { getEnvDefaults, getSiteSettings } from "@/lib/settings/server";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

/**
 * Store settings: editable overrides over environment defaults (UPI,
 * payment window, invoice prefix, quotation validity, contact, default
 * low-stock threshold). Missing/invalid rows fall back to env, so the
 * page always renders. Registered business identity stays
 * environment-only below — it binds the legal invoice header.
 */
export default async function AdminSettingsPage() {
  const [overrides, defaults] = await Promise.all([
    getSiteSettings(),
    Promise.resolve(getEnvDefaults()),
  ]);
  const env = process.env;
  const identity: Array<[string, string]> = [
    ["Business name", (env.TROLIFT_BUSINESS_NAME ?? "").trim()],
    ["Registered address", (env.TROLIFT_BUSINESS_ADDRESS ?? "").trim()],
    ["GSTIN", (env.TROLIFT_BUSINESS_GSTIN ?? "").trim().toUpperCase()],
    ["Place of supply state code", (env.TROLIFT_STATE_CODE ?? "").trim()],
  ];

  return (
    <AdminShell
      title="Settings"
      subtitle="Store configuration — overrides win over environment defaults"
    >
      <section
        aria-label="Editable settings"
        className="rounded-lg border border-zinc-200 bg-white p-5"
      >
        <h2 className="text-base font-bold text-zinc-900">Store configuration</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Leave a field empty to keep the environment default shown in its
          placeholder. Saved values apply to new invoices, quotations,
          payment instructions and the new-product form — historical
          documents keep their frozen copies.
        </p>
        <div className="mt-4">
          <SettingsForm overrides={overrides} defaults={defaults} />
        </div>
      </section>

      <section
        aria-label="Business identity"
        className="mt-4 rounded-lg border border-zinc-200 bg-white p-5"
      >
        <h2 className="text-base font-bold text-zinc-900">Business identity (read-only)</h2>
        <p className="mt-1 text-sm text-zinc-600">
          The registered identity on every invoice. Set via the deployment
          environment (<code className="font-mono text-xs">.env</code>) —
          changing it requires a redeploy.
        </p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {identity.map(([label, value]) => (
            <div
              key={label}
              className="flex items-baseline justify-between gap-3 rounded-md bg-zinc-50 px-3 py-2"
            >
              <dt className="font-semibold text-zinc-700">{label}</dt>
              <dd className="truncate text-zinc-900">
                {value || <span className="text-zinc-400">not set</span>}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </AdminShell>
  );
}
