"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useCart } from "@/components/cart/CartProvider";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PriceDisplay } from "@/components/ui/PriceDisplay";
import { EmptyState } from "@/components/ui/States";
import { formatMoney } from "@/lib/orders/pricing";
import {
  EMPTY_BILLING_FORM,
  EMPTY_CHECKOUT_FORM,
  validateCheckoutForm,
  type BillingFormData,
  type CheckoutErrors,
  type CheckoutField,
  type CheckoutFormData,
} from "@/lib/checkout/validation";
import { INDIAN_STATES } from "@/lib/tax/india";
import { isValidPincode, normalizePincode } from "@/lib/validations/common";
import type { ApiResponse } from "@/types/api";
import type { DeliveryQuote } from "@/lib/delivery/engine";

type DeliveryState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "ok"; result: DeliveryQuote }
  | { status: "unavailable"; result: DeliveryQuote }
  | { status: "error"; message: string };

function Section({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="rounded-lg border border-zinc-200 bg-white p-5">
      <h2 className="flex items-center gap-2 text-base font-bold text-zinc-900">
        <span
          aria-hidden
          className="flex h-6 w-6 items-center justify-center rounded bg-brand-800 text-xs font-bold text-white"
        >
          {n}
        </span>
        {title}
      </h2>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/**
 * Checkout form: customer + GSTIN + pincode with server-checked
 * delivery, plus an informational summary. Creates nothing — the order
 * API (with server-side repricing) and payment arrive in later phases.
 */
interface PlacedOrder {
  orderId: string;
  orderNumber: string;
  totalPaise: number;
  duplicate: boolean;
}

export function CheckoutForm() {
  const { items, subtotalPaise, clearCart } = useCart();
  const [form, setForm] = useState<CheckoutFormData>(EMPTY_CHECKOUT_FORM);
  const [errors, setErrors] = useState<CheckoutErrors>({});
  const [delivery, setDelivery] = useState<DeliveryState>({ status: "idle" });
  const [reviewed, setReviewed] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  // One key per checkout attempt: retries and double-clicks replay to
  // the same server order instead of duplicating it.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const set = (
    field: keyof Omit<CheckoutFormData, "billing" | "customerType">,
    value: string,
  ) => {
    setForm((f) => ({ ...f, [field]: value }));
    setReviewed(false);
    if (field === "pincode") setDelivery({ status: "idle" });
  };

  const setBilling = (field: keyof BillingFormData, value: string) => {
    setForm((f) => ({
      ...f,
      billing: { ...f.billing, [field]: value },
    }));
    setReviewed(false);
  };

  const setCustomerType = (customerType: "individual" | "business") => {
    setForm((f) => ({
      ...f,
      customerType,
      billing:
        customerType === "business" && f.billing.pincode === ""
          ? { ...EMPTY_BILLING_FORM, pincode: f.pincode }
          : f.billing,
    }));
    setReviewed(false);
    setDelivery({ status: "idle" });
  };

  const focusFirstError = (errs: CheckoutErrors) => {
    const order: CheckoutField[] = [
      "name",
      "phone",
      "email",
      "gstin",
      "billing.name",
      "billing.addressLine",
      "billing.city",
      "billing.stateCode",
      "billing.pincode",
      "pincode",
    ];
    const first = order.find((f) => errs[f]);
    if (first) {
      // Dots are legal in getElementById and match the input ids.
      document.getElementById(first)?.focus();
    }
  };

  const checkDelivery = async () => {
    const pincode = normalizePincode(form.pincode);
    if (!isValidPincode(pincode)) {
      setErrors((e) => ({ ...e, pincode: "Enter a valid 6-digit delivery pincode." }));
      return;
    }
    setErrors((e) => ({ ...e, pincode: undefined }));
    setDelivery({ status: "checking" });
    try {
      // Server decides serviceability, partner and charge from live
      // cart lines (IDs + quantities only) — the browser only
      // displays the verdict.
      const res = await fetch("/api/delivery/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pincode,
          subtotalPaise,
          items: items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
          })),
        }),
      });
      const json = (await res.json()) as ApiResponse<DeliveryQuote>;
      if (!json.ok) {
        if (json.error.code === "VALIDATION_ERROR") {
          setErrors((e) => ({ ...e, pincode: json.error.message }));
          setDelivery({ status: "idle" });
        } else {
          setDelivery({ status: "error", message: json.error.message });
        }
        return;
      }
      setDelivery(
        json.data.serviceable
          ? { status: "ok", result: json.data }
          : { status: "unavailable", result: json.data },
      );
    } catch {
      setDelivery({
        status: "error",
        message: "Could not reach the server. Please try again.",
      });
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = validateCheckoutForm(form, items.length);
    setErrors(result.errors);
    setReviewed(result.valid);
    if (!result.valid) focusFirstError(result.errors);
  };

  const placeOrder = async () => {
    const result = validateCheckoutForm(form, items.length);
    setErrors(result.errors);
    setReviewed(false);
    if (!result.valid) {
      focusFirstError(result.errors);
      return;
    }
    if (delivery.status !== "ok") {
      setPlaceError(
        "Check delivery availability for your pincode before placing the order.",
      );
      return;
    }
    setPlacing(true);
    setPlaceError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
          })),
          customer: {
            name: form.name,
            phone: form.phone,
            email: form.email,
            gstin: form.gstin,
          },
          billing:
            form.customerType === "business"
              ? {
                  name: form.billing.name,
                  addressLine: form.billing.addressLine,
                  city: form.billing.city,
                  stateCode: form.billing.stateCode,
                  pincode: form.billing.pincode,
                }
              : null,
          pincode: form.pincode,
          idempotencyKey,
        }),
      });
      const json = (await res.json()) as ApiResponse<{
        id: string;
        orderNumber: string;
        totalPaise: number;
        duplicate: boolean;
        guestToken: string | null;
      }>;
      if (!json.ok) {
        setPlaceError(json.error.message);
        return;
      }
      // The checkout response already set the HttpOnly guest cookie;
      // belt-and-braces: exchange the one-time token into the cookie so
      // the session survives even if the Set-Cookie was not stored.
      // The raw token lives only in this closure — never localStorage.
      const oneTimeToken = json.data.guestToken;
      if (oneTimeToken) {
        try {
          await fetch(`/api/orders/${json.data.id}/session`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: oneTimeToken }),
          });
        } catch {
          // Cookie from the order response normally suffices.
        }
      }
      setPlaced({
        orderId: json.data.id,
        orderNumber: json.data.orderNumber,
        totalPaise: json.data.totalPaise,
        duplicate: json.data.duplicate,
      });
      clearCart();
    } catch {
      setPlaceError("Could not reach the server. Please try again.");
    } finally {
      setPlacing(false);
    }
  };

  if (placed) {
    return (
      <div role="status" className="rounded-lg border border-green-300 bg-green-50 p-6 text-center">
        <p className="text-sm font-bold tracking-wide text-green-800 uppercase">
          Order placed
        </p>
        <p className="mt-2 text-2xl font-extrabold tracking-tight text-zinc-900">
          {placed.orderNumber}
        </p>
        <p className="mt-2 text-sm text-zinc-600">
          Total{" "}
          {formatMoney({ amountPaise: placed.totalPaise, currency: "INR" })} ·
          payment pending — scan the UPI QR on the next step and submit
          your reference.
        </p>
        <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
          <Link
            href={`/orders/${placed.orderId}/pay`}
            className="inline-flex h-11 items-center justify-center rounded-md bg-brand-800 px-5 text-sm font-bold text-white hover:bg-brand-700"
          >
            Pay Now
          </Link>
          <Link
            href={`/orders/${placed.orderId}`}
            className="inline-flex h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-5 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
          >
            View order
          </Link>
          <Link
            href="/products"
            className="inline-flex h-11 items-center justify-center rounded-md px-5 text-sm font-bold text-brand-700 hover:underline"
          >
            Continue browsing
          </Link>
          <Link
            href="/cart"
            className="inline-flex h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-5 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
          >
            Back to cart
          </Link>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="Your cart is empty"
        message="Add products before checking out."
      />
    );
  }

  // null when no charge is known: either the pincode is unchecked, or
  // it is covered by the list but has no configured rate yet ("to be
  // confirmed") — never render ₹0.00, which would read as free freight.
  const deliveryPaise =
    delivery.status === "ok"
      ? (delivery.result.selected?.deliveryChargePaise ?? null)
      : null;
  const deliveryPending = delivery.status === "ok" && !delivery.result.selected;
  const totalPaise = deliveryPaise !== null ? subtotalPaise + deliveryPaise : null;
  const deliverySummary = deliveryPending ? (
    <span className="text-amber-700">To be confirmed</span>
  ) : delivery.status === "unavailable" ? (
    <span className="text-amber-700">Unavailable</span>
  ) : (
    <span className="text-zinc-400">Check pincode</span>
  );

  return (
    <form noValidate onSubmit={submit} className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <div className="flex min-w-0 flex-col gap-4">
        <Section n="1" title="Customer information">
          <Input
            label="Full name"
            name="name"
            autoComplete="name"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            error={errors.name}
          />
          <Input
            label="Mobile number"
            name="phone"
            autoComplete="tel"
            inputMode="tel"
            placeholder="10-digit mobile"
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            error={errors.phone}
          />
          <Input
            label="Email (optional)"
            name="email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            error={errors.email}
          />
        </Section>

        <Section n="2" title="Customer type & GST">
          <fieldset>
            <legend className="text-sm font-semibold text-zinc-800">
              Who is this order for?
            </legend>
            <div className="mt-2 flex gap-2" role="radiogroup" aria-label="Customer type">
              {(
                [
                  ["individual", "Individual / Non-GST"],
                  ["business", "Business / GST"],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className={`inline-flex h-11 cursor-pointer items-center rounded-md border px-4 text-sm font-semibold ${
                    form.customerType === value
                      ? "border-brand-800 bg-brand-50 text-brand-900"
                      : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="customer-type"
                    value={value}
                    checked={form.customerType === value}
                    onChange={() => setCustomerType(value)}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <Input
            label={form.customerType === "business" ? "GSTIN" : "GSTIN (optional)"}
            name="gstin"
            autoComplete="off"
            placeholder="15-character GSTIN"
            value={form.gstin}
            onChange={(e) => set("gstin", e.target.value)}
            error={errors.gstin}
            hint={
              form.customerType === "business"
                ? "Format-checked only — not government-verified."
                : "GST number is optional. Leave blank if you don't need a GST invoice."
            }
          />
          {form.customerType === "business" ? (
            <div className="flex flex-col gap-4 rounded-md border border-zinc-200 bg-zinc-50 p-4">
              <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                Billing details for the GST invoice
              </p>
              <Input
                label="Legal / business name"
                name="billing.name"
                value={form.billing.name}
                onChange={(e) => setBilling("name", e.target.value)}
                error={errors["billing.name"]}
              />
              <Input
                label="Billing street address"
                name="billing.addressLine"
                value={form.billing.addressLine}
                onChange={(e) => setBilling("addressLine", e.target.value)}
                error={errors["billing.addressLine"]}
              />
              <div className="grid gap-4 sm:grid-cols-3">
                <Input
                  label="City"
                  name="billing.city"
                  value={form.billing.city}
                  onChange={(e) => setBilling("city", e.target.value)}
                  error={errors["billing.city"]}
                />
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="billing.stateCode"
                    className="text-sm font-semibold text-zinc-800"
                  >
                    State
                  </label>
                  <select
                    id="billing.stateCode"
                    name="billing.stateCode"
                    value={form.billing.stateCode}
                    onChange={(e) => setBilling("stateCode", e.target.value)}
                    aria-invalid={errors["billing.stateCode"] ? true : undefined}
                    className={`h-11 w-full rounded-md border bg-white px-2 text-sm outline-none focus:border-brand-700 ${
                      errors["billing.stateCode"] ? "border-red-600" : "border-zinc-300"
                    }`}
                  >
                    <option value="">Select state…</option>
                    {INDIAN_STATES.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  {errors["billing.stateCode"] ? (
                    <p role="alert" className="text-xs text-red-700">
                      {errors["billing.stateCode"]}
                    </p>
                  ) : null}
                </div>
                <Input
                  label="Billing pincode"
                  name="billing.pincode"
                  inputMode="numeric"
                  value={form.billing.pincode}
                  onChange={(e) => setBilling("pincode", e.target.value)}
                  error={errors["billing.pincode"]}
                />
              </div>
            </div>
          ) : null}
        </Section>

        <Section n="3" title="Delivery information">
          <div className="flex flex-col gap-2">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  label="Delivery Pincode"
                  name="pincode"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  placeholder="6-digit pincode"
                  value={form.pincode}
                  onChange={(e) => set("pincode", e.target.value)}
                  error={errors.pincode}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={checkDelivery}
                loading={delivery.status === "checking"}
                className="shrink-0"
              >
                Check Delivery
              </Button>
            </div>
            <div aria-live="polite">
              {delivery.status === "ok" && delivery.result.selected ? (
                <Alert tone="success" title="Delivery available">
                  <p>
                    Partner: <strong>{delivery.result.selected.partner.name}</strong>
                  </p>
                  <p>
                    Delivery:{" "}
                    <strong>
                      {formatMoney({
                        amountPaise: delivery.result.selected.deliveryChargePaise,
                        currency: "INR",
                      })}
                    </strong>
                    {delivery.result.selected.etaDays
                      ? ` · ${delivery.result.selected.etaDays.min}–${delivery.result.selected.etaDays.max} days`
                      : null}
                  </p>
                  {delivery.result.coverage.state ? (
                    <p className="mt-1 text-xs">
                      Serviceable area: {delivery.result.coverage.state}
                    </p>
                  ) : null}
                  {delivery.result.options.length > 1 ? (
                    <p className="mt-1 text-xs">
                      {delivery.result.options.length} partner options — best
                      value selected for this order.
                    </p>
                  ) : null}
                  {delivery.result.totalWeightKg !== null ||
                  delivery.result.appliedRules.length > 0 ? (
                    <p className="mt-1 text-xs">
                      {delivery.result.totalWeightKg !== null
                        ? `Shipment ~${delivery.result.totalWeightKg.toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg`
                        : null}
                      {delivery.result.totalWeightKg !== null &&
                      delivery.result.appliedRules.length > 0
                        ? " · "
                        : null}
                      {delivery.result.appliedRules.length > 0
                        ? delivery.result.appliedRules.join(" + ")
                        : null}
                    </p>
                  ) : null}
                </Alert>
              ) : null}
              {delivery.status === "ok" && !delivery.result.selected ? (
                <Alert
                  tone="warning"
                  title="Delivery available — charge to be confirmed"
                >
                  <p>
                    {delivery.result.reason ??
                      "Our team will confirm the delivery charge for this pincode."}
                  </p>
                  {delivery.result.coverage.state ? (
                    <p className="mt-1 text-xs">
                      Serviceable area: {delivery.result.coverage.state}
                    </p>
                  ) : null}
                </Alert>
              ) : null}
              {delivery.status === "unavailable" ? (
                <Alert tone="warning" title="Delivery unavailable for this pincode.">
                  {delivery.result.reason ??
                    "Our delivery partners do not serve this pincode yet."}
                </Alert>
              ) : null}
              {delivery.status === "error" ? (
                <Alert tone="error" title="Delivery check failed">
                  {delivery.message}
                </Alert>
              ) : null}
            </div>
          </div>
        </Section>
      </div>

      <aside aria-label="Order summary" className="h-fit rounded-lg border border-zinc-200 bg-white p-5 lg:sticky lg:top-20">
        <h2 className="text-base font-bold text-zinc-900">Order summary</h2>
        <ul className="mt-3 flex flex-col gap-2 border-b border-zinc-100 pb-3">
          {items.map((item) => (
            <li key={item.productId} className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-zinc-700">
                {item.name} × {item.quantity}
              </span>
              <span className="shrink-0 font-semibold text-zinc-900">
                ₹{((item.pricePaise * item.quantity) / 100).toLocaleString("en-IN", {
                  minimumFractionDigits: 2,
                })}
              </span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-zinc-600">Items ({items.length})</dt>
            <dd className="font-semibold text-zinc-900">
              <PriceDisplay amountPaise={subtotalPaise} size="sm" />
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-600">Delivery</dt>
            <dd className="font-semibold text-zinc-900">
              {deliveryPaise !== null ? (
                <PriceDisplay amountPaise={deliveryPaise} size="sm" />
              ) : (
                deliverySummary
              )}
            </dd>
          </div>
          <div className="flex justify-between border-t border-zinc-100 pt-2 text-base">
            <dt className="font-bold text-zinc-900">Total</dt>
            <dd className="font-bold text-zinc-900">
              {totalPaise !== null ? (
                <PriceDisplay amountPaise={totalPaise} size="md" />
              ) : (
                <span className="text-zinc-400">—</span>
              )}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-xs leading-5 text-zinc-500">
          Informational only — GST, delivery and the final total are
          confirmed server-side when you place the order.
        </p>
        {form.gstin.trim() !== "" ? (
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            GST invoice requested — tax is calculated from live product
            rates at order time.
          </p>
        ) : null}
        {reviewed ? (
          <Alert tone="success" title="Details look good">
            Your information validates. Place the order when ready — payment
            arrives in the next phase.
          </Alert>
        ) : null}
        {placeError ? (
          <Alert tone="error" title="Could not place the order">
            {placeError}
          </Alert>
        ) : null}
        <div className="mt-4 flex flex-col gap-2">
          <Button type="submit" variant="secondary">
            Review details
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={placeOrder}
            loading={placing}
          >
            Place Order
          </Button>
          <Link
            href="/cart"
            className="inline-flex h-11 items-center justify-center rounded-md px-5 text-sm font-bold text-brand-700 hover:underline"
          >
            Edit cart
          </Link>
        </div>
        {delivery.status === "unavailable" ? (
          <p className="mt-2 text-xs leading-5 text-amber-800">
            Resolve delivery availability before continuing to payment.
          </p>
        ) : null}
      </aside>
    </form>
  );
}
