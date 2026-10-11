import { afterEach, describe, expect, it, vi } from "vitest";

// server-only modules throw outside the Next server runtime by design;
// bypass that guard here so server logic is unit-testable (the guard
// still applies to real client bundles via the Next compiler).
vi.mock("server-only", () => ({}));
import { AppError } from "@/lib/api/errors";
import {
  canSubmitClaim,
  isValidPaymentReference,
  normalizePaymentReference,
} from "@/lib/payments/claims";
import { getPaymentProvider } from "@/lib/payments/provider";
import {
  buildUpiIntent,
  getOwnerUpi,
  getPaymentWindowHours,
  isValidUpiVpa,
} from "@/lib/payments/upi";
import type { OrderStatus, PaymentStatus } from "@/types";

const UPI_ID = "OWNER_UPI_ID";
const UPI_NAME = "OWNER_UPI_PAYEE_NAME";
const WINDOW = "PAYMENT_WINDOW_HOURS";

afterEach(() => {
  delete process.env[UPI_ID];
  delete process.env[UPI_NAME];
  delete process.env[WINDOW];
});

describe("UPI configuration", () => {
  it("throws a clear error when the UPI id is missing", () => {
    expect(() => getOwnerUpi()).toThrow("OWNER_UPI_ID is not configured");
  });

  it("reads id and name from the environment", () => {
    process.env[UPI_ID] = "trolift@upi";
    process.env[UPI_NAME] = "Trolift Solutions";
    expect(getOwnerUpi()).toEqual({
      payeeVpa: "trolift@upi",
      payeeName: "Trolift Solutions",
    });
  });

  it("trims the UPI id and rejects malformed VPAs", () => {
    process.env[UPI_ID] = "  trolift@upi  ";
    expect(getOwnerUpi().payeeVpa).toBe("trolift@upi");
    process.env[UPI_ID] = "not-a-vpa";
    expect(() => getOwnerUpi()).toThrow(/VPA/);
    process.env[UPI_ID] = "x@y";
    expect(() => getOwnerUpi()).toThrow(/VPA/);
  });

  it("validates VPA shapes", () => {
    expect(isValidUpiVpa("trolift@upi")).toBe(true);
    expect(isValidUpiVpa("name@bank")).toBe(true);
    expect(isValidUpiVpa("no-at-sign")).toBe(false);
    expect(isValidUpiVpa("@bank")).toBe(false);
    expect(isValidUpiVpa("a@b")).toBe(false);
  });

  it("configures the payment window with a safe default", () => {
    expect(getPaymentWindowHours()).toBe(48);
    process.env[WINDOW] = "72";
    expect(getPaymentWindowHours()).toBe(72);
    process.env[WINDOW] = "nonsense";
    expect(getPaymentWindowHours()).toBe(48);
  });
});

describe("UPI intent (what the QR encodes)", () => {
  const info = { payeeVpa: "trolift@upi", payeeName: "Trolift Solutions" };

  it("encodes the exact paise-derived amount in INR", () => {
    // 44150 paise total → am=441.50 (integer paise always exact).
    const uri = buildUpiIntent(info, 44150 / 100, "Trolift order TS-1", "TS-1");
    const params = new URLSearchParams(uri.replace("upi://pay?", ""));
    expect(params.get("pa")).toBe("trolift@upi");
    expect(params.get("pn")).toBe("Trolift Solutions");
    expect(params.get("am")).toBe("441.50");
    expect(params.get("cu")).toBe("INR");
    expect(params.get("tr")).toBe("TS-1");
  });

  it("formats paise totals without float drift", () => {
    const uri = buildUpiIntent(info, 2544900 / 100, "note");
    expect(new URLSearchParams(uri.replace("upi://pay?", "")).get("am")).toBe(
      "25449.00",
    );
  });

  it("refuses intents with bad VPAs or non-positive amounts", () => {
    expect(() =>
      buildUpiIntent({ payeeVpa: "bad", payeeName: "X" }, 100, "note"),
    ).toThrow(/VPA/);
    expect(() => buildUpiIntent(info, 0, "note")).toThrow(/amount/);
    expect(() => buildUpiIntent(info, -5, "note")).toThrow(/amount/);
  });
});

describe("provider intent (server-computed amount only)", () => {
  it("builds a real QR from the authoritative total", async () => {
    process.env[UPI_ID] = "trolift@upi";
    const intent = await getPaymentProvider().createPaymentIntent({
      orderId: "o1",
      orderNumber: "TS-261004-0001",
      amountPaise: 44150,
    });
    expect(intent.provider).toBe("upi_manual");
    expect(intent.amountPaise).toBe(44150);
    expect(intent.intentUri).toContain("am=441.50");
    expect(intent.qrDataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("fails loudly without UPI configuration", async () => {
    await expect(
      getPaymentProvider().createPaymentIntent({
        orderId: "o1",
        orderNumber: "TS-1",
        amountPaise: 100,
      }),
    ).rejects.toThrow("OWNER_UPI_ID is not configured");
  });

  it("verify/webhook stay unimplemented for manual UPI", async () => {
    const provider = getPaymentProvider();
    await expect(provider.verifyPayment({ orderId: "o1" })).rejects.toThrow(
      AppError,
    );
    await expect(provider.handleWebhook({})).rejects.toThrow(AppError);
  });
});

describe("payment references", () => {
  it("accepts UTR-shaped references", () => {
    expect(isValidPaymentReference("123456789012")).toBe(true);
    expect(isValidPaymentReference("ABCD1234EF")).toBe(true);
  });

  it("rejects short, long and special-character input", () => {
    expect(isValidPaymentReference("12345")).toBe(false);
    expect(isValidPaymentReference("x".repeat(31))).toBe(false);
    expect(isValidPaymentReference("UTR-123 456")).toBe(false);
    expect(isValidPaymentReference("")).toBe(false);
  });

  it("normalises for storage", () => {
    expect(normalizePaymentReference("  ab12cd34ef ")).toBe("AB12CD34EF");
  });
});

describe("claim transitions (a claim never pays)", () => {
  const ok: Array<[PaymentStatus, OrderStatus]> = [
    ["pending", "pending_payment"],
    ["pending", "draft"],
    ["failed", "pending_payment"],
  ];
  it.each(ok)("allows %s + %s", (payment, order) => {
    expect(canSubmitClaim(payment, order)).toBe(true);
  });

  const denied: Array<[PaymentStatus, OrderStatus]> = [
    ["submitted", "payment_submitted"],
    ["paid", "confirmed"],
    ["pending", "confirmed"],
    ["pending", "payment_submitted"],
    ["failed", "delivered"],
    ["refunded", "cancelled"],
    ["cancelled", "cancelled"],
  ];
  it.each(denied)("denies %s + %s", (payment, order) => {
    expect(canSubmitClaim(payment, order)).toBe(false);
  });
});
