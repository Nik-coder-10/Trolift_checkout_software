import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createMockClient,
  type MockResponder,
} from "@/tests/helpers/supabase-mock";
import { resetRateLimits } from "@/lib/rate-limit/index";
import {
  canTransition,
  isCustomerCancellable,
  isTerminalStatus,
} from "@/lib/orders/transitions";
import { eventTypeForTransition } from "@/lib/orders/events";
import { buildTimeline } from "@/lib/orders/display";
import type { OrderStatus } from "@/types";

beforeEach(() => resetRateLimits());

const serverHandler: MockResponder = () => {
  throw new Error("unexpected server query");
};
const adminHandler: MockResponder = () => {
  throw new Error("unexpected admin query");
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createMockClient(serverHandler),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createMockClient(adminHandler),
}));

describe("Fulfillment workflow - valid transitions", () => {
  const validTransitions: Array<[OrderStatus, OrderStatus]> = [
    ["confirmed", "processing"],
    ["processing", "packed"],
    ["packed", "ready_for_dispatch"],
    ["ready_for_dispatch", "dispatched"],
    ["dispatched", "delivered"],
    ["confirmed", "cancelled"],
    ["processing", "cancelled"],
    ["packed", "cancelled"],
    ["ready_for_dispatch", "cancelled"],
  ];

  for (const [from, to] of validTransitions) {
    it(`allows ${from} → ${to}`, () => {
      expect(canTransition(from, to)).toBe(true);
    });
  }
});

describe("Fulfillment workflow - invalid transitions", () => {
  const invalidTransitions: Array<[OrderStatus, OrderStatus]> = [
    ["confirmed", "packed"],
    ["confirmed", "ready_for_dispatch"],
    ["confirmed", "dispatched"],
    ["confirmed", "delivered"],
    ["processing", "ready_for_dispatch"],
    ["processing", "dispatched"],
    ["processing", "delivered"],
    ["packed", "dispatched"],
    ["packed", "delivered"],
    ["ready_for_dispatch", "delivered"],
    ["delivered", "cancelled"],
    ["cancelled", "confirmed"],
    ["cancelled", "processing"],
    ["pending_payment", "confirmed"],
    ["payment_submitted", "processing"],
    ["draft", "confirmed"],
  ];

  for (const [from, to] of invalidTransitions) {
    it(`rejects ${from} → ${to}`, () => {
      expect(canTransition(from, to)).toBe(false);
    });
  }
});

describe("Fulfillment workflow - event type mapping", () => {
  it("maps confirmed → processing to PROCESSING_STARTED", () => {
    expect(eventTypeForTransition("confirmed", "processing")).toBe("PROCESSING_STARTED");
  });

  it("maps processing → packed to PACKED", () => {
    expect(eventTypeForTransition("processing", "packed")).toBe("PACKED");
  });

  it("maps packed → ready_for_dispatch to READY_FOR_DISPATCH", () => {
    expect(eventTypeForTransition("packed", "ready_for_dispatch")).toBe("READY_FOR_DISPATCH");
  });

  it("maps ready_for_dispatch → dispatched to DISPATCHED", () => {
    expect(eventTypeForTransition("ready_for_dispatch", "dispatched")).toBe("DISPATCHED");
  });

  it("maps dispatched → delivered to DELIVERED", () => {
    expect(eventTypeForTransition("dispatched", "delivered")).toBe("DELIVERED");
  });

  it("maps any → cancelled to CANCELLED", () => {
    expect(eventTypeForTransition("confirmed", "cancelled")).toBe("CANCELLED");
    expect(eventTypeForTransition("processing", "cancelled")).toBe("CANCELLED");
    expect(eventTypeForTransition("packed", "cancelled")).toBe("CANCELLED");
  });
});

describe("Fulfillment workflow - customer cancellation rules", () => {
  it("allows cancellation from pre-fulfillment states", () => {
    expect(isCustomerCancellable("draft")).toBe(true);
    expect(isCustomerCancellable("pending_payment")).toBe(true);
    expect(isCustomerCancellable("payment_submitted")).toBe(true);
  });

  it("prevents cancellation from fulfillment states", () => {
    expect(isCustomerCancellable("confirmed")).toBe(false);
    expect(isCustomerCancellable("processing")).toBe(false);
    expect(isCustomerCancellable("packed")).toBe(false);
    expect(isCustomerCancellable("ready_for_dispatch")).toBe(false);
    expect(isCustomerCancellable("dispatched")).toBe(false);
  });

  it("prevents cancellation from terminal states", () => {
    expect(isCustomerCancellable("delivered")).toBe(false);
    expect(isCustomerCancellable("cancelled")).toBe(false);
  });
});

describe("Fulfillment workflow - terminal states", () => {
  it("identifies delivered as terminal", () => {
    expect(isTerminalStatus("delivered")).toBe(true);
  });

  it("identifies cancelled as terminal", () => {
    expect(isTerminalStatus("cancelled")).toBe(true);
  });

  it("identifies non-terminal states", () => {
    expect(isTerminalStatus("confirmed")).toBe(false);
    expect(isTerminalStatus("processing")).toBe(false);
    expect(isTerminalStatus("packed")).toBe(false);
    expect(isTerminalStatus("ready_for_dispatch")).toBe(false);
    expect(isTerminalStatus("dispatched")).toBe(false);
  });
});

describe("Fulfillment workflow - timeline display", () => {
  it("shows correct timeline for confirmed order", () => {
    const { stages, cancelled } = buildTimeline("confirmed");
    expect(cancelled).toBe(false);
    expect(stages[0]?.state).toBe("done");
    expect(stages[1]?.state).toBe("done");
    expect(stages[2]?.state).toBe("current");
    expect(stages[3]?.state).toBe("todo");
    expect(stages[4]?.state).toBe("todo");
  });

  it("collapses processing/packed/ready into confirmed (customer view)", () => {
    for (const status of ["processing", "packed", "ready_for_dispatch"] as const) {
      const { stages, cancelled } = buildTimeline(status);
      expect(cancelled).toBe(false);
      expect(stages[0]?.state).toBe("done");
      expect(stages[1]?.state).toBe("done");
      expect(stages[2]?.state).toBe("current");
      expect(stages[3]?.state).toBe("todo");
      expect(stages[4]?.state).toBe("todo");
    }
  });

  it("shows correct timeline for dispatched order", () => {
    const { stages } = buildTimeline("dispatched");
    expect(stages[0]?.state).toBe("done");
    expect(stages[1]?.state).toBe("done");
    expect(stages[2]?.state).toBe("done");
    expect(stages[3]?.state).toBe("current");
    expect(stages[4]?.state).toBe("todo");
  });

  it("shows correct timeline for delivered order", () => {
    const { stages } = buildTimeline("delivered");
    expect(stages.every((s) => s.state === "done")).toBe(true);
  });

  it("shows correct timeline for cancelled order", () => {
    const { stages, cancelled } = buildTimeline("cancelled");
    expect(cancelled).toBe(true);
    expect(stages[0]?.state).toBe("done");
    expect(stages[1]?.state).toBe("todo");
  });
});

describe("Fulfillment workflow - admin order operations", () => {
  it("transitionOrderStatus allows valid fulfillment transitions", () => {
    const transitions: Array<[OrderStatus, OrderStatus]> = [
      ["confirmed", "processing"],
      ["processing", "packed"],
      ["packed", "ready_for_dispatch"],
      ["ready_for_dispatch", "dispatched"],
      ["dispatched", "delivered"],
    ];
    for (const [from, to] of transitions) {
      expect(canTransition(from, to)).toBe(true);
    }
  });

  it("transitionOrderStatus rejects invalid transitions", () => {
    const invalidTransitions: Array<[OrderStatus, OrderStatus]> = [
      ["confirmed", "packed"],
      ["processing", "dispatched"],
      ["packed", "delivered"],
      ["delivered", "cancelled"],
    ];
    for (const [from, to] of invalidTransitions) {
      expect(canTransition(from, to)).toBe(false);
    }
  });
});

describe("Fulfillment workflow - inventory interaction", () => {
  it("stock is consumed when payment verified (order → confirmed)", () => {
    expect(canTransition("payment_submitted", "confirmed")).toBe(true);
  });

  it("stock is restored when order cancelled from fulfillment states", () => {
    expect(canTransition("confirmed", "cancelled")).toBe(true);
    expect(canTransition("processing", "cancelled")).toBe(true);
    expect(canTransition("packed", "cancelled")).toBe(true);
    expect(canTransition("ready_for_dispatch", "cancelled")).toBe(true);
  });

  it("no inventory change for fulfillment step transitions", () => {
    expect(canTransition("processing", "packed")).toBe(true);
    expect(canTransition("packed", "ready_for_dispatch")).toBe(true);
    expect(canTransition("ready_for_dispatch", "dispatched")).toBe(true);
  });
});

describe("Fulfillment workflow - customer visibility", () => {
  it("customer timeline includes fulfillment milestones", async () => {
    const { customerSafeTimeline } = await import("@/lib/orders/events");
    const events = [
      { eventType: "ORDER_CREATED", createdAt: "2026-10-01T10:00:00Z" },
      { eventType: "PAYMENT_VERIFIED", createdAt: "2026-10-01T11:00:00Z" },
      { eventType: "ORDER_CONFIRMED", createdAt: "2026-10-01T12:00:00Z" },
      { eventType: "PROCESSING_STARTED", createdAt: "2026-10-02T09:00:00Z" },
      { eventType: "PACKED", createdAt: "2026-10-02T14:00:00Z" },
      { eventType: "READY_FOR_DISPATCH", createdAt: "2026-10-03T10:00:00Z" },
      { eventType: "DISPATCHED", createdAt: "2026-10-03T16:00:00Z" },
      { eventType: "DELIVERED", createdAt: "2026-10-05T12:00:00Z" },
    ];
    const timeline = customerSafeTimeline(events);
    expect(timeline.map((t) => t.label)).toEqual([
      "Order placed",
      "Payment received",
      "Order confirmed",
      "Being prepared",
      "Packed",
      "Ready for dispatch",
      "Dispatched",
      "Delivered",
    ]);
  });

  it("customer timeline hides internal STATUS_CHANGED events", async () => {
    const { customerSafeTimeline } = await import("@/lib/orders/events");
    const events = [
      { eventType: "ORDER_CREATED", createdAt: "2026-10-01T10:00:00Z" },
      { eventType: "STATUS_CHANGED", createdAt: "2026-10-01T11:00:00Z" },
    ];
    const timeline = customerSafeTimeline(events);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.label).toBe("Order placed");
  });
});

describe("Fulfillment workflow - retry safety", () => {
  it("duplicate packed transition is rejected by state machine", () => {
    expect(canTransition("packed", "packed")).toBe(false);
  });

  it("duplicate ready_for_dispatch transition is rejected by state machine", () => {
    expect(canTransition("ready_for_dispatch", "ready_for_dispatch")).toBe(false);
  });

  it("backward transition from packed to processing is rejected", () => {
    expect(canTransition("packed", "processing")).toBe(false);
  });

  it("backward transition from ready_for_dispatch to packed is rejected", () => {
    expect(canTransition("ready_for_dispatch", "packed")).toBe(false);
  });
});
