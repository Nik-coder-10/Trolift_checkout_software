import { describe, expect, it, vi } from "vitest";

// See tests/payments.test.ts: bypass the server-only guard in tests.
vi.mock("server-only", () => ({}));
import { buildTimeline, maskPhone } from "@/lib/orders/display";
import {
  canTransition,
  isCustomerCancellable,
  isTerminalStatus,
  ORDER_TRANSITIONS,
} from "@/lib/orders/transitions";
import { getPayableOrder } from "@/lib/payments/order";
import type { OrderStatus } from "@/types";

describe("buildTimeline (mirrors DB order_status)", () => {
  it("starts new orders at payment with placed done", () => {
    for (const s of ["draft", "pending_payment", "payment_submitted"] as const) {
      const { stages, cancelled } = buildTimeline(s);
      expect(cancelled).toBe(false);
      expect(stages[0]?.state).toBe("done");
      expect(stages[1]?.state).toBe("current");
      expect(stages.slice(2).every((x) => x.state === "todo")).toBe(true);
    }
  });

  it("advances one stage at a time without skipping", () => {
    const at = (s: Parameters<typeof buildTimeline>[0]) =>
      buildTimeline(s).stages.map((x) => x.state);
    expect(at("confirmed")).toEqual(["done", "done", "current", "todo", "todo", "todo", "todo", "todo"]);
    expect(at("processing")).toEqual(["done", "done", "done", "current", "todo", "todo", "todo", "todo"]);
    expect(at("packed")).toEqual(["done", "done", "done", "done", "current", "todo", "todo", "todo"]);
    expect(at("ready_for_dispatch")).toEqual(["done", "done", "done", "done", "done", "current", "todo", "todo"]);
    expect(at("shipped")).toEqual(["done", "done", "done", "done", "done", "done", "current", "todo"]);
    expect(at("dispatched")).toEqual(["done", "done", "done", "done", "done", "done", "current", "todo"]);
    expect(at("delivered")).toEqual(["done", "done", "done", "done", "done", "done", "done", "done"]);
  });

  it("marks cancelled orders without completing the future", () => {
    const { stages, cancelled } = buildTimeline("cancelled");
    expect(cancelled).toBe(true);
    expect(stages.filter((x) => x.state === "done")).toHaveLength(1);
    expect(stages.some((x) => x.state === "current")).toBe(false);
  });
});

describe("maskPhone", () => {
  it("hides all but the last 4 digits", () => {
    expect(maskPhone("+919876543210")).toBe("••••••3210");
    expect(maskPhone(null)).toBe("—");
    expect(maskPhone("123")).toBe("••••");
  });
});

describe("order transitions (single forward spine, no jumps)", () => {
  const happy: Array<[OrderStatus, OrderStatus]> = [
    ["draft", "pending_payment"],
    ["draft", "payment_submitted"],
    ["pending_payment", "payment_submitted"],
    ["payment_submitted", "confirmed"],
    ["paid", "confirmed"],
    ["confirmed", "processing"],
    ["processing", "packed"],
    ["packed", "ready_for_dispatch"],
    ["ready_for_dispatch", "dispatched"],
    ["shipped", "dispatched"],
    ["dispatched", "delivered"],
  ];
  it.each(happy)("allows %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  const bad: Array<[OrderStatus, OrderStatus]> = [
    ["pending_payment", "confirmed"],
    ["pending_payment", "dispatched"],
    ["payment_submitted", "dispatched"],
    ["confirmed", "delivered"],
    ["processing", "delivered"],
    ["delivered", "cancelled"],
    ["cancelled", "pending_payment"],
    ["delivered", "processing"],
    ["paid", "dispatched"],
  ];
  it.each(bad)("denies %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("covers every schema status with no dead ends except terminals", () => {
    const states = Object.keys(ORDER_TRANSITIONS) as OrderStatus[];
    expect(states).toHaveLength(12);
    for (const s of states) {
      if (s === "delivered" || s === "cancelled") {
        expect(isTerminalStatus(s)).toBe(true);
      } else {
        expect(isTerminalStatus(s)).toBe(false);
      }
    }
  });

  it("restricts customer cancellation to pre-fulfilment", () => {
    for (const s of ["draft", "pending_payment", "payment_submitted"] as const) {
      expect(isCustomerCancellable(s)).toBe(true);
    }
    for (const s of ["confirmed", "processing", "packed", "ready_for_dispatch", "dispatched", "delivered", "cancelled"] as const) {
      expect(isCustomerCancellable(s)).toBe(false);
    }
  });
});

describe("order access without a backend (fail-closed)", () => {
  it("returns null for malformed ids without touching the DB", async () => {
    await expect(getPayableOrder("not-a-uuid")).resolves.toBeNull();
    await expect(getPayableOrder("")).resolves.toBeNull();
  });
});
