"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ORDER_TRANSITIONS } from "@/lib/orders/transitions";
import type { OrderStatus } from "@/types";
import type { ApiResponse } from "@/types/api";

const LABELS: Record<OrderStatus, string> = {
  draft: "Draft",
  pending_payment: "Pending payment",
  payment_submitted: "Payment submitted",
  paid: "Paid",
  confirmed: "Confirmed",
  processing: "Processing",
  packed: "Packed",
  ready_for_dispatch: "Ready for dispatch",
  shipped: "Shipped",
  dispatched: "Dispatched",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/**
 * Order-status advance: only the transitions legal from the current
 * state are offered, each behind a confirmation dialog. Cancelling a
 * paid order cancels fulfilment only — refunds are a separate,
 * explicitly-labelled step (not implemented yet).
 */
export function StatusActions({
  orderId,
  current,
  hasPacked = false,
  hasReady = false,
}: {
  orderId: string;
  current: OrderStatus;
  /** Derived server-side from the audit trail (never client state). */
  hasPacked?: boolean;
  hasReady?: boolean;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<OrderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = ORDER_TRANSITIONS[current];
  const canPack =
    (current === "confirmed" || current === "processing") && !hasPacked;
  const canReady =
    (current === "confirmed" || current === "processing") &&
    hasPacked &&
    !hasReady;
  const canDispatch =
    current === "ready_for_dispatch" && !hasReady;

  const runStep = async (step: "packed" | "ready_for_dispatch") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/orders/fulfillment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, step }),
      });
      const json = (await res.json()) as ApiResponse<unknown>;
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

  const run = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/orders/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, toStatus: target }),
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!json.ok) {
        setError(json.error.message);
        return;
      }
      setTarget(null);
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (next.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <Alert tone="error" title="Action failed">
          {error}
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {next.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={s === "cancelled" ? "danger" : "secondary"}
            onClick={() => setTarget(s)}
          >
            {s === "cancelled" ? "Cancel order" : `Move to ${LABELS[s]}`}
          </Button>
        ))}
        {canPack ? (
          <Button size="sm" variant="secondary" onClick={() => runStep("packed")}>
            Mark packed
          </Button>
        ) : null}
        {canReady ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => runStep("ready_for_dispatch")}
          >
            Mark ready for dispatch
          </Button>
        ) : null}
      </div>
      <Modal
        open={target !== null}
        onClose={() => {
          if (!busy) setTarget(null);
        }}
        title={target === "cancelled" ? "Cancel this order?" : `Move to ${target ? LABELS[target] : ""}?`}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setTarget(null)} disabled={busy}>
              Back
            </Button>
            <Button
              size="sm"
              variant={target === "cancelled" ? "danger" : "primary"}
              onClick={run}
              loading={busy}
            >
              Confirm
            </Button>
          </>
        }
      >
        <p>
          {target === "cancelled"
            ? "This stops fulfilment. It does not refund money — refunds are handled as a separate step."
            : `This advances the order from ${LABELS[current]}.`}
        </p>
      </Modal>
    </div>
  );
}
