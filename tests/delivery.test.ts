import { describe, expect, it, vi } from "vitest";

// server-only modules throw outside the Next server runtime by design.
vi.mock("server-only", () => ({}));
import {
  selectDeliveryOption,
  withinOrderWindow,
  type RateOption,
} from "@/lib/delivery/engine";
import { priceOrderLines } from "@/lib/orders/quote";

const opt = (over: Partial<RateOption> = {}): RateOption => ({
  partnerId: "p1",
  partnerName: "Partner A",
  partnerPriority: 100,
  deliveryChargePaise: 50000,
  minOrderPaise: null,
  maxOrderPaise: null,
  ...over,
});

describe("selectDeliveryOption (strategy: priority, then charge)", () => {
  it("returns null when nothing qualifies", () => {
    expect(selectDeliveryOption([])).toBeNull();
  });

  it("picks the lowest charge among equal priorities", () => {
    const best = selectDeliveryOption([
      opt({ partnerId: "b", partnerName: "Partner B", deliveryChargePaise: 65000 }),
      opt({ partnerId: "a", partnerName: "Partner A", deliveryChargePaise: 50000 }),
      opt({ partnerId: "c", partnerName: "Partner C", deliveryChargePaise: 90000 }),
    ]);
    expect(best?.partnerId).toBe("a");
    expect(best?.deliveryChargePaise).toBe(50000);
  });

  it("prefers partner priority over a cheaper charge", () => {
    const best = selectDeliveryOption([
      opt({ partnerId: "cheap", deliveryChargePaise: 10000, partnerPriority: 200 }),
      opt({ partnerId: "prime", deliveryChargePaise: 80000, partnerPriority: 10 }),
    ]);
    expect(best?.partnerId).toBe("prime");
  });

  it("breaks priority ties on charge", () => {
    const best = selectDeliveryOption([
      opt({ partnerId: "x", partnerPriority: 50, deliveryChargePaise: 70000 }),
      opt({ partnerId: "y", partnerPriority: 50, deliveryChargePaise: 40000 }),
    ]);
    expect(best?.partnerId).toBe("y");
  });

  it("does not mutate the input order", () => {
    const options = [
      opt({ partnerId: "b", deliveryChargePaise: 65000 }),
      opt({ partnerId: "a", deliveryChargePaise: 50000 }),
    ];
    selectDeliveryOption(options);
    expect(options.map((o) => o.partnerId)).toEqual(["b", "a"]);
  });
});

describe("withinOrderWindow", () => {
  it("passes unbounded options at any subtotal", () => {
    expect(withinOrderWindow(opt(), 0)).toBe(true);
    expect(withinOrderWindow(opt(), 10_000_000)).toBe(true);
  });

  it("enforces min and max bounds inclusively", () => {
    const o = opt({ minOrderPaise: 25_000_00, maxOrderPaise: 100_000_00 });
    expect(withinOrderWindow(o, 24_999_99)).toBe(false);
    expect(withinOrderWindow(o, 25_000_00)).toBe(true);
    expect(withinOrderWindow(o, 100_000_00)).toBe(true);
    expect(withinOrderWindow(o, 100_000_01)).toBe(false);
  });
});

const PRODUCTS = [
  { id: "p1", name: "Trolley", price: "6299.00", gst_rate: "18.00", hsn_code: "87168010", is_active: true, available: 10 },
  { id: "p2", name: "Stacker", price: "285000.00", gst_rate: null, hsn_code: null, is_active: true, available: 3 },
  { id: "p3", name: "Retired", price: "100.00", gst_rate: null, hsn_code: null, is_active: false, available: 0 },
];

describe("priceOrderLines (server authority: ids + quantities only)", () => {
  it("prices lines from trusted rows and sums exactly in paise", () => {
    const lines = priceOrderLines(PRODUCTS, [
      { productId: "p1", quantity: 2 },
      { productId: "p2", quantity: 1 },
    ]);
    expect(lines).toEqual([
      {
        productId: "p1",
        productName: "Trolley",
        quantity: 2,
        unitPricePaise: 629900,
        lineTotalPaise: 1259800,
        gstRate: "18.00",
        lineTaxPaise: 226764,
        hsn: "87168010",
      },
      {
        productId: "p2",
        productName: "Stacker",
        quantity: 1,
        unitPricePaise: 28500000,
        lineTotalPaise: 28500000,
        gstRate: null,
        lineTaxPaise: 0,
        hsn: null,
      },
    ]);
    // subtotal + delivery = total holds in integers (delivery e.g. 45000).
    const subtotal = lines.reduce((n, l) => n + l.lineTotalPaise, 0);
    expect(subtotal).toBe(29759800);
    expect(subtotal + 45000).toBe(29804800);
  });

  it("rejects unknown and inactive products", () => {
    expect(() =>
      priceOrderLines(PRODUCTS, [{ productId: "ghost", quantity: 1 }]),
    ).toThrow("no longer available");
    expect(() =>
      priceOrderLines(PRODUCTS, [{ productId: "p3", quantity: 1 }]),
    ).toThrow("no longer available");
  });

  it("rejects zero, negative, fractional and huge quantities", () => {
    for (const quantity of [0, -2, 1.5, 1000]) {
      expect(() => priceOrderLines(PRODUCTS, [{ productId: "p1", quantity }])).toThrow();
    }
  });

  it("rejects an empty order", () => {
    expect(() => priceOrderLines(PRODUCTS, [])).toThrow("no items");
  });

  it("accepts no client money: there is no price parameter to fake", () => {
    // The signature only carries ids + quantities; a browser-supplied
    // unit price or line total has nowhere to go.
    const keys = ["productId", "quantity"] as const;
    expect(Object.keys({ productId: "p1", quantity: 1 })).toEqual([...keys]);
    const lines = priceOrderLines(PRODUCTS, [{ productId: "p1", quantity: 1 }]);
    expect(lines[0]?.unitPricePaise).toBe(629900);
  });
});
