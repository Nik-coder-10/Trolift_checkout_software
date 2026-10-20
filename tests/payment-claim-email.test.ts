import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/storage/payment-proofs", () => ({
  PAYMENT_PROOF_BUCKET: "payment-proofs",
  sniffProofImageType: vi.fn(() => "image/png"),
  assertValidProofFile: vi.fn(() => "image/png"),
  uploadPaymentProof: vi.fn(),
  downloadPaymentProof: vi.fn(async () => null),
}));

import { buildPaymentClaimMessage } from "@/lib/notifications/payment-claim-message";
import { notifyPaymentClaimSubmitted } from "@/lib/notifications/payment-notifications";
import { downloadPaymentProof } from "@/lib/storage/payment-proofs";

const INPUT = {
  orderNumber: "TS-261016-0042",
  customerName: "Anita Sharma",
  customerPhone: "+919876543210",
  customerEmail: "anita@example.com",
  reference: "UTR123456789012",
  totalPaise: 2087000,
  hasScreenshot: true,
};

describe("buildPaymentClaimMessage", () => {
  it("carries client details, UTR and the amount", () => {
    const body = buildPaymentClaimMessage(INPUT);
    expect(body).toContain("Payment submitted — TS-261016-0042");
    expect(body).toContain("Anita Sharma");
    expect(body).toContain("+919876543210");
    expect(body).toContain("anita@example.com");
    expect(body).toContain("UTR123456789012");
    expect(body).toContain("₹20,870.00");
    expect(body).toContain("screenshot");
    expect(body).toContain("admin panel");
  });

  it("omits a blank email line", () => {
    const body = buildPaymentClaimMessage({ ...INPUT, customerEmail: null });
    expect(body).not.toContain("Email:");
    expect(body).toContain("+919876543210");
  });

  it("flags a missing screenshot for manual fetch", () => {
    const body = buildPaymentClaimMessage({ ...INPUT, hasScreenshot: false });
    expect(body).toContain("could not be attached");
    expect(body).toContain("payments.proof_path");
  });

  it("renders a screenshot-only claim when no UTR was submitted", () => {
    const body = buildPaymentClaimMessage({ ...INPUT, reference: null });
    expect(body).toContain("Payment submitted — TS-261016-0042");
    expect(body).toContain("Not provided");
    expect(body).toContain("verify from the screenshot");
    expect(body).toContain("The payment screenshot submitted by the client is attached.");
    // The UTR line never invents a value when the customer omitted it.
    expect(body).not.toContain("UTR123456789012");
  });
});

describe("notifyPaymentClaimSubmitted", () => {
  const saved = { ...process.env };
  let sent: Array<{
    to: string;
    subject: string;
    text: string;
    attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
  }> = [];

  const sendMail = async (msg: {
    to: string;
    subject: string;
    text: string;
    attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
  }) => {
    sent.push(msg);
    return { messageId: "test" };
  };

  beforeEach(() => {
    sent = [];
    process.env.EMAIL_PROVIDER = "smtp";
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "shop@example.com";
    process.env.SMTP_PASS = "secret";
    process.env.ORDER_NOTIFICATION_EMAIL = "owner@trolift.example";
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("emails the owner with the screenshot attached", async () => {
    vi.mocked(downloadPaymentProof).mockResolvedValueOnce({
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      contentType: "image/png",
    });
    const result = await notifyPaymentClaimSubmitted(
      {
        orderNumber: INPUT.orderNumber,
        customer: {
          name: INPUT.customerName,
          phone: INPUT.customerPhone,
          email: INPUT.customerEmail,
        },
        reference: INPUT.reference,
        totalPaise: INPUT.totalPaise,
        proofPath: "order-1/proof.png",
      },
      { sendMail },
    );
    expect(result).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("owner@trolift.example");
    expect(sent[0]!.subject).toContain("TS-261016-0042");
    expect(sent[0]!.subject).toContain("UTR123456789012");
    expect(sent[0]!.text).toContain("Anita Sharma");
    expect(sent[0]!.attachments).toHaveLength(1);
    expect(sent[0]!.attachments![0]!.filename).toBe(
      "payment-proof-TS-261016-0042.png",
    );
    expect(sent[0]!.attachments![0]!.contentType).toBe("image/png");
  });

  it("still emails the owner when the screenshot download fails", async () => {
    vi.mocked(downloadPaymentProof).mockResolvedValueOnce(null);
    const result = await notifyPaymentClaimSubmitted(
      {
        orderNumber: INPUT.orderNumber,
        customer: {
          name: INPUT.customerName,
          phone: INPUT.customerPhone,
          email: INPUT.customerEmail,
        },
        reference: INPUT.reference,
        totalPaise: INPUT.totalPaise,
        proofPath: "order-1/proof.png",
      },
      { sendMail },
    );
    expect(result).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.attachments).toBeUndefined();
    expect(sent[0]!.text).toContain("could not be attached");
    expect(sent[0]!.text).toContain("Anita Sharma");
  });

  it("drops the UTR from the subject when the claim had no reference", async () => {
    vi.mocked(downloadPaymentProof).mockResolvedValueOnce({
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      contentType: "image/png",
    });
    const result = await notifyPaymentClaimSubmitted(
      {
        orderNumber: INPUT.orderNumber,
        customer: {
          name: INPUT.customerName,
          phone: INPUT.customerPhone,
          email: INPUT.customerEmail,
        },
        reference: null,
        totalPaise: INPUT.totalPaise,
        proofPath: "order-1/proof.png",
      },
      { sendMail },
    );
    expect(result).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe("Payment submitted — TS-261016-0042");
    expect(sent[0]!.text).toContain("Not provided");
    expect(sent[0]!.text).toContain("The payment screenshot submitted by the client is attached.");
  });

  it("skips silently when no recipient is configured", async () => {
    delete process.env.ORDER_NOTIFICATION_EMAIL;
    const result = await notifyPaymentClaimSubmitted(
      {
        orderNumber: INPUT.orderNumber,
        customer: {
          name: INPUT.customerName,
          phone: INPUT.customerPhone,
          email: INPUT.customerEmail,
        },
        reference: INPUT.reference,
        totalPaise: INPUT.totalPaise,
        proofPath: "order-1/proof.png",
      },
      { sendMail },
    );
    expect(result).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(sent).toHaveLength(0);
  });
});
