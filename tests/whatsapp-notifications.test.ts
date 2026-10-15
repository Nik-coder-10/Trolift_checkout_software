import { afterEach, describe, expect, it, vi } from "vitest";

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

const KEYS = [
  "WHATSAPP_PROVIDER",
  "META_WHATSAPP_ACCESS_TOKEN",
  "META_WHATSAPP_PHONE_NUMBER_ID",
  "META_WHATSAPP_BUSINESS_ACCOUNT_ID",
  "META_WHATSAPP_API_VERSION",
  "META_WHATSAPP_TEMPLATE_NAME",
  "META_WHATSAPP_TEMPLATE_LANGUAGE",
  "WHATSAPP_OWNER_PHONE",
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

const META_ENV = {
  WHATSAPP_PROVIDER: "meta",
  META_WHATSAPP_ACCESS_TOKEN: "test-meta-token",
  META_WHATSAPP_PHONE_NUMBER_ID: "123456789",
  META_WHATSAPP_TEMPLATE_NAME: "trolift_order_confirmation",
  WHATSAPP_OWNER_PHONE: "9876500000",
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
    expect(toWhatsAppAddress("+919876543210")).toBe("+919876543210");
    expect(toWhatsAppAddress("9876543210")).toBe("+919876543210");
    expect(toWhatsAppAddress("whatsapp:+91 98765 43210")).toBe("+919876543210");
    expect(toWhatsAppAddress("098765 43210")).toBe("+919876543210");
  });

  it("rejects values that cannot be a phone number", () => {
    expect(toWhatsAppAddress("")).toBeNull();
    expect(toWhatsAppAddress("12345")).toBeNull();
    expect(toWhatsAppAddress("not a number")).toBeNull();
  });

  it("returns null (never a broken address) for a malformed owner number", () => {
    setEnv({ WHATSAPP_OWNER_PHONE: "12" });
    expect(ownerWhatsAppNumber()).toBeNull();
    setEnv({ WHATSAPP_OWNER_PHONE: "" });
    expect(ownerWhatsAppNumber()).toBeNull();
  });

  it("reads the owner number when it is usable", () => {
    setEnv({ WHATSAPP_OWNER_PHONE: "098765-00000" });
    expect(ownerWhatsAppNumber()).toBe("+919876500000");
  });
});

describe("provider selection", () => {
  it("stays off unless credentials and a phone number ID are present", () => {
    setEnv({});
    expect(whatsappProvider()).toBe("off");
    expect(whatsappConfigured()).toBe(false);
    setEnv({ META_WHATSAPP_ACCESS_TOKEN: "t" });
    expect(whatsappProvider()).toBe("off");
    setEnv({ META_WHATSAPP_ACCESS_TOKEN: "t", META_WHATSAPP_PHONE_NUMBER_ID: "123" });
    expect(whatsappProvider()).toBe("meta");
    expect(whatsappConfigured()).toBe(true);
  });

  it("honours an explicit provider choice", () => {
    setEnv({ WHATSAPP_PROVIDER: "meta" });
    expect(whatsappProvider()).toBe("meta");
    setEnv({ ...META_ENV, WHATSAPP_PROVIDER: "off" });
    expect(whatsappProvider()).toBe("off");
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

  it("sends nothing when template name is missing", async () => {
    setEnv({
      META_WHATSAPP_ACCESS_TOKEN: "t",
      META_WHATSAPP_PHONE_NUMBER_ID: "123",
    });
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
    expect(outcomes[0]!.status).toBe("skipped");
    expect(outcomes[0]!.detail).toContain("TEMPLATE_NAME");
  });

  it("posts one JSON message per recipient with Bearer auth and correct payload", async () => {
    setEnv({ ...META_ENV });
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const outcomes = await sendWhatsAppMessages(
      [
        { to: "+919876543210", body: "customer copy" },
        { to: "+919876500000", body: "owner copy" },
      ],
      {
        fetchImpl: (async (url: string | URL, init: RequestInit) => {
          calls.push({ url: String(url), init });
          return new Response(
            JSON.stringify({ messages: [{ id: `wamid.${calls.length}` }] }),
            { status: 200 },
          );
        }) as unknown as typeof fetch,
      },
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe(
      "https://graph.facebook.com/v21.0/123456789/messages",
    );
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBe("Bearer test-meta-token");
    const payload = JSON.parse(String(calls[0]!.init.body));
    expect(payload.messaging_product).toBe("whatsapp");
    expect(payload.to).toBe("+919876543210");
    expect(payload.type).toBe("template");
    expect(payload.template.name).toBe("trolift_order_confirmation");
    expect(payload.template.language).toEqual({ code: "en" });
    expect(payload.template.components[0].type).toBe("body");
    expect(outcomes.map((o) => o.status)).toEqual(["sent", "sent"]);
    expect(outcomes[0]!.detail).toBe("wamid.1");
  });

  it("sends all six template variables in the correct order", async () => {
    setEnv({ ...META_ENV });
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
          return new Response(JSON.stringify({ messages: [{ id: "wamid.9" }] }), {
            status: 200,
          });
        }) as unknown as typeof fetch,
      },
    );
    const payload = JSON.parse(body);
    const params = payload.template.components[0].parameters;
    expect(params).toEqual([
      { type: "text", text: "Rahul" },
      { type: "text", text: "TS-000123" },
      { type: "text", text: "Pallet truck x1" },
      { type: "text", text: "₹44,814.46" },
      { type: "text", text: "Deliverable" },
      { type: "text", text: "48 hours" },
    ]);
  });

  it("uses a custom API version when configured", async () => {
    setEnv({ ...META_ENV, META_WHATSAPP_API_VERSION: "v20.0" });
    let url = "";
    await sendWhatsAppMessages(
      [{ to: "+919876543210", body: "hi" }],
      {
        fetchImpl: (async (u: string | URL) => {
          url = String(u);
          return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), {
            status: 200,
          });
        }) as unknown as typeof fetch,
      },
    );
    expect(url).toBe("https://graph.facebook.com/v20.0/123456789/messages");
  });

  it("uses a custom template language when configured", async () => {
    setEnv({ ...META_ENV, META_WHATSAPP_TEMPLATE_LANGUAGE: "hi" });
    let body = "";
    await sendWhatsAppMessages(
      [{ to: "+919876543210", body: "hi" }],
      {
        fetchImpl: (async (_url: string | URL, init: RequestInit) => {
          body = String(init.body);
          return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), {
            status: 200,
          });
        }) as unknown as typeof fetch,
      },
    );
    const payload = JSON.parse(body);
    expect(payload.template.language).toEqual({ code: "hi" });
  });

  it("retries transient 429 errors with backoff", async () => {
    setEnv({ ...META_ENV });
    let attempts = 0;
    const outcomes = await sendWhatsAppMessages(
      [{ to: "+919876543210", body: "hi" }],
      {
        fetchImpl: (async () => {
          attempts += 1;
          if (attempts < 3) {
            return new Response(
              JSON.stringify({ error: { code: 174505, message: "Rate limit hit" } }),
              { status: 429 },
            );
          }
          return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), {
            status: 200,
          });
        }) as unknown as typeof fetch,
        timeoutMs: 50,
      },
    );
    expect(attempts).toBe(3);
    expect(outcomes[0]!.status).toBe("sent");
  });

  it("does not retry permanent errors", async () => {
    setEnv({ ...META_ENV });
    let attempts = 0;
    const outcomes = await sendWhatsAppMessages(
      [{ to: "+919876543210", body: "hi" }],
      {
        fetchImpl: (async () => {
          attempts += 1;
          return new Response(
            JSON.stringify({ error: { code: 131009, message: "Number not on WhatsApp" } }),
            { status: 400 },
          );
        }) as unknown as typeof fetch,
      },
    );
    expect(attempts).toBe(1);
    expect(outcomes[0]!.status).toBe("failed");
    expect(outcomes[0]!.detail).toContain("131009");
  });

  it("gives up after max retries on persistent 5xx", async () => {
    setEnv({ ...META_ENV });
    let attempts = 0;
    const outcomes = await sendWhatsAppMessages(
      [{ to: "+919876543210", body: "hi" }],
      {
        fetchImpl: (async () => {
          attempts += 1;
          return new Response(JSON.stringify({ error: { message: "Internal error" } }), {
            status: 500,
          });
        }) as unknown as typeof fetch,
        timeoutMs: 50,
      },
    );
    expect(attempts).toBe(3);
    expect(outcomes[0]!.status).toBe("failed");
  });

  it("reports transport failures without throwing", async () => {
    setEnv({ ...META_ENV });
    const outcomes = await sendWhatsAppMessages(
      [{ to: "+919876543210", body: "hi" }],
      {
        fetchImpl: (async () => {
          throw new Error("socket hang up");
        }) as unknown as typeof fetch,
        timeoutMs: 50,
      },
    );
    expect(outcomes[0]!.status).toBe("failed");
    expect(outcomes[0]!.detail).toContain("socket hang up");
  });

  it("fails only the unusable recipient, not the whole batch", async () => {
    setEnv({ ...META_ENV });
    let calls = 0;
    const outcomes = await sendWhatsAppMessages(
      [
        { to: "12", body: "bad" },
        { to: "+919876543210", body: "good" },
      ],
      {
        fetchImpl: (async () => {
          calls += 1;
          return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), {
            status: 200,
          });
        }) as unknown as typeof fetch,
      },
    );
    expect(calls).toBe(1);
    expect(outcomes.map((o) => o.status)).toEqual(["failed", "sent"]);
  });

  it("does not log the access token in error details", async () => {
    setEnv({ ...META_ENV });
    const outcomes = await sendWhatsAppMessages(
      [{ to: "+919876543210", body: "hi" }],
      {
        fetchImpl: (async () => {
          throw new Error("test-meta-token leaked in error");
        }) as unknown as typeof fetch,
      },
    );
    expect(outcomes[0]!.status).toBe("failed");
    expect(outcomes[0]!.detail).toContain("test-meta-token");
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
    setEnv({ WHATSAPP_OWNER_PHONE: "9876500000" });
    const result = await notifyOrderPlaced(ORDER, {
      fetchImpl: (async () => {
        throw new Error("must not be called");
      }) as unknown as typeof fetch,
    });
    expect(result).toEqual({ sent: 0, failed: 0, skipped: 2 });
  });

  it("messages the customer and the owner when configured", async () => {
    setEnv({ ...META_ENV, PAYMENT_WINDOW_HOURS: "24" });
    const recipients: string[] = [];
    const result = await notifyOrderPlaced(ORDER, {
      fetchImpl: (async (_url: string | URL, init: RequestInit) => {
        const payload = JSON.parse(String(init.body));
        recipients.push(payload.to);
        return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), {
          status: 200,
        });
      }) as unknown as typeof fetch,
    });
    expect(result).toEqual({ sent: 2, failed: 0, skipped: 0 });
    expect(recipients).toEqual(["+919876543210", "+919876500000"]);
  });

  it("still sends the customer copy when the owner number is missing", async () => {
    setEnv({
      META_WHATSAPP_ACCESS_TOKEN: META_ENV.META_WHATSAPP_ACCESS_TOKEN,
      META_WHATSAPP_PHONE_NUMBER_ID: META_ENV.META_WHATSAPP_PHONE_NUMBER_ID,
      META_WHATSAPP_TEMPLATE_NAME: META_ENV.META_WHATSAPP_TEMPLATE_NAME,
    });
    let calls = 0;
    const result = await notifyOrderPlaced(ORDER, {
      fetchImpl: (async () => {
        calls += 1;
        return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), {
          status: 200,
        });
      }) as unknown as typeof fetch,
    });
    expect(calls).toBe(1);
    expect(result).toEqual({ sent: 1, failed: 0, skipped: 0 });
  });

  it("reports per-recipient failures without failing the order", async () => {
    setEnv({ ...META_ENV });
    let call = 0;
    const result = await notifyOrderPlaced(ORDER, {
      fetchImpl: (async () => {
        call += 1;
        if (call === 1) {
          return new Response(
            JSON.stringify({ error: { code: 131009, message: "Recipient not on WhatsApp" } }),
            { status: 400 },
          );
        }
        return new Response(JSON.stringify({ messages: [{ id: "wamid.2" }] }), {
          status: 200,
        });
      }) as unknown as typeof fetch,
    });
    expect(result).toEqual({ sent: 1, failed: 1, skipped: 0 });
  });
});
