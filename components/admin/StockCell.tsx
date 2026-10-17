"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  ADMIN_STOCK_TIER_LABELS,
  adminStockTier,
  type AdminStockTier,
} from "@/lib/inventory/availability";
import type { ApiResponse } from "@/types/api";

const TIER_TONES: Record<AdminStockTier, "danger" | "orange" | "warning" | "neutral"> = {
  out: "danger",
  critical: "danger",
  few: "orange",
  warning: "warning",
  ok: "neutral",
};

/**
 * Inline stock editor for the admin list: reserve-aware count + tier
 * badge, and an absolute-value input (same validation and audit event
 * as the product edit form). Save is explicit — no writes per keystroke.
 */
export function StockCell({
  productId,
  productName,
  stockQuantity,
  available,
  lowStockThreshold,
}: {
  productId: string;
  productName: string;
  stockQuantity: number;
  available: number;
  lowStockThreshold: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState(String(stockQuantity));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tier = adminStockTier(available, lowStockThreshold);
  const label = ADMIN_STOCK_TIER_LABELS[tier];

  const save = async () => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
      setError("Enter a whole number from 0 to 1000000.");
      return;
    }
    if (n === stockQuantity) {
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/products/${productId}/stock`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stockQuantity: n }),
      });
      const json = (await res.json()) as ApiResponse<{ stockQuantity: number }>;
      if (!json.ok) {
        setError(json.error.message);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-semibold text-zinc-900">{available}</span>
      <span className="text-zinc-400"> / {stockQuantity}</span>
      {tier !== "ok" ? <Badge tone={TIER_TONES[tier]}>{label}</Badge> : null}
      <label htmlFor={`stock-${productId}`} className="sr-only">
        New stock quantity for {productName}
      </label>
      <input
        id={`stock-${productId}`}
        type="number"
        min={0}
        max={1000000}
        step={1}
        value={value}
        onChange={(e) => {
          setError(null);
          setValue(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
        }}
        className="h-8 w-20 rounded-md border border-zinc-300 bg-white px-2 text-sm outline-none focus:border-brand-700"
      />
      <Button size="sm" variant="secondary" onClick={() => void save()} loading={busy}>
        Save
      </Button>
      {error ? (
        <span role="alert" className="w-full text-xs font-semibold text-red-600">
          {error}
        </span>
      ) : null}
    </div>
  );
}
