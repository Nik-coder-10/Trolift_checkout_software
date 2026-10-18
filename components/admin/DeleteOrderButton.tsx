"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { OrderStatusBadge } from "@/components/ui/StatusBadge";
import type { ApiResponse } from "@/types/api";
import type { OrderStatus } from "@/types";

/**
 * Permanently delete an order after an explicit confirmation. Dispatched
 * and delivered orders are protected server-side; this button shows
 * whatever error the API returns (409) inline.
 */
export function DeleteOrderButton({
  orderId,
  orderNumber,
  orderStatus,
  size = "sm",
  redirectTo,
}: {
  orderId: string;
  orderNumber: string;
  orderStatus: OrderStatus;
  size?: "sm" | "md";
  /** Navigate here after a successful delete (used on the detail page). */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!json.ok) {
        setError(json.error.message);
        return;
      }
      setOpen(false);
      if (redirectTo) {
        router.push(redirectTo);
      } else {
        router.refresh();
      }
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <Alert tone="error" title="Delete failed">
          {error}
        </Alert>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Delete order ${orderNumber}`}
        className={`inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border border-red-300 bg-white px-3 font-semibold text-red-700 hover:bg-red-50 ${
          size === "sm" ? "h-9 text-sm" : "h-11 px-5 text-sm"
        }`}
      >
        Delete
      </button>
      <Modal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={`Delete order ${orderNumber}?`}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Back
            </Button>
            <Button size="sm" variant="danger" onClick={run} loading={busy}>
              Delete permanently
            </Button>
          </>
        }
      >
        <p>
          <strong>{orderNumber}</strong> and all of its records — items,
          payment, events, invoice, shipment and stock reservations — will
          be permanently deleted. Held or sold stock is returned to on-hand
          inventory. This cannot be undone.
        </p>
        <p className="mt-2">
          Status: <OrderStatusBadge status={orderStatus} />
        </p>
      </Modal>
    </div>
  );
}
