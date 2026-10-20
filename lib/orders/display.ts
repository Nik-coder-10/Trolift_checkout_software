import type { OrderStatus } from "@/types";

/**
 * Order display helpers (pure, unit-tested).
 * The timeline mirrors the database order_status exactly — future
 * stages are never shown as completed.
 */

export type TimelineState = "done" | "current" | "todo";

export interface TimelineStage {
  key: string;
  label: string;
  state: TimelineState;
}

const STAGES = [
  { key: "placed", label: "Order Placed" },
  { key: "payment", label: "Payment" },
  { key: "confirmed", label: "Confirmed" },
  { key: "dispatched", label: "Dispatched" },
  { key: "delivered", label: "Delivered" },
] as const;

/** Index of the current stage, or -1 when the order is cancelled. */
function currentStageIndex(status: OrderStatus): number {
  switch (status) {
    case "draft":
    case "pending_payment":
    case "payment_submitted":
      return 1;
    // Warehouse-internal statuses (processing/packed/ready_for_dispatch)
    // are not shown to customers — the order stays at Confirmed until
    // it is actually dispatched.
    case "paid":
    case "confirmed":
    case "processing":
    case "packed":
    case "ready_for_dispatch":
      return 2;
    case "shipped":
    case "dispatched":
      return 3;
    case "delivered":
      // Past the last stage: every visible step is done.
      return STAGES.length;
    case "cancelled":
      return -1;
  }
}

export function buildTimeline(status: OrderStatus): {
  stages: TimelineStage[];
  cancelled: boolean;
} {
  const current = currentStageIndex(status);
  return {
    stages: STAGES.map((s, i) => ({
      ...s,
      state:
        current === -1
          ? i === 0
            ? "done"
            : "todo"
          : i < current
            ? "done"
            : i === current
              ? "current"
              : "todo",
    })),
    cancelled: current === -1,
  };
}

/** Mask all but the last 4 digits (safe for shared screens). */
export function maskPhone(phone: string | null): string {
  if (!phone) return "—";
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length <= 4) return "••••";
  return `••••••${digits.slice(-4)}`;
}
