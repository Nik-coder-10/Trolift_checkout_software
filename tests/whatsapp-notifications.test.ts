import { afterEach, describe, expect, it, vi } from "vitest";

// server-only modules throw outside the Next server runtime by design.
vi.mock("server-only", () => ({}));

import {
  buildCustomerOrderMessage,
  buildOwnerOrderMessage,
  deliveryStatusLine,
  orderMessageTemplateVariables,
  rupees,
  type OrderMessageInput,
} from "@/lib/notifications/order-message";
import {
  ownerWhatsAppNumber,
  sendWhatsAppMessages,
  toWhatsAppAddress,
  whatsappConfigured,
  whatsappProvider,
} from "@/lib/notifications/whatsapp";
import { notifyOrderPlaced } from "@/lib/notifications/order-notifications";

/**
 * Order notifications: the copy the customer and the owner receive, the
 * number normalization that decides who gets it, and Twilio's send
 * contract (request shape, template mode, failures never throwing).
 */

const KEYS = [
  "WHATSAPP_PROVIDER",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_WHATSAPP_FROM",
  "TWILIO_PHONE_NUMBER",
  "TWILIO_WHATSAPP_TEMPLATE_SID",
  "OWNER_WHATSAPP_NUMBER",
  "PAYMENT_WINDOW_HOURS",
] as const;

const ORIGINALS = new Map<string, string | undefined>(
  KEYS.map((key) => [key, process.env[key]]),
);

function setEnv(values: Partial<Record<(typeof KEYS)[number], string>>): void {
  for (const key of KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of ORIGINALS) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const TWILIO_ENV = {
  TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000000",
  TWILIO_AUTH_TOKEN: "test-token",
  TWILIO_WHATSAPP_FROM: "+14155238886",
  OWNER_WHATSAPP_NUMBER: "9876500000",
} as const;

const INPUT: OrderMessageInput = {
  orderNumber: "TS-000123",
  customerName: "Rahul Sharma",
  customerPhone: "+919876543210",
  businessName: "Sharma Traders",
  billingAddress: "12 MG Road, Pune, Maharashtra 411001",
  gstin: "27ABCDE1234F1Z0",
  lines: [
    { productName: "Hydraulic Hand Pallet Truck 2500 kg", quantity: 1, lineTotalPaise: 2499900 },
    { productName: "Heavy-Duty Platform Trolley 500 kg", quantity: 2, lineTotalPaise: 1259800 },
  ],
  subtotalPaise: 3759700,
  taxPaise: 676746,
  deliveryChargePaise: 45000,
  deliveryPartnerName: "Delhivery",
  etaDays: { min: 2, max: 4 },
  totalPaise: 4481446,
  pincode: "411001",
  paymentWindowHours: 48,
  siteUrl: "https://trolift.example",
};

describe("notification copy", () => {
  it("formats money in Indian groups with paise", () => {
    expect(rupees(316298000)).toBe("31,62,980.00");
    expect(rupees(45000)).toBe("450.00");
    expect(rupees(0)).toBe("0.00");
  });

  it("gives the customer their order, identity and delivery status", () => {
    const text = buildCustomerOrderMessage(INPUT);
    expect(text).toContain("TS-000123");
    expect(text).toContain("Rahul Sharma");
    expect(text).toContain("Business: Sharma Traders");
    expect(text).toContain("Address: 12 MG Road, Pune, Maharashtra 411001");
    expect(text).toContain("GSTIN: 27ABCDE1234F1Z0");
    expect(text).toContain("Hydraulic Hand Pallet Truck 2500 kg x1 - ₹24,999.00");
    expect(text).toContain("Heavy-Duty Platform Trolley 500 kg x2 - ₹12,598.00");
    expect(text).toContain("Total: ₹44,814.46");
    expect(text).toContain(
      "Pincode 411001 (Maharashtra): serviceable on the Delhivery list — Delhivery at ₹450.00, ETA 2–4 days.",
    );
  });

  it("omits business fields for individual orders and keeps the phone out of the customer copy", () => {
    const text = buildCustomerOrderMessage({
      ...INPUT,
      businessName: null,
      billingAddress: null,
      gstin: null,
    });
    expect(text).not.toContain("Business:");
    expect(text).not.toContain("Address:");
    expect(text).not.toContain("GSTIN:");
    expect(text).not.toContain("+919876543210");
  });

  it("gives the owner the customer's contact details too", () => {
    const text = buildOwnerOrderMessage(INPUT);
    expect(text).toContain("New order TS-000123 — ₹44,814.46 (payment pending)");
    expect(text).toContain("Mobile: +919876543210");
    expect(text).toContain("Business: Sharma Traders");
    expect(text).toContain("Pincode 411001 (Maharashtra)");
    expect(text).toContain("Payable within 48 hours.");
  });

  it("names a not-deliverable pincode instead of inventing a status", () => {
    const status = deliveryStatusLine({ ...INPUT, pincode: "680522" });
    expect(status).toContain("Pincode 680522 (Kerala): not deliverable");
    expect(status).toContain("outside our delivery area");
  });

  it("uses the pincode the order was placed with, not the billing pincode", () => {
    const text = buildCustomerOrderMessage({ ...INPUT, pincode: "140407" });
    expect(text).toContain("Pincode 140407");
  });

  it("exposes stable template variables in a fixed order", () => {
    expect(orderMessageTemplateVariables(INPUT)).toEqual([
      "Rahul Sharma",
      "TS-000123",
      "Hydraulic Hand Pallet Truck 2500 kg x1, Heavy-Duty Platform Trolley 500 kg x2",
      "₹44,814.46",
      "Pincode 411001 (Maharashtra): serviceable on the Delhivery list — Delhivery at ₹450.00, ETA 2–4 days.",
      "48 hours",
    ]);
  });
});

describe("recipient normalization", () => {
  it("accepts the stored E.164 form, a bare mobile and a pre-prefixed value", () => {
    expect(toWhatsAppAddress("+919876543210")).toBe("whatsapp:+919876543210");
    expect(toWhatsAppAddress("9876543210")).toBe("whatsapp:+919876543210");
    expect(toWhatsAppAddress("whatsapp:+91 98765 43210")).toBe(
      "whatsapp:+919876543210",
    );
    expect(toWhatsAppAddress("098765 43210")).toBe("whatsapp:+919876543210");
  });

  it("rejects values that cannot be a phone number", () => {
    expect(toWhatsAppAddress("")).toBeNull();
    expect(toWhatsAppAddress("12345")).toBeNull();
    expect(toWhatsAppAddress("not a number")).toBeNull();
  });

  it("returns null (never a broken address) for a malformed owner number", () => {
    setEnv({ OWNER_WHATSAPP_NUMBER: "12" });
    expect(ownerWhatsAppNumber()).toBeNull();
    setEnv({ OWNER_WHATSAPP_NUMBER: "" });
    expect(ownerWhatsAppNumber()).toBeNull();
  });

  it("reads the owner number when it is usable", () => {
    setEnv({ OWNER_WHATSAPP_NUMBER: "098765-00000" });
    expect(ownerWhatsAppNumber()).toBe("whatsapp:+919876500000");
  });
});

describe("provider selection", () => {
  it("stays off unless credentials and a sender are all present", () => {
    setEnv({});
    expect(whatsappProvider()).toBe("off");
    expect(whatsappConfigured()).toBe(false);
    setEnv({ TWILIO_ACCOUNT_SID: "AC1" });
    expect(whatsappProvider()).toBe("off");
    setEnv({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t" });
    expect(whatsappProvider()).toBe("off");
  });

  it("turns on with the full Twilio configuration", () => {
    setEnv({ ...TWILIO_ENV });
    expect(whatsappProvider()).toBe("twilio");
    expect(whatsappConfigured()).toBe(true);
  });

  it("honours an explicit provider choice", () => {
    setEnv({ WHATSAPP_PROVIDER: "twilio" });
    expect(whatsappProvider()).toBe("twilio");
    setEnv({ WHATSAPP_PROVIDER: "off", ...TWILIO_ENV });
    expect(whatsappProvider()).toBe("off");
  });

  it("accepts the catalog's TWILIO_PHONE_NUMBER as the sender", () => {
    setEnv({
      TWILIO_ACCOUNT_SID: TWILIO_ENV.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: TWILIO_ENV.TWILIO_AUTH_TOKEN,
      TWILIO_PHONE_NUMBER: "+919000000000",
    });
    expect(whatsappProvider()).toBe("twilio");
  });
});

describe("sending", () => {
  it("sends nothing (and reports skipped) when unconfigured", async () => {
    setEnv({});
    let calls = 0;
    const outcomes = await sendWhatsAppMessages(
      [{ to: "+919876543210", body: "hi" }],
      {
        fetchImpl: (async () => {
          calls += 1;
          return new Response("{}", { status: 200 });
        }) as typeof fetch,
      },
    );
    expect(calls).toBe(0);
    expect(outcomes).toEqual([
      {
        to: "+919876543210",
        status: "skipped",
        detail: "WhatsApp provider is not configured.",
      },
    ]);
  });

  it("posts one form-encoded message per recipient with basic auth", async () => {
    setEnv({ ...TWILIO_ENV });
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const outcomes = await sendWhatsAppMessages(
      [
        { to: "+919876543210", body: "customer copy" },
        { to: "whatsapp:+919876500000", body: "owner copy" },
      ],
      {
        fetchImpl: (async (url: string | URL, init: RequestInit) => {
          calls.push({ url: String(url), init });
          return new Response(JSON.stringify({ sid: `SM${calls.length}` }), {
            status: 201,
          });
        }) as unknown as typeof fetch,
      },
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/AC00000000000000000000000000000000/Messages.json",
    );
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from(`${TWILIO_ENV.TWILIO_ACCOUNT_SID}:test-token`).toString("base64")}`,
    );
    const first = new URLSearchParams(String(calls[0]!.init.body));
    expect(first.get("From")).toBe("whatsapp:+14155238886");
    expect(first.get("To")).toBe("whatsapp:+919876543210");
    expect(first.get("Body")).toBe("customer copy");
    const second = new URLSearchParams(String(calls[1]!.init.body));
    expect(second.get("To")).toBe("whatsapp:+919876500000");
    expect(outcomes.map((o) => o.status)).toEqual(["sent", "sent"]);
    expect(outcomes[0]!.detail).toBe("SM1");
  });

  it("uses the approved template (with numbered variables) when configured", async () => {
    setEnv({ ...TWILIO_ENV, TWILIO_WHATSAPP_TEMPLATE_SID: "HX11111111111111111111111111111111" });
    let body = "";
    await sendWhatsAppMessages(
      [
        {
          to: "+919876543210",
          body: "fallback text",
          templateVariables: ["Rahul", "TS-000123", "Pallet truck x1", "₹44,814.46", "Deliverable", "48 hours"],
        },
      ],
      {
        fetchImpl: (async (_url: string | URL, init: RequestInit) => {
          body = String(init.body);
          return new Response(JSON.stringify({ sid: "SM9" }), { status: 201 });
        }) as unknown as typeof fetch,
      },
    );
    const params = new URLSearchParams(body);
    expect(params.get("ContentSid")).toBe("HX11111111111111111111111111111111");
    expect(params.get("Body")).toBeNull();
    expect(JSON.parse(params.get("ContentVariables") ?? "{}")).toEqual({
      "1": "Rahul",
      "2": "TS-000123",
      "3": "Pallet truck x1",
      "4": "₹44,814.46",
      "5": "Deliverable",
      "6": "48 hours",
    });
  });

  it("reports a rejected send (unapproved template, blocked recipient) without throwing", async () => {
    setEnv({ ...TWILIO_ENV });
    const outcomes = await sendWhatsAppMessages(
      [{ to: "+919876543210", body: "hi" }],
      {
        fetchImpl: (async () =>
          new Response(
            JSON.stringify({ code: 63016, message: "Outside messaging window" }),
            { status: 400 },
          )) as unknown as typeof fetch,
      },
    );
    expect(outcomes[0]!.status).toBe("failed");
    expect(outcomes[0]!.detail).toContain("63016");
    expect(outcomes[0]!.detail).toContain("Outside messaging window");
  });

  it("reports transport failures without throwing", async () => {
    setEnv({ ...TWILIO_ENV });
    const outcomes = await sendWhatsAppMessages(
      [{ to: "+919876543210", body: "hi" }],
      {
        fetchImpl: (async () => {
          throw new Error("socket hang up");
        }) as unknown as typeof fetch,
      },
    );
    expect(outcomes[0]!.status).toBe("failed");
    expect(outcomes[0]!.detail).toContain("socket hang up");
  });

  it("fails only the unusable recipient, not the whole batch", async () => {
    setEnv({ ...TWILIO_ENV });
    let calls = 0;
    const outcomes = await sendWhatsAppMessages(
      [
        { to: "12", body: "bad" },
        { to: "+919876543210", body: "good" },
      ],
      {
        fetchImpl: (async () => {
          calls += 1;
          return new Response(JSON.stringify({ sid: "SM1" }), { status: 201 });
        }) as unknown as typeof fetch,
      },
    );
    expect(calls).toBe(1);
    expect(outcomes.map((o) => o.status)).toEqual(["failed", "sent"]);
  });
});

describe("order notification orchestration", () => {
  const ORDER = {
    orderNumber: "TS-000123",
    customer: { name: "Rahul Sharma", phone: "+919876543210" },
    billing: {
      gstin: "27ABCDE1234F1Z0",
      name: "Sharma Traders",
      addressLine: "12 MG Road",
      city: "Pune",
      state: "Maharashtra",
      pincode: "411001",
    },
    lines: [
      { productName: "Heavy-Duty Platform Trolley 500 kg", quantity: 1, lineTotalPaise: 629900 },
    ],
    subtotalPaise: 629900,
    taxPaise: 113382,
    deliveryChargePaise: 45000,
    deliveryPartnerName: "Delhivery",
    etaDays: null,
    totalPaise: 788282,
    pincode: "411001",
  };

  it("skips loudly (but not fatally) when WhatsApp is unconfigured", async () => {
    setEnv({ OWNER_WHATSAPP_NUMBER: "9876500000" });
    const result = await notifyOrderPlaced(ORDER, {
      fetchImpl: (async () => {
        throw new Error("must not be called");
      }) as unknown as typeof fetch,
    });
    expect(result).toEqual({ sent: 0, failed: 0, skipped: 2 });
  });

  it("messages the customer and the owner when configured", async () => {
    setEnv({ ...TWILIO_ENV, PAYMENT_WINDOW_HOURS: "24" });
    const recipients: string[] = [];
    const bodies: string[] = [];
    const result = await notifyOrderPlaced(ORDER, {
      fetchImpl: (async (_url: string | URL, init: RequestInit) => {
        const params = new URLSearchParams(String(init.body));
        recipients.push(params.get("To") ?? "");
        bodies.push(params.get("Body") ?? "");
        return new Response(JSON.stringify({ sid: "SM1" }), { status: 201 });
      }) as unknown as typeof fetch,
    });
    expect(result).toEqual({ sent: 2, failed: 0, skipped: 0 });
    expect(recipients).toEqual([
      "whatsapp:+919876543210",
      "whatsapp:+919876500000",
    ]);
    expect(bodies[0]).toContain("Sharma Traders");
    expect(bodies[1]).toContain("Pincode 411001 (Maharashtra)");
    expect(bodies[1]).toContain("Payable within 24 hours.");
  });

  it("still sends the customer copy when the owner number is missing", async () => {
    setEnv({
      TWILIO_ACCOUNT_SID: TWILIO_ENV.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: TWILIO_ENV.TWILIO_AUTH_TOKEN,
      TWILIO_WHATSAPP_FROM: TWILIO_ENV.TWILIO_WHATSAPP_FROM,
    });
    let calls = 0;
    const result = await notifyOrderPlaced(ORDER, {
      fetchImpl: (async () => {
        calls += 1;
        return new Response(JSON.stringify({ sid: "SM1" }), { status: 201 });
      }) as unknown as typeof fetch,
    });
    expect(calls).toBe(1);
    expect(result).toEqual({ sent: 1, failed: 0, skipped: 0 });
  });
});
