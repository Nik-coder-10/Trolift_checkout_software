"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import type {
  ProductField,
  ProductFormErrors,
  ProductFormInput,
} from "@/lib/admin/product-validation";
import type { ApiResponse } from "@/types/api";

/**
 * Shared create/edit form. Validates locally for UX, but the API
 * re-validates everything server-side. Images are path entries
 * (validated); uploads arrive with the storage phase.
 */
export function ProductForm({
  initial,
  submitLabel,
  endpoint,
  method,
  redirectBase,
}: {
  initial: ProductFormInput;
  submitLabel: string;
  endpoint: string;
  method: "POST" | "PATCH";
  /** Detail route prefix — the saved product id is appended. */
  redirectBase: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<ProductFormInput>(initial);
  const [errors, setErrors] = useState<ProductFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const set = <K extends keyof ProductFormInput>(field: K, value: ProductFormInput[K]) => {
    setForm((f) => ({ ...f, [field]: value }));
  };
  const setImage = (index: number, value: string) => {
    setForm((f) => ({
      ...f,
      images: f.images.map((s, i) => (i === index ? value : s)),
    }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setServerError(null);
    try {
      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, stockQuantity: Number(form.stockQuantity) }),
      });
      const json = (await res.json()) as ApiResponse<{ id: string }>;
      if (!json.ok) {
        const details = json.error.details as ProductFormErrors | undefined;
        if (json.error.code === "VALIDATION_ERROR" && details && typeof details === "object") {
          const fieldErrors: ProductFormErrors = {};
          for (const key of Object.keys(details) as ProductField[]) {
            const msg = details[key];
            if (typeof msg === "string") fieldErrors[key] = msg;
          }
          setErrors(fieldErrors);
        } else {
          setServerError(json.error.message);
        }
        return;
      }
      router.push(`${redirectBase}/${json.data.id}`);
      router.refresh();
    } catch {
      setServerError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form noValidate onSubmit={submit} className="flex max-w-2xl flex-col gap-4">
      {serverError ? (
        <Alert tone="error" title="Could not save">
          {serverError}
        </Alert>
      ) : null}
      <Input
        label="Name"
        name="name"
        value={form.name}
        onChange={(e) => set("name", e.target.value)}
        error={errors.name}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Slug (unique URL handle)"
          name="slug"
          autoComplete="off"
          value={form.slug}
          onChange={(e) => set("slug", e.target.value)}
          error={errors.slug}
          hint="Lowercase letters, numbers and dashes."
        />
        <Input
          label="Category"
          name="category"
          value={form.category}
          onChange={(e) => set("category", e.target.value)}
          error={errors.category}
        />
      </div>
      <Textarea
        label="Description"
        name="description"
        value={form.description}
        onChange={(e) => set("description", e.target.value)}
        error={errors.description}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Price (₹)"
          name="priceRupees"
          inputMode="decimal"
          placeholder="e.g. 24999.00"
          value={form.priceRupees}
          onChange={(e) => set("priceRupees", e.target.value)}
          error={errors.priceRupees}
          hint="Rupees, max 2 decimals. Stored exactly — never floats."
        />
        <Input
          label="Stock quantity"
          name="stockQuantity"
          type="number"
          min={0}
          value={String(form.stockQuantity)}
          onChange={(e) => set("stockQuantity", Number(e.target.value))}
          error={errors.stockQuantity}
          hint="On-hand units. Manual changes are audit-logged."
        />
        <Input
          label="Low-stock threshold"
          name="lowStockThreshold"
          type="number"
          min={0}
          value={String(form.lowStockThreshold)}
          onChange={(e) => set("lowStockThreshold", Number(e.target.value))}
          error={errors.lowStockThreshold}
          hint="At or below this, the storefront shows “Low stock”."
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="GST rate % (optional)"
          name="gstRate"
          inputMode="decimal"
          placeholder="e.g. 18"
          value={form.gstRate}
          onChange={(e) => set("gstRate", e.target.value)}
          error={errors.gstRate}
          hint="Blank = GST not configured (0% on GST orders). Catalogue prices are GST-exclusive."
        />
        <Input
          label="Shipping weight kg (optional)"
          name="weightKg"
          inputMode="decimal"
          placeholder="e.g. 12.5"
          value={form.weightKg}
          onChange={(e) => set("weightKg", e.target.value)}
          error={errors.weightKg}
          hint="Per-unit weight for freight rules. Blank = unknown (weight slabs skipped)."
        />
        <Input
          label="HSN code (optional)"
          name="hsnCode"
          inputMode="numeric"
          placeholder="e.g. 87168010"
          value={form.hsnCode}
          onChange={(e) => set("hsnCode", e.target.value)}
          error={errors.hsnCode}
          hint="4, 6 or 8 digits. Printed per line on quotations. Blank = blank cell."
        />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold text-zinc-800">
          Images (paths, up to 10)
        </legend>
        {form.images.map((src, i) => (
          <div key={i} className="flex items-center gap-2">
            <label htmlFor={`image-${i}`} className="sr-only">
              Image {i + 1} path
            </label>
            <input
              id={`image-${i}`}
              value={src}
              onChange={(e) => setImage(i, e.target.value)}
              placeholder="/images/products/….jpg or https://…"
              className="h-10 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none placeholder:text-zinc-400 focus:border-brand-700"
            />
            <button
              type="button"
              onClick={() =>
                setForm((f) => ({ ...f, images: f.images.filter((_, j) => j !== i) }))
              }
              aria-label={`Remove image ${i + 1}`}
              className="h-10 shrink-0 cursor-pointer rounded-md border border-zinc-300 px-3 text-sm font-semibold text-red-700 hover:bg-red-50"
            >
              ✕
            </button>
          </div>
        ))}
        <div>
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, images: [...f.images, ""] }))}
            disabled={form.images.length >= 10}
            className="inline-flex h-9 cursor-pointer items-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
          >
            + Add image
          </button>
        </div>
        {errors.images ? (
          <p role="alert" className="text-xs text-red-700">
            {errors.images}
          </p>
        ) : null}
      </fieldset>
      <Textarea
        label="Specifications (JSON object)"
        name="specificationsJson"
        rows={5}
        spellCheck={false}
        placeholder='{"capacity_kg": 2500}'
        value={form.specificationsJson}
        onChange={(e) => set("specificationsJson", e.target.value)}
        error={errors.specificationsJson}
      />
      <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-zinc-800">
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(e) => set("isActive", e.target.checked)}
          className="h-4 w-4 accent-brand-800"
        />
        Active (visible in the customer catalogue)
      </label>
      <div>
        <Button type="submit" loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
