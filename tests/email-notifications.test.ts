import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildCustomerOrderMessage,
  buildOwnerOrderMessage,
  deliveryStatusLine,
  rupees,
  type OrderMessageInput,
} from "@/lib/notifications/order-message";
import {
  emailConfigured,
  emailProvider,
  getOrderNotificationRecipient,
  sendEmailMessages,
} from "@/lib/notifications/email";
import { notifyOrderPlaced } from "@/lib/notifications/order-notifications";

const KEYS = [
  "EMAIL_PROVIDER",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "EMAIL_FROM",
  "ORDER_NOTIFICATION_EMAIL",
  "PAYMENT_WINDOW_HOURS",
  "PAYMENT_QR_PATH",
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

const EMAIL_ENV = {
  EMAIL_PROVIDER: "smtp",
  SMTP_USER: "trolift@example.com",
  SMTP_PASS: "test-app-password",
  ORDER_NOTIFICATION_EMAIL: "bizwise.ops@gmail.com",
} as const;

const INPUT: OrderMessageInput = {
  orderNumber: "TS-000123",
  customerName: "Rahul Sharma",
  customerPhone: "+919876543210",
  customerEmail: "rahul@example.com",
  businessName: "Sharma Traders",
  billingAddress: "12 MG Road, Pune, Maharashtra 411001",
  gstin: "27ABCDE1234F1Z0",
  lines: [
    { productName: "Hydraulic Hand Pallet Truck 2500 kg", quantity: 1, lineTotalPaise: 2499900 },
    { productName: "Heavy-Duty Platform Trolley 500 kg", quantity: 2, lineTotalPaise: 1259800 },
  ],
  taxPaise: 573513,
  taxType: "cgst_sgst",
  deliveryPartnerName: "Delhivery",
  deliveryChargePaise: 0,
  etaDays: { min: 2, max: 4 },
  totalPaise: 3759700,
  discountPaise: 0,
  couponCode: null,
  pincode: "411001",
  shippingAddress: "Flat 7B, Sundar Villa, Kothrud, Pune 411038",
  paymentWindowHours: 24,
  siteUrl: "https://trolift.example",
  hasPaymentQr: true,
  quotationNumber: null,
};

describe("notification copy", () => {
  it("formats money in Indian groups with paise", () => {
    expect(rupees(316298000)).toBe("31,62,980.00");
    expect(rupees(45000)).toBe("450.00");
    expect(rupees(0)).toBe("0.00");
  });

  it("gives the customer their order, identity, contact and delivery status", () => {
    const text = buildCustomerOrderMessage(INPUT);
    expect(text).toContain("TS-000123");
    expect(text).toContain("Rahul Sharma");
    expect(text).toContain("Mobile: +919876543210");
    expect(text).toContain("Email: rahul@example.com");
    expect(text).toContain("Shipping: Flat 7B, Sundar Villa, Kothrud, Pune 411038");
    expect(text).toContain("Business: Sharma Traders");
    expect(text).toContain("Address: 12 MG Road, Pune, Maharashtra 411001");
    expect(text).toContain("GSTIN: 27ABCDE1234F1Z0");
    expect(text).toContain(
      "Hydraulic Hand Pallet Truck 2500 kg x1 - ₹24,999.00 (incl. GST & delivery)",
    );
    expect(text).toContain(
      "Heavy-Duty Platform Trolley 500 kg x2 - ₹12,598.00 (incl. GST & delivery)",
    );
    expect(text).toContain("GST included: ₹5,735.13 (CGST + SGST)");
    expect(text).toContain("Delivery: Included");
    expect(text).toContain("Total: ₹37,597.00");
    expect(text).not.toContain("Subtotal:");
    expect(text).toContain(
      "Pincode 411001 (Maharashtra): serviceable — Delhivery, ETA 5-6 business days, delivery included.",
    );
  });

  it("shows the redeem discount between delivery and the total it reduced", () => {
    const text = buildCustomerOrderMessage({
      ...INPUT,
      totalPaise: 3729700,
      discountPaise: 30000,
      couponCode: "FIRST300",
    });
    expect(text).toContain("Discount (FIRST300): -₹300.00");
    expect(text).toContain("Total: ₹37,297.00");
    expect(text.indexOf("Delivery: Included")).toBeLessThan(
      text.indexOf("Discount (FIRST300)"),
    );
    expect(text.indexOf("Discount (FIRST300)")).toBeLessThan(
      text.indexOf("Total: ₹37,297.00"),
    );
  });

  it("keeps the discount line out of orders that used no code", () => {
    const text = buildCustomerOrderMessage(INPUT);
    expect(text).not.toContain("Discount");
  });

  it("names the IGST component for inter-state orders", () => {
    const text = buildCustomerOrderMessage({ ...INPUT, taxType: "igst" });
    expect(text).toContain("GST included: ₹5,735.13 (IGST)");
  });

  it("asks for payment within the window and a screenshot reply", () => {
    const text = buildCustomerOrderMessage(INPUT);
    expect(text).toContain("please pay ₹37,597.00 within 24 hours");
    expect(text).toContain("UPI QR attached to this email");
    expect(text).toContain("reply to this email with the payment screenshot");
  });

  it("falls back to the payment link when no QR is attached", () => {
    const text = buildCustomerOrderMessage({ ...INPUT, hasPaymentQr: false });
    expect(text).toContain("payment link on the order status page");
    expect(text).not.toContain("UPI QR attached");
  });

  it("points the customer at My orders for status, payment and quotations", () => {
    const text = buildCustomerOrderMessage(INPUT);
    expect(text).toContain("My orders (status, payment & quotations): https://trolift.example/orders");
  });

  it("names the attached quotation in the customer's copy", () => {
    const text = buildCustomerOrderMessage({
      ...INPUT,
      quotationNumber: "QTN-TS0000000001",
    });
    expect(text).toContain("Quotation QTN-TS0000000001 is attached to this email.");
  });

  it("keeps the quotation line out of copies sent without one", () => {
    const text = buildCustomerOrderMessage(INPUT);
    expect(text).not.toContain("is attached");
  });

  it("names the attached quotation in the owner's copy too", () => {
    const text = buildOwnerOrderMessage({
      ...INPUT,
      quotationNumber: "QTN-TS0000000001",
    });
    expect(text).toContain("Quotation QTN-TS0000000001 is attached.");
    const plain = buildOwnerOrderMessage(INPUT);
    expect(plain).not.toContain("is attached");
  });

  it("omits business fields for individual orders", () => {
    const text = buildCustomerOrderMessage({
      ...INPUT,
      businessName: null,
      billingAddress: null,
      gstin: null,
    });
    expect(text).not.toContain("Business:");
    expect(text).not.toContain("Address:");
    expect(text).not.toContain("GSTIN:");
  });

  it("omits the email line when the customer gave no email", () => {
    const text = buildCustomerOrderMessage({ ...INPUT, customerEmail: null });
    expect(text).not.toContain("Email:");
  });

  it("gives the owner the customer's contact details too", () => {
    const text = buildOwnerOrderMessage(INPUT);
    expect(text).toContain("New order TS-000123 — ₹37,597.00 (payment pending)");
    expect(text).toContain("Mobile: +919876543210");
    expect(text).toContain("Email: rahul@example.com");
    expect(text).toContain("Shipping: Flat 7B, Sundar Villa, Kothrud, Pune 411038");
    expect(text).toContain("Business: Sharma Traders");
    expect(text).toContain("GST included: ₹5,735.13 (CGST + SGST)");
    expect(text).toContain("Delivery: Included");
    expect(text).toContain("Pincode 411001 (Maharashtra)");
    expect(text).toContain("Payable within 24 hours.");
    expect(text).toContain("payment screenshot");
  });

  it("names a not-deliverable pincode instead of inventing a status", () => {
    const status = deliveryStatusLine({ ...INPUT, pincode: "680522" });
    expect(status).toContain("Pincode 680522 (Kerala): not deliverable");
    expect(status).toContain("outside our delivery area");
  });

  it("promises the same 5-6 business days even when the rule carries no ETA", () => {
    const status = deliveryStatusLine({ ...INPUT, etaDays: null });
    expect(status).toContain("ETA 5-6 business days");
    expect(status).not.toMatch(/\d–\d days/);
  });

  it("uses the pincode the order was placed with, not the billing pincode", () => {
    const text = buildCustomerOrderMessage({ ...INPUT, pincode: "140407" });
    expect(text).toContain("Pincode 140407");
  });
});

describe("provider selection", () => {
  it("stays off unless credentials are present", () => {
    setEnv({});
    expect(emailProvider()).toBe("off");
    expect(emailConfigured()).toBe(false);
    setEnv({ SMTP_USER: "user" });
    expect(emailProvider()).toBe("off");
    setEnv({ SMTP_USER: "user", SMTP_PASS: "pass" });
    expect(emailProvider()).toBe("smtp");
    expect(emailConfigured()).toBe(true);
  });

  it("honours an explicit provider choice", () => {
    setEnv({ EMAIL_PROVIDER: "smtp" });
    expect(emailProvider()).toBe("smtp");
    setEnv({ ...EMAIL_ENV, EMAIL_PROVIDER: "off" });
    expect(emailProvider()).toBe("off");
  });

  it("reads the order notification recipient", () => {
    setEnv({ ORDER_NOTIFICATION_EMAIL: "bizwise.ops@gmail.com" });
    expect(getOrderNotificationRecipient()).toBe("bizwise.ops@gmail.com");
    setEnv({ ORDER_NOTIFICATION_EMAIL: "" });
    expect(getOrderNotificationRecipient()).toBeNull();
    setEnv({ ORDER_NOTIFICATION_EMAIL: "not-an-email" });
    expect(getOrderNotificationRecipient()).toBeNull();
  });
});

describe("sending", () => {
  it("sends nothing (and reports skipped) when unconfigured", async () => {
    setEnv({});
    let calls = 0;
    const outcomes = await sendEmailMessages(
      [{ to: "bizwise.ops@gmail.com", subject: "hi", body: "hi" }],
      {
        sendMail: (async () => {
          calls += 1;
        }) as never,
      },
    );
    expect(calls).toBe(0);
    expect(outcomes).toEqual([
      {
        to: "bizwise.ops@gmail.com",
        status: "skipped",
        detail: "Email provider is not configured.",
      },
    ]);
  });

  it("sends one email per message with correct fields", async () => {
    setEnv({ ...EMAIL_ENV });
    const calls: Array<{ from: string; to: string; subject: string; text: string }> = [];
    const outcomes = await sendEmailMessages(
      [
        { to: "bizwise.ops@gmail.com", subject: "Order Confirmation — TS-000123", body: "customer copy" },
        { to: "bizwise.ops@gmail.com", subject: "New Order — TS-000123", body: "owner copy" },
      ],
      {
        sendMail: (async (msg: { from: string; to: string; subject: string; text: string }) => {
          calls.push(msg);
        }) as never,
      },
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]!.from).toBe("trolift@example.com");
    expect(calls[0]!.to).toBe("bizwise.ops@gmail.com");
    expect(calls[0]!.subject).toBe("Order Confirmation — TS-000123");
    expect(calls[0]!.text).toBe("customer copy");
    expect(calls[1]!.subject).toBe("New Order — TS-000123");
    expect(calls[1]!.text).toBe("owner copy");
    expect(outcomes.map((o) => o.status)).toEqual(["sent", "sent"]);
  });

  it("uses EMAIL_FROM when configured", async () => {
    setEnv({ ...EMAIL_ENV, EMAIL_FROM: "Trolift Orders <orders@trolift.in>" });
    let from = "";
    await sendEmailMessages(
      [{ to: "bizwise.ops@gmail.com", subject: "s", body: "b" }],
      {
        sendMail: (async (msg: { from: string }) => {
          from = msg.from;
        }) as never,
      },
    );
    expect(from).toBe("Trolift Orders <orders@trolift.in>");
  });

  it("does not retry permanent errors", async () => {
    setEnv({ ...EMAIL_ENV });
    let attempts = 0;
    const outcomes = await sendEmailMessages(
      [{ to: "bizwise.ops@gmail.com", subject: "s", body: "b" }],
      {
        sendMail: (async () => {
          attempts += 1;
          const err = new Error("535 5.7.8 Username and Password not accepted") as Error & { code?: string };
          err.code = "EAUTH";
          throw err;
        }) as never,
        timeoutMs: 50,
      },
    );
    expect(attempts).toBe(1);
    expect(outcomes[0]!.status).toBe("failed");
    expect(outcomes[0]!.detail).toContain("535");
  });

  it("retries transient errors with backoff", async () => {
    setEnv({ ...EMAIL_ENV });
    let attempts = 0;
    const outcomes = await sendEmailMessages(
      [{ to: "bizwise.ops@gmail.com", subject: "s", body: "b" }],
      {
        sendMail: (async () => {
          attempts += 1;
          if (attempts < 3) {
            const err = new Error("Connection timeout") as Error & { code?: string };
            err.code = "ETIMEDOUT";
            throw err;
          }
        }) as never,
        timeoutMs: 50,
      },
    );
    expect(attempts).toBe(3);
    expect(outcomes[0]!.status).toBe("sent");
  });

  it("gives up after max retries on persistent failures", async () => {
    setEnv({ ...EMAIL_ENV });
    let attempts = 0;
    const outcomes = await sendEmailMessages(
      [{ to: "bizwise.ops@gmail.com", subject: "s", body: "b" }],
      {
        sendMail: (async () => {
          attempts += 1;
          const err = new Error("Connection timeout") as Error & { code?: string };
          err.code = "ETIMEDOUT";
          throw err;
        }) as never,
        timeoutMs: 50,
      },
    );
    expect(attempts).toBe(3);
    expect(outcomes[0]!.status).toBe("failed");
  });

  it("reports transport failures without throwing", async () => {
    setEnv({ ...EMAIL_ENV });
    const outcomes = await sendEmailMessages(
      [{ to: "bizwise.ops@gmail.com", subject: "s", body: "b" }],
      {
        sendMail: (async () => {
          throw new Error("socket hang up");
        }) as never,
        timeoutMs: 50,
      },
    );
    expect(outcomes[0]!.status).toBe("failed");
    expect(outcomes[0]!.detail).toContain("socket hang up");
  });
});

describe("order notification orchestration", () => {
  const ORDER = {
    orderNumber: "TS-000123",
    customer: {
      name: "Rahul Sharma",
      phone: "+919876543210",
      email: "rahul@example.com" as string | null,
    },
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
    taxPaise: 96086,
    taxType: "cgst_sgst" as const,
    deliveryPartnerName: "Delhivery",
    deliveryChargePaise: 0,
    etaDays: null,
    totalPaise: 629900,
    discountPaise: 0,
    couponCode: null,
    pincode: "411001",
    shippingAddress: "Flat 7B, Sundar Villa, Kothrud, Pune 411038",
  };

  it("skips loudly (but not fatally) when email is unconfigured", async () => {
    setEnv({ ORDER_NOTIFICATION_EMAIL: "bizwise.ops@gmail.com" });
    const result = await notifyOrderPlaced(ORDER, {
      sendMail: (async () => {
        throw new Error("must not be called");
      }) as never,
    });
    expect(result).toEqual({ sent: 0, failed: 0, skipped: 2 });
  });

  it("emails the customer their own copy and the owner the alert", async () => {
    setEnv({ ...EMAIL_ENV, PAYMENT_WINDOW_HOURS: "24" });
    const recipients: string[] = [];
    const subjects: string[] = [];
    const result = await notifyOrderPlaced(ORDER, {
      sendMail: (async (msg: { to: string; subject: string }) => {
        recipients.push(msg.to);
        subjects.push(msg.subject);
      }) as never,
    });
    expect(result).toEqual({ sent: 2, failed: 0, skipped: 0 });
    // Customer confirmation goes to the customer's email; the owner
    // alert goes to ORDER_NOTIFICATION_EMAIL — never the reverse.
    expect(recipients).toEqual(["rahul@example.com", "bizwise.ops@gmail.com"]);
    expect(subjects[0]).toContain("Order Confirmation");
    expect(subjects[1]).toContain("New Order");
  });

  it("attaches the payment QR to the customer copy only", async () => {
    setEnv({ ...EMAIL_ENV, PAYMENT_QR_PATH: "images/logo.png" });
    const byRecipient: Record<string, Array<{ filename: string; contentType: string }>> = {};
    await notifyOrderPlaced(ORDER, {
      sendMail: (async (msg: { to: string; attachments?: Array<{ filename: string; contentType: string }> }) => {
        byRecipient[msg.to] = msg.attachments ?? [];
      }) as never,
    });
    // The customer pays us — they get the QR. We never pay ourselves,
    // so the owner's copy carries no QR (and no quotation here).
    expect(byRecipient["rahul@example.com"]).toHaveLength(1);
    expect(byRecipient["rahul@example.com"]![0]!.filename).toBe("trolift-payment-qr.png");
    expect(byRecipient["rahul@example.com"]![0]!.contentType).toBe("image/png");
    expect(byRecipient["bizwise.ops@gmail.com"]).toEqual([]);
  });

  it("attaches the quotation PDF to both copies, with the QR only on the customer's", async () => {
    setEnv({ ...EMAIL_ENV, PAYMENT_QR_PATH: "images/logo.png" });
    const pdf = Buffer.from("%PDF-1.7 quotation");
    const byRecipient: Record<string, Array<{ filename: string; contentType: string }>> = {};
    await notifyOrderPlaced(
      { ...ORDER, quotation: { number: "QTN-TS0000000001", content: pdf } },
      {
        sendMail: (async (msg: { to: string; attachments?: Array<{ filename: string; contentType: string }> }) => {
          byRecipient[msg.to] = msg.attachments ?? [];
        }) as never,
      },
    );
    const customer = byRecipient["rahul@example.com"] ?? [];
    const owner = byRecipient["bizwise.ops@gmail.com"] ?? [];
    expect(customer.map((a) => a.filename)).toEqual([
      "trolift-payment-qr.png",
      "QTN-TS0000000001.pdf",
    ]);
    expect(customer[1]!.contentType).toBe("application/pdf");
    // Owner: the quotation — never the QR.
    expect(owner.map((a) => a.filename)).toEqual(["QTN-TS0000000001.pdf"]);
  });

  it("attaches the quotation even when the QR image is missing", async () => {
    setEnv({ ...EMAIL_ENV, PAYMENT_QR_PATH: "images/does-not-exist.png" });
    const pdf = Buffer.from("%PDF-1.7 quotation");
    const byRecipient: Record<string, Array<{ filename: string }>> = {};
    await notifyOrderPlaced(
      { ...ORDER, quotation: { number: "QTN-TS0000000002", content: pdf } },
      {
        sendMail: (async (msg: { to: string; attachments?: Array<{ filename: string }> }) => {
          byRecipient[msg.to] = msg.attachments ?? [];
        }) as never,
      },
    );
    expect(byRecipient["rahul@example.com"]?.map((a) => a.filename)).toEqual([
      "QTN-TS0000000002.pdf",
    ]);
    expect(byRecipient["bizwise.ops@gmail.com"]?.map((a) => a.filename)).toEqual([
      "QTN-TS0000000002.pdf",
    ]);
  });

  it("still sends when the QR image is missing", async () => {
    setEnv({ ...EMAIL_ENV, PAYMENT_QR_PATH: "images/does-not-exist.png" });
    let calls = 0;
    const result = await notifyOrderPlaced(ORDER, {
      sendMail: (async (msg: { attachments?: unknown }) => {
        calls += 1;
        expect(msg.attachments).toBeUndefined();
      }) as never,
    });
    expect(calls).toBe(2);
    expect(result).toEqual({ sent: 2, failed: 0, skipped: 0 });
  });

  it("skips the customer copy when the customer left no email", async () => {
    setEnv({ ...EMAIL_ENV });
    const recipients: string[] = [];
    const result = await notifyOrderPlaced(
      { ...ORDER, customer: { ...ORDER.customer, email: null } },
      {
        sendMail: (async (msg: { to: string }) => {
          recipients.push(msg.to);
        }) as never,
      },
    );
    expect(result).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(recipients).toEqual(["bizwise.ops@gmail.com"]);
  });

  it("still sends the customer copy when the notification email is missing", async () => {
    setEnv({
      SMTP_USER: EMAIL_ENV.SMTP_USER,
      SMTP_PASS: EMAIL_ENV.SMTP_PASS,
    });
    let calls = 0;
    const result = await notifyOrderPlaced(ORDER, {
      sendMail: (async () => {
        calls += 1;
      }) as never,
    });
    expect(calls).toBe(1);
    expect(result).toEqual({ sent: 1, failed: 0, skipped: 0 });
  });

  it("reports per-recipient failures without failing the order", async () => {
    setEnv({ ...EMAIL_ENV });
    let call = 0;
    const result = await notifyOrderPlaced(ORDER, {
      sendMail: (async () => {
        call += 1;
        if (call === 1) {
          throw new Error("535 auth failed");
        }
      }) as never,
    });
    expect(result).toEqual({ sent: 1, failed: 1, skipped: 0 });
  });
});
