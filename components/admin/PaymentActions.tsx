"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { ApiResponse } from "@/types/api";

/**
 * Payment verify/reject with explicit confirmation. Mutations go to
 * the admin API (server-authorized, transition-guarded); this UI only
 * collects intent + an optional note.
 */
export function PaymentActions({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!mode) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/payments/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, decision: mode, note }),
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!json.ok) {
        setError(json.error.message);
        return;
      }
      setMode(null);
      setNote("");
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <Alert tone="error" title="Action failed">
          {error}
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setMode("approve")}>
          Mark paid
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setMode("reject")}>
          Reject claim
        </Button>
      </div>
      <Modal
        open={mode !== null}
        onClose={() => {
          if (!busy) {
            setMode(null);
            setNote("");
          }
        }}
        title={mode === "approve" ? "Mark payment as paid?" : "Reject payment claim?"}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setMode(null);
                setNote("");
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant={mode === "approve" ? "primary" : "danger"}
              onClick={run}
              loading={busy}
            >
              Confirm
            </Button>
          </>
        }
      >
        <p>
          {mode === "approve"
            ? "Check the attached screenshot against the bank/UPI statement first (and the UTR, when one was submitted). This marks the payment PAID and confirms the order."
            : "The customer will need to pay again. The order returns to payment-pending."}
        </p>
        <label htmlFor="admin-action-note" className="mt-3 block text-sm font-semibold text-zinc-800">
          Note (optional, stored in the audit log)
        </label>
        <input
          id="admin-action-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          placeholder="e.g. UTR matched HDFC statement"
          className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-brand-700"
        />
      </Modal>
    </div>
  );
}
