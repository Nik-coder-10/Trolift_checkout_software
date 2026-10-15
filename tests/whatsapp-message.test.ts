import { describe, expect, it } from "vitest";
import {
  buildOrderMessage,
  toWaNumber,
  whatsAppLink,
} from "@/lib/whatsapp/order-message";
import type { OrderMessageInput } from "@/lib/whatsapp/order-message";

const BASE: OrderMessageInput = {
  orderNumber: "TS-261015-0007",
  customerName: "Ravi Kumar",
  customerPhone: "9876543210",
  customerEmail: "ravi@example.com",
  gstin: "27ABCDE1234F1Z5",
  businessName: "Ravi Traders",
  address: "12 Market Road, Mumbai, Maharashtra, 400001",
  pincode: "400001",
  deliveryStatus: "Serviceable",
  deliveryDetails: "Partner: BlueDart | Charge: ₹450.00 | ETA: 2-4 days",
  items: [
    { name: "Hydraulic Hand Pallet Truck 2500 kg", quantity: 1, lineTotalPaise: 2499900 },
    { name: "Heavy-Duty Platform Trolley 500 kg", quantity: 2, lineTotalPaise: 1259800 },
  ],
  subtotalPaise: 3759700,
  deliveryChargePaise: 45000,
  totalPaise: 3804700,
  siteUrl: "https://trolift.example",
};

describe("toWaNumber", () => {
  it("normalizes Indian formats to country-coded digits", () => {
    expect(toWaNumber("9876543210")).toBe("919876543210");
    expect(toWaNumber("09876543210")).toBe("919876543210");
    expect(toWaNumber("+91 98765 43210")).toBe("919876543210");
    expect(toWaNumber("+919876543210")).toBe("919876543210");
    expect(toWaNumber("")).toBe("");
  });
});

describe("buildOrderMessage", () => {
  it("includes customer, business, GSTIN, items, total and delivery", () => {
    const text = buildOrderMessage(BASE);
    expect(text).toContain("New order TS-261015-0007");
    expect(text).toContain("Name: Ravi Kumar");
    expect(text).toContain("Business: Ravi Traders");
    expect(text).toContain("Address: 12 Market Road, Mumbai, Maharashtra, 400001");
    expect(text).toContain("GSTIN: 27ABCDE1234F1Z5");
    expect(text).toContain("Pincode: 400001");
    expect(text).toContain("Phone: 9876543210");
    expect(text).toContain("Delivery (pincode 400001): Serviceable");
    expect(text).toContain("Details: Partner: BlueDart | Charge: ₹450.00 | ETA: 2-4 days");
    expect(text).toContain(
      "- Hydraulic Hand Pallet Truck 2500 kg x 1 = ₹24,999.00",
    );
    expect(text).toContain("- Heavy-Duty Platform Trolley 500 kg x 2 = ₹12,598.00");
    expect(text).toContain("Subtotal: ₹37,597.00");
    expect(text).toContain("Delivery: ₹450.00");
    expect(text).toContain("Total: ₹38,047.00");
    expect(text).toContain("Placed via https://trolift.example");
  });

  it("omits blank optional fields (individual / non-GST order)", () => {
    const text = buildOrderMessage({
      ...BASE,
      businessName: null,
      address: null,
      gstin: "",
      customerEmail: null,
      deliveryDetails: null,
      deliveryChargePaise: null,
      siteUrl: null,
    });
    expect(text).not.toContain("Business:");
    expect(text).not.toContain("Address:");
    expect(text).not.toContain("GSTIN:");
    expect(text).not.toContain("Email:");
    expect(text).not.toContain("Details:");
    expect(text).not.toContain("Delivery: ");
    expect(text).not.toContain("Placed via");
    expect(text).toContain("Total: ₹38,047.00");
  });
});

describe("whatsAppLink", () => {
  it("builds an encoded wa.me link to the normalized number", () => {
    const link = whatsAppLink("9876543210", buildOrderMessage(BASE));
    expect(link.startsWith("https://wa.me/919876543210?text=")).toBe(true);
    expect(link).not.toContain("\n");
    expect(link).toContain("%0A");
  });

  it("falls back to the WhatsApp share picker without a number", () => {
    expect(whatsAppLink("", "hello world")).toBe(
      "https://wa.me/?text=hello%20world",
    );
  });
});
