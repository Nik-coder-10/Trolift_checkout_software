"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import {
  computeManualQuotationTotals,
  emptyManualQuotationForm,
  emptyManualQuotationLine,
  isSameState,
  parseRupeesToPaise,
  type ManualQuotationErrors,
  type ManualQuotationForm,
  type ManualQuotationItem,
} from "@/lib/quotations/manual";
import type { ApiResponse } from "@/types/api";

/**
 * Admin quotation maker.
 *
 * Same document as an order quotation (the server renders the identical
 * PDF), but every price and the delivery charge are typed here for a
 * dealer, distributor or customer. The form validates for UX only — the
 * API re-parses every amount to integer paise and recomputes the totals,
 * so nothing the browser sends as a total is trusted.
 */

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Best-effort parse of the form for the live totals preview. */
function previewItems(form: ManualQuotationForm): ManualQuotationItem[] {
  const items: ManualQuotationItem[] = [];
  for (const row of form.items) {
    const unitPricePaise = parseRupeesToPaise(row.unitPrice);
    const quantity = Number(row.quantity);
    if (unitPricePaise === null || !Number.isInteger(quantity) || quantity < 1) {
      continue;
    }
    const rate = Number(row.gstRate);
    items.push({
      name: row.name,
      description: row.description,
      hsn: row.hsn === "" ? null : row.hsn,
      quantity,
      unitPricePaise,
      gstRate: Number.isFinite(rate) ? String(rate) : "0",
    });
  }
  return items;
}

export function QuotationMaker({
  stateNames,
  deliveryGstRate,
  businessStateCode,
  defaultValidityDays,
}: {
  stateNames: string[];
  /** Delivery GST rate ("18.00"); ignored for non-GST quotes. */
  deliveryGstRate: string;
  /** Seller's GST state code — drives CGST+SGST vs IGST. */
  businessStateCode: string | null;
  defaultValidityDays: number;
}) {
  const router = useRouter();
  const [form, setForm] = useState<ManualQuotationForm>(() => ({
    ...emptyManualQuotationForm(),
    validityDays: String(defaultValidityDays),
  }));
  const [errors, setErrors] = useState<ManualQuotationErrors>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const set = <K extends keyof ManualQuotationForm>(
    field: K,
    value: ManualQuotationForm[K],
  ) => setForm((f) => ({ ...f, [field]: value }));

  const setItem = <K extends keyof ManualQuotationForm["items"][number]>(
    index: number,
    field: K,
    value: string,
  ) =>
    setForm((f) => ({
      ...f,
      items: f.items.map((row, i) =>
        i === index ? { ...row, [field]: value } : row,
      ),
    }));

  const preview = useMemo(() => {
    const items = previewItems(form);
    const deliveryChargePaise = parseRupeesToPaise(form.deliveryCharge) ?? 0;
    return computeManualQuotationTotals({
      items,
      deliveryChargePaise,
      deliveryGstRate: form.withGst ? deliveryGstRate : null,
      sameState: isSameState(form.state === "" ? null : form.state, businessStateCode),
    });
  }, [form, deliveryGstRate, businessStateCode]);

  const sameState = isSameState(
    form.state === "" ? null : form.state,
    businessStateCode,
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setServerError(null);
    setErrors({});
    try {
      const res = await fetch("/api/admin/quotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = (await res.json()) as ApiResponse<{
        id: string;
        quotationNumber: string;
      }>;
      if (!json.ok) {
        const details = json.error.details as ManualQuotationErrors | undefined;
        if (
          json.error.code === "VALIDATION_ERROR" &&
          details &&
          typeof details === "object"
        ) {
          setErrors(details);
          setServerError("Please fix the highlighted fields.");
        } else {
          setServerError(json.error.message);
        }
        return;
      }
      router.push(`/admin/quotations/${json.data.id}`);
      router.refresh();
    } catch {
      setServerError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      {serverError ? (
        <Alert tone="error" title="Could not issue the quotation">
          {serverError}
        </Alert>
      ) : null}

      <section className="rounded-lg border border-zinc-200 bg-white p-4 sm:p-5">
        <h2 className="text-base font-bold text-zinc-900">Party</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Who is this offer for? The PDF is identical for dealers,
          distributors and customers — the type is for your own records.
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <Select
            label="Party type"
            name="partyType"
            value={form.partyType}
            onChange={(e) => set("partyType", e.target.value)}
            error={errors.partyType}
            options={[
              { value: "dealer", label: "Dealer" },
              { value: "distributor", label: "Distributor" },
              { value: "customer", label: "Customer" },
            ]}
          />
          <Input
            label="Name / firm name"
            name="name"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            error={errors.name}
          />
          <Input
            label="Business name (optional)"
            name="businessName"
            value={form.businessName}
            onChange={(e) => set("businessName", e.target.value)}
            error={errors.businessName}
          />
          <Input
            label="Mobile"
            name="phone"
            inputMode="tel"
            autoComplete="off"
            placeholder="98765 43210"
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            error={errors.phone}
          />
          <Input
            label="Email (optional)"
            name="email"
            type="email"
            autoComplete="off"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            error={errors.email}
          />
          <Input
            label="GSTIN (optional)"
            name="gstin"
            autoComplete="off"
            value={form.gstin}
            onChange={(e) => set("gstin", e.target.value.toUpperCase())}
            error={errors.gstin}
            disabled={!form.withGst}
            hint={
              form.withGst
                ? "With a GSTIN the PDF prints the billing address too."
                : "Not available on a non-GST quotation."
            }
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Textarea
            label="Address"
            name="addressLine"
            rows={2}
            value={form.addressLine}
            onChange={(e) => set("addressLine", e.target.value)}
            error={errors.addressLine}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="City"
              name="city"
              value={form.city}
              onChange={(e) => set("city", e.target.value)}
              error={errors.city}
            />
            <Input
              label="Pincode"
              name="pincode"
              inputMode="numeric"
              value={form.pincode}
              onChange={(e) => set("pincode", e.target.value)}
              error={errors.pincode}
            />
            <Select
              label="State (place of supply)"
              name="state"
              value={form.state}
              onChange={(e) => set("state", e.target.value)}
              error={errors.state}
              options={[
                { value: "", label: "Select state…" },
                ...stateNames.map((name) => ({ value: name, label: name })),
              ]}
            />
            <Input
              label="Validity (days)"
              name="validityDays"
              inputMode="numeric"
              value={form.validityDays}
              onChange={(e) => set("validityDays", e.target.value)}
              error={errors.validityDays}
            />
          </div>
        </div>
        <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm font-semibold text-zinc-800">
          <input
            type="checkbox"
            checked={form.withGst}
            onChange={(e) => set("withGst", e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-brand-800"
          />
          <span>
            GST quotation
            <span className="block text-xs font-normal text-zinc-500">
              Untick for a document with no GST and no GSTIN (rate, split and
              delivery tax disappear from the PDF).
            </span>
          </span>
        </label>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-bold text-zinc-900">Items</h2>
          <p className="text-xs text-zinc-500">
            Prices exclude GST — GST is added per line at the rate you enter.
          </p>
        </div>
        {errors.items ? (
          <p role="alert" className="mt-2 text-xs text-red-700">
            {errors.items}
          </p>
        ) : null}
        <div className="mt-3 flex flex-col gap-4">
          {form.items.map((row, index) => (
            <div
              key={index}
              className="rounded-md border border-zinc-200 bg-zinc-50/60 p-3"
            >
              <div className="grid gap-3 sm:grid-cols-12">
                <div className="sm:col-span-6">
                  <Input
                    label={`Item ${index + 1}`}
                    name={`item-${index}-name`}
                    value={row.name}
                    onChange={(e) => setItem(index, "name", e.target.value)}
                    error={errors[`items.${index}.name`]}
                    placeholder="Hydraulic Hand Pallet Truck 2500 kg"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Input
                    label="Qty"
                    name={`item-${index}-qty`}
                    inputMode="numeric"
                    value={row.quantity}
                    onChange={(e) => setItem(index, "quantity", e.target.value)}
                    error={errors[`items.${index}.quantity`]}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Input
                    label="Rate ₹ (ex-GST)"
                    name={`item-${index}-price`}
                    inputMode="decimal"
                    value={row.unitPrice}
                    onChange={(e) => setItem(index, "unitPrice", e.target.value)}
                    error={errors[`items.${index}.unitPrice`]}
                  />
                </div>
                <div className="sm:col-span-1">
                  <Input
                    label="GST %"
                    name={`item-${index}-gst`}
                    inputMode="decimal"
                    value={row.gstRate}
                    onChange={(e) => setItem(index, "gstRate", e.target.value)}
                    error={errors[`items.${index}.gstRate`]}
                    disabled={!form.withGst}
                  />
                </div>
                <div className="flex items-end sm:col-span-1">
                  <button
                    type="button"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        items: f.items.filter((_, i) => i !== index),
                      }))
                    }
                    disabled={form.items.length === 1}
                    aria-label={`Remove item ${index + 1}`}
                    className="h-11 w-full cursor-pointer rounded-md border border-zinc-300 bg-white text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-zinc-400"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-12">
                <div className="sm:col-span-9">
                  <Input
                    label="Description (optional)"
                    name={`item-${index}-desc`}
                    value={row.description}
                    onChange={(e) => setItem(index, "description", e.target.value)}
                    error={errors[`items.${index}.description`]}
                  />
                </div>
                <div className="sm:col-span-3">
                  <Input
                    label="HSN (optional)"
                    name={`item-${index}-hsn`}
                    inputMode="numeric"
                    value={row.hsn}
                    onChange={(e) => setItem(index, "hsn", e.target.value)}
                    error={errors[`items.${index}.hsn`]}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              setForm((f) => ({
                ...f,
                items: [
                  ...f.items,
                  emptyManualQuotationLine(
                    f.items[f.items.length - 1]?.gstRate ?? "18",
                  ),
                ],
              }))
            }
            disabled={form.items.length >= 25}
          >
            + Add item
          </Button>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 sm:p-5">
          <h2 className="text-base font-bold text-zinc-900">Delivery</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Handled by you — leave 0 to print &quot;included in the quoted item
            prices&quot;.
          </p>
          <div className="mt-3">
            <Input
              label="Delivery charge ₹ (ex-GST)"
              name="deliveryCharge"
              inputMode="decimal"
              value={form.deliveryCharge}
              onChange={(e) => set("deliveryCharge", e.target.value)}
              error={errors.deliveryCharge}
              hint={
                form.withGst
                  ? `GST at ${deliveryGstRate}% is added on top.`
                  : "No GST on a non-GST quotation."
              }
            />
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4 sm:p-5">
          <h2 className="text-base font-bold text-zinc-900">Preview</h2>
          <dl className="mt-3 flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-600">Items (ex-GST)</dt>
              <dd className="font-semibold">{rupees(preview.lineTaxablePaise)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-600">Delivery</dt>
              <dd className="font-semibold">{rupees(preview.deliveryPaise)}</dd>
            </div>
            {form.withGst ? (
              sameState ? (
                <>
                  <div className="flex justify-between">
                    <dt className="text-zinc-600">CGST</dt>
                    <dd>{rupees(preview.cgstPaise)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-zinc-600">SGST</dt>
                    <dd>{rupees(preview.sgstPaise)}</dd>
                  </div>
                </>
              ) : (
                <div className="flex justify-between">
                  <dt className="text-zinc-600">IGST</dt>
                  <dd>{rupees(preview.igstPaise)}</dd>
                </div>
              )
            ) : null}
            <div className="mt-1 flex justify-between border-t border-zinc-200 pt-1.5 text-base">
              <dt className="font-bold text-zinc-900">Total</dt>
              <dd className="font-extrabold text-zinc-900">
                {rupees(preview.grandTotalPaise)}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-zinc-500">
            {form.withGst
              ? sameState
                ? "Place of supply is in the seller's state — CGST + SGST."
                : "Place of supply is outside the seller's state — IGST."
              : "Non-GST quotation: no tax is charged or printed."}
          </p>
          <div className="mt-4">
            <Button type="submit" loading={busy}>
              Issue quotation
            </Button>
          </div>
        </div>
      </section>
    </form>
  );
}
