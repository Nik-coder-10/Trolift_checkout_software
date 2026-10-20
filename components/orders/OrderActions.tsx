"use client";

import { useState } from "react";
import type { PayableOrder } from "@/lib/payments/order";

/**
 * Print + download actions for an order. The download is generated
 * locally from the already-displayed snapshot data — no server call,
 * no new totals. "Get a fresh link" rotates the guest token (old links
 * die) for customers who may have shared their URL.
 */
export function OrderActions({ order }: { order: PayableOrder }) {
  const [rotating, setRotating] = useState(false);
  const [rotated, setRotated] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);

  const download = () => {
    const gstPaise =
      order.tax.cgstPaise + order.tax.sgstPaise + order.tax.igstPaise;
    const lines = [
      `Trolift Solutions — Order ${order.orderNumber}`,
      `Status: ${order.orderStatus} | Payment: ${order.paymentStatus}`,
      "",
      ...order.items.map(
        (i) =>
          `${i.name} x ${i.quantity} — ${(i.lineTotalPaise / 100).toFixed(2)} INR (incl. GST & delivery)`,
      ),
      "",
      `Subtotal${
        order.tax.treatment === "gst" ? " (excl. GST)" : ""
      }: ${(order.subtotalPaise / 100).toFixed(2)} INR`,
      ...(gstPaise > 0
        ? [`GST included: ${(gstPaise / 100).toFixed(2)} INR`]
        : []),
      `Delivery: ${
        order.deliveryChargePaise > 0
          ? `${(order.deliveryChargePaise / 100).toFixed(2)} INR (ODA)`
          : "Included"
      }`,
      `Total: ${(order.totalPaise / 100).toFixed(2)} INR`,
      `Pincode: ${order.deliveryPincode}`,
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${order.orderNumber}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const rotate = async () => {
    setRotating(true);
    setRotateError(null);
    try {
      const res = await fetch(`/api/orders/${order.id}/rotate`, {
        method: "POST",
      });
      if (!res.ok) {
        setRotateError("Could not rotate the link. Please try again.");
        return;
      }
      setRotated(true);
    } catch {
      setRotateError("Could not reach the server. Please try again.");
    } finally {
      setRotating(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex h-10 cursor-pointer items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
      >
        Print order
      </button>
      <button
        type="button"
        onClick={download}
        className="inline-flex h-10 cursor-pointer items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
      >
        Download summary
      </button>
      <button
        type="button"
        onClick={rotate}
        disabled={rotating || rotated}
        className="inline-flex h-10 cursor-pointer items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
      >
        {rotated
          ? "Link refreshed ✓"
          : rotating
            ? "Refreshing…"
            : "Get a fresh link"}
      </button>
      {rotateError ? (
        <p role="alert" className="w-full text-xs text-red-700">
          {rotateError}
        </p>
      ) : null}
      {rotated ? (
        <p role="status" className="w-full text-xs text-green-800">
          Your access link was refreshed. Old shared links no longer work.
        </p>
      ) : null}
    </div>
  );
}
