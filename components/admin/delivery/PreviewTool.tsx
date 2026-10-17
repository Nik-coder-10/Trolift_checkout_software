"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PriceDisplay } from "@/components/ui/PriceDisplay";
import { DELIVERY_TIMEFRAME } from "@/lib/delivery/timeframe";
import { formatMoney } from "@/lib/orders/pricing";
import type { ApiResponse } from "@/types/api";

export interface PreviewProduct {
  id: string;
  name: string;
}

interface PreviewItem {
  productId: string;
  quantity: number;
}

interface PreviewResult {
  serviceable: boolean;
  pincode: string;
  coverage?: {
    listed: boolean;
    oda: boolean | null;
    state: string | null;
    deliverable: boolean;
    reason: string | null;
  };
  partner: { id: string; name: string } | null;
  deliveryChargePaise: number | null;
  etaDays?: { min: number; max: number };
  options: Array<{ partner: { id: string; name: string }; deliveryChargePaise: number }>;
  totalWeightKg: number | null;
  freightPaise: number | null;
  remotePaise: number | null;
  handlingPaise: number | null;
  appliedRules: string[];
  subtotalPaise: number | null;
  reason?: string;
}

/**
 * Admin quote preview. Posts to the exact public endpoint customers
 * hit (plus cart lines), so what the admin sees is what checkout
 * computes — one engine, verified in one place. The breakdown names
 * the winning rule without exposing internal rule IDs.
 */
export function PreviewTool({ products }: { products: PreviewProduct[] }) {
  const [pincode, setPincode] = useState("");
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [pickId, setPickId] = useState(products[0]?.id ?? "");
  const [pickQty, setPickQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PreviewResult | null>(null);

  const nameOf = (id: string) =>
    products.find((p) => p.id === id)?.name ?? id;

  const addItem = () => {
    if (!pickId) return;
    const qty = Math.max(1, Math.min(999, Math.floor(Number(pickQty) || 1)));
    setItems((list) => {
      const existing = list.find((i) => i.productId === pickId);
      if (existing) {
        return list.map((i) =>
          i.productId === pickId
            ? { ...i, quantity: Math.min(999, i.quantity + qty) }
            : i,
        );
      }
      return [...list, { productId: pickId, quantity: qty }];
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/delivery/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pincode: pincode.trim(), items }),
      });
      const json = (await res.json()) as ApiResponse<PreviewResult>;
      if (!json.ok) {
        setError(json.error.message);
        setResult(null);
        return;
      }
      setResult(json.data);
    } catch {
      setError("Could not reach the server. Please try again.");
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const selectCls =
    "h-10 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm outline-none focus:border-brand-700";

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-40">
            <Input
              label="Pincode"
              inputMode="numeric"
              maxLength={6}
              placeholder="302001"
              value={pincode}
              onChange={(e) => setPincode(e.target.value)}
            />
          </div>
          <div className="min-w-52 flex-1">
            <label htmlFor="preview-product" className="text-sm font-semibold text-zinc-800">
              Product
            </label>
            <select
              id="preview-product"
              value={pickId}
              onChange={(e) => setPickId(e.target.value)}
              className={selectCls}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="w-24">
            <Input
              label="Qty"
              type="number"
              min={1}
              max={999}
              value={pickQty}
              onChange={(e) => setPickQty(e.target.value)}
            />
          </div>
          <Button type="button" variant="secondary" onClick={addItem}>
            + Add
          </Button>
          <Button type="submit" loading={busy}>
            Check Pincode
          </Button>
        </div>
        {items.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {items.map((i) => (
              <li
                key={i.productId}
                className="inline-flex items-center gap-2 rounded-md bg-zinc-100 px-2.5 py-1.5 text-sm"
              >
                <span>
                  {nameOf(i.productId)} × <strong>{i.quantity}</strong>
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${nameOf(i.productId)}`}
                  onClick={() =>
                    setItems((list) => list.filter((x) => x.productId !== i.productId))
                  }
                  className="cursor-pointer font-bold text-zinc-500 hover:text-red-700"
                >
                  ✕
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => setItems([])}
                className="cursor-pointer rounded-md px-2 py-1 text-sm font-semibold text-zinc-500 hover:text-red-700"
              >
                Clear all
              </button>
            </li>
          </ul>
        ) : (
          <p className="text-xs text-zinc-500">
            No items = pure coverage check (order windows skipped until a
            subtotal is known).
          </p>
        )}
      </form>
      {error ? (
        <Alert tone="error" title="Check failed">
          {error}
        </Alert>
      ) : null}
      <div aria-live="polite">
        {result && result.serviceable && result.partner ? (
          <Alert tone="success" title="Delivery available">
            <p>
              Selected: <strong>{result.partner.name}</strong> ·{" "}
              <strong>
                {formatMoney({ amountPaise: result.deliveryChargePaise ?? 0, currency: "INR" })}
              </strong>
              {` · ETA ${DELIVERY_TIMEFRAME}`}
            </p>
            <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
              {result.subtotalPaise !== null ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-500">Order value</dt>
                  <dd className="font-semibold">
                    {formatMoney({ amountPaise: result.subtotalPaise, currency: "INR" })}
                  </dd>
                </div>
              ) : null}
              {result.totalWeightKg !== null ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-500">Shipment weight</dt>
                  <dd className="font-semibold">
                    {result.totalWeightKg.toLocaleString("en-IN", {
                      maximumFractionDigits: 3,
                    })}{" "}
                    kg
                  </dd>
                </div>
              ) : null}
              {result.freightPaise !== null ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-500">Freight (slab/base)</dt>
                  <dd className="font-semibold">
                    {formatMoney({ amountPaise: result.freightPaise, currency: "INR" })}
                  </dd>
                </div>
              ) : null}
              {(result.remotePaise ?? 0) > 0 ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-500">Remote surcharge</dt>
                  <dd className="font-semibold">
                    +{formatMoney({ amountPaise: result.remotePaise ?? 0, currency: "INR" })}
                  </dd>
                </div>
              ) : null}
              {(result.handlingPaise ?? 0) > 0 ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-500">Category handling</dt>
                  <dd className="font-semibold">
                    +{formatMoney({ amountPaise: result.handlingPaise ?? 0, currency: "INR" })}
                  </dd>
                </div>
              ) : null}
            </dl>
            {result.appliedRules.length > 0 ? (
              <p className="mt-2 text-sm">
                Rules applied: <strong>{result.appliedRules.join(" + ")}</strong>
              </p>
            ) : (
              <p className="mt-2 text-sm text-zinc-500">
                Plain pincode pricing — no weight, remote or handling rules matched.
              </p>
            )}
            {result.options.length > 1 ? (
              <ul className="mt-2 flex flex-col gap-1">
                {result.options.map((o) => (
                  <li key={o.partner.id} className="flex justify-between gap-2 text-sm">
                    <span>{o.partner.name}</span>
                    <PriceDisplay amountPaise={o.deliveryChargePaise} size="sm" />
                  </li>
                ))}
              </ul>
            ) : null}
          </Alert>
        ) : null}
        {result && result.serviceable && !result.partner ? (
          <Alert tone="warning" title="Covered — no rate configured">
            {result.reason ??
              "The pincode is deliverable but no delivery rate is configured for it yet."}
            {result.coverage?.state ? (
              <p className="mt-1 text-xs">Serviceable area: {result.coverage.state}</p>
            ) : null}
          </Alert>
        ) : null}
        {result && !result.serviceable ? (
          <Alert tone="warning" title="Not serviceable">
            {result.reason ?? `No delivery partner serves ${result.pincode}.`}
          </Alert>
        ) : null}
      </div>
    </div>
  );
}
