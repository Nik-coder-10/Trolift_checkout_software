/**
 * Shared payment-proof fixtures for claim-route tests.
 *
 * The 1×1 transparent PNG is a real image (magic bytes intact) — the
 * API sniffs bytes, so a fake extension or declared type alone is
 * rejected. Claim requests are multipart/form-data by contract.
 *
 * Usage in test files (vi.mock factories are hoisted — import lazily):
 *
 *   vi.mock("@/lib/storage/payment-proofs", async () => {
 *     const { paymentProofsMock } = await import("@/tests/helpers/payment-proof");
 *     return paymentProofsMock();
 *   });
 */
import { vi } from "vitest";

export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

export function proofFile(name = "proof.png"): File {
  return new File([TINY_PNG], name, { type: "image/png" });
}

/** Multipart POST body for /api/payments/claim. */
export function claimFormData(
  fields: Record<string, string>,
  opts: { withProof?: boolean } = {},
): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (opts.withProof !== false) fd.set("screenshot", proofFile());
  return fd;
}

/** Multipart Request for /api/payments/claim (cookie header optional). */
export function claimMultipartRequest(
  fields: Record<string, string>,
  opts: { withProof?: boolean; cookie?: string } = {},
): Request {
  return new Request("http://localhost/api/payments/claim", {
    method: "POST",
    headers: opts.cookie ? { Cookie: opts.cookie } : undefined,
    body: claimFormData(fields, opts),
  });
}

/**
 * vi.mock factory body for @/lib/storage/payment-proofs — uploads
 * always succeed with a deterministic path; download returns null
 * unless overridden by the test. Functions are vi.fn so tests can
 * assert on calls or override per-case with mockImplementationOnce.
 */
export function paymentProofsMock() {
  return {
    PAYMENT_PROOF_BUCKET: "payment-proofs",
    sniffProofImageType: vi.fn(() => "image/png"),
    assertValidProofFile: vi.fn(() => "image/png"),
    uploadPaymentProof: vi.fn(async (orderId: string) => ({
      path: `${orderId}/proof.png`,
      contentType: "image/png",
      size: 67,
    })),
    downloadPaymentProof: vi.fn(async () => null),
  };
}

/** vi.mock factory body for @/lib/notifications/payment-notifications. */
export function paymentNotificationsMock() {
  return {
    notifyPaymentClaimSubmitted: vi.fn(async () => ({
      sent: 1,
      failed: 0,
      skipped: 0,
    })),
  };
}
