"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { canTransitionShipment } from "@/lib/shipments/types";
import type { ShipmentStatus } from "@/lib/shipments/types";
import type { ApiResponse } from "@/types/api";

const NEXT_ACTIONS: Record<ShipmentStatus, Array<{ to: ShipmentStatus; label: string }>> = {
  not_ready: [{ to: "ready", label: "Mark ready" }],
  ready: [{ to: "dispatched", label: "Mark dispatched" }],
  dispatched: [
    { to: "in_transit", label: "Mark in transit" },
    { to: "delivered", label: "Mark delivered" },
  ],
  in_transit: [{ to: "delivered", label: "Mark delivered" }],
  delivered: [],
};

export function ShipmentActions({
  shipmentId,
  currentStatus,
}: {
  shipmentId: string;
  currentStatus: ShipmentStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [targetStatus, setTargetStatus] = useState<ShipmentStatus | null>(null);
  const [trackingRef, setTrackingRef] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");

  const actions = NEXT_ACTIONS[currentStatus] ?? [];

  const runAction = async () => {
    if (!targetStatus) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        action: "status",
        shipmentId,
        toStatus: targetStatus,
      };
      if (trackingRef) body.trackingReference = trackingRef;
      if (expectedDate) body.expectedDeliveryDate = expectedDate;
      if (notes) body.dispatchNotes = notes;
      const res = await fetch(`/api/admin/shipments/${shipmentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!json.ok) {
        setError(json.error.message);
        return;
      }
      setShowModal(false);
      setTargetStatus(null);
      setTrackingRef("");
      setExpectedDate("");
      setNotes("");
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (actions.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        This shipment is in a terminal state. No further actions are available.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <Alert tone="error" title="Action failed">
          {error}
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button
            key={a.to}
            size="sm"
            variant="secondary"
            onClick={() => {
              setTargetStatus(a.to);
              setShowModal(true);
            }}
          >
            {a.label}
          </Button>
        ))}
      </div>
      <Modal
        open={showModal}
        onClose={() => {
          if (!busy) setShowModal(false);
        }}
        title={targetStatus ? `Mark as ${targetStatus.replace(/_/g, " ")}?` : ""}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowModal(false)}
              disabled={busy}
            >
              Back
            </Button>
            <Button size="sm" variant="primary" onClick={runAction} loading={busy}>
              Confirm
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-600">
            This will update the shipment status and synchronize the order lifecycle.
          </p>
          <div>
            <label className="block text-sm font-bold text-zinc-900">
              Tracking reference (optional)
            </label>
            <input
              type="text"
              value={trackingRef}
              onChange={(e) => setTrackingRef(e.target.value)}
              placeholder="e.g. AWB123456789"
              maxLength={60}
              className="mt-1 h-10 w-full rounded-md border border-zinc-300 px-3 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-zinc-900">
              Expected delivery date (optional)
            </label>
            <input
              type="datetime-local"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-zinc-300 px-3 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-zinc-900">
              Dispatch notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={1000}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
