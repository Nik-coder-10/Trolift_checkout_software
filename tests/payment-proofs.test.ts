import { describe, expect, it, vi } from "vitest";

// server-only modules throw outside the Next server runtime by design.
vi.mock("server-only", () => ({}));

import {
  MAX_PROOF_BYTES,
  PROOF_MIME_TYPES,
  isValidProofMimeType,
} from "@/lib/payments/claims";
import {
  PAYMENT_PROOF_BUCKET,
  assertValidProofFile,
  sniffProofImageType,
} from "@/lib/storage/payment-proofs";
import { AppError } from "@/lib/api/errors";

// Minimal but real magic-byte prefixes (the validator sniffs, it does
// not decode — a full valid file is not required).
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0,
]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
const TEXT = new TextEncoder().encode("not an image at all");

describe("sniffProofImageType", () => {
  it("recognises PNG, JPEG and WebP magic bytes", () => {
    expect(sniffProofImageType(PNG)).toBe("image/png");
    expect(sniffProofImageType(JPEG)).toBe("image/jpeg");
    expect(sniffProofImageType(WEBP)).toBe("image/webp");
  });

  it("rejects other formats and truncated buffers", () => {
    expect(sniffProofImageType(GIF)).toBeNull();
    expect(sniffProofImageType(TEXT)).toBeNull();
    expect(sniffProofImageType(new Uint8Array(0))).toBeNull();
    expect(sniffProofImageType(new Uint8Array([0x89, 0x50]))).toBeNull();
    // "RIFF" without the WEBP marker is a WAV/AVI/etc — not accepted.
    expect(
      sniffProofImageType(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]),
      ),
    ).toBeNull();
  });
});

describe("assertValidProofFile", () => {
  it("accepts the three supported image types", () => {
    expect(assertValidProofFile({ bytes: PNG })).toBe("image/png");
    expect(assertValidProofFile({ bytes: JPEG })).toBe("image/jpeg");
    expect(assertValidProofFile({ bytes: WEBP })).toBe("image/webp");
  });

  it("rejects an empty upload", () => {
    expect(() => assertValidProofFile({ bytes: new Uint8Array(0) })).toThrowError(
      AppError,
    );
  });

  it("rejects files over the 5 MB cap", () => {
    const oversized = new Uint8Array(MAX_PROOF_BYTES + 1);
    oversized.set(PNG);
    expect(() => assertValidProofFile({ bytes: oversized })).toThrowError(
      /5 MB/,
    );
  });

  it("rejects non-image bytes with a customer-facing message", () => {
    expect(() => assertValidProofFile({ bytes: TEXT })).toThrowError(
      /PNG, JPEG or WebP/,
    );
    expect(() => assertValidProofFile({ bytes: GIF })).toThrowError(AppError);
  });

  it("keeps the shared limits in sync with the client form", () => {
    expect(MAX_PROOF_BYTES).toBe(5 * 1024 * 1024);
    expect(PROOF_MIME_TYPES).toEqual(["image/png", "image/jpeg", "image/webp"]);
    expect(isValidProofMimeType("image/png")).toBe(true);
    expect(isValidProofMimeType("image/gif")).toBe(false);
    expect(PAYMENT_PROOF_BUCKET).toBe("payment-proofs");
  });
});
