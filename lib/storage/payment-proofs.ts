import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppError } from "@/lib/api/errors";
import { MAX_PROOF_BYTES, isValidProofMimeType } from "@/lib/payments/claims";

/**
 * Payment-proof screenshot handling (server-only).
 *
 * The customer uploads ONE screenshot of the completed UPI payment
 * with their claim. Files land in the private `payment-proofs`
 * bucket (service-role only — no public URL, no policies). The API
 * validates by SNIFFING magic bytes: a declared content-type or file
 * extension is never trusted. The stored object path is recorded on
 * payments.proof_path and attached to the owner's verification email.
 * Size/MIME limits live in lib/payments/claims (shared with the form).
 */

export const PAYMENT_PROOF_BUCKET = "payment-proofs";

export type ProofImageType = "image/png" | "image/jpeg" | "image/webp";

const PROOF_EXTENSIONS: Record<ProofImageType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Magic-byte sniffing: PNG / JPEG / WebP (RIFF....WEBP) only. */
export function sniffProofImageType(
  bytes: Uint8Array,
): ProofImageType | null {
  if (bytes.length >= 8) {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (png.every((b, i) => bytes[i] === b)) return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export interface ProofFile {
  bytes: Uint8Array;
}

/**
 * Validate the uploaded screenshot. Throws 422 with a customer-facing
 * message on anything that is not a PNG/JPEG/WebP image ≤ 5 MB.
 * Returns the SNIFFED type — the caller stores and attaches the file
 * under that type regardless of what the client declared.
 */
export function assertValidProofFile(file: ProofFile): ProofImageType {
  if (file.bytes.length === 0) {
    throw AppError.validation("Attach the screenshot of your payment.");
  }
  if (file.bytes.length > MAX_PROOF_BYTES) {
    throw AppError.validation(
      "The payment screenshot must be 5 MB or smaller.",
    );
  }
  const type = sniffProofImageType(file.bytes);
  if (type === null) {
    throw AppError.validation(
      "The payment screenshot must be a PNG, JPEG or WebP image.",
    );
  }
  return type;
}

export interface StoredProof {
  /** Object path inside the bucket (recorded on payments.proof_path). */
  path: string;
  contentType: ProofImageType;
  size: number;
}

/**
 * Upload a validated screenshot under the order's folder. The object
 * name is random, so a retry stores a fresh copy instead of silently
 * overwriting the first claim's evidence.
 */
export async function uploadPaymentProof(
  orderId: string,
  file: ProofFile,
  contentType: ProofImageType,
): Promise<StoredProof> {
  const ext = PROOF_EXTENSIONS[contentType];
  const path = `${orderId}/${randomUUID()}.${ext}`;
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(PAYMENT_PROOF_BUCKET)
    .upload(path, Buffer.from(file.bytes), {
      contentType,
      upsert: false,
    });
  if (error) {
    throw AppError.serviceUnavailable(
      "The payment screenshot could not be saved. Please try again.",
    );
  }
  return { path, contentType, size: file.bytes.length };
}

/** Download a stored screenshot (owner email attachment). */
export async function downloadPaymentProof(
  path: string,
): Promise<{ bytes: Buffer; contentType: ProofImageType } | null> {
  const lower = path.toLowerCase();
  const contentType: ProofImageType | undefined = (
    Object.entries(PROOF_EXTENSIONS) as Array<[ProofImageType, string]>
  ).find(([, ext]) => lower.endsWith(`.${ext}`))?.[0];
  if (!contentType) return null;
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(PAYMENT_PROOF_BUCKET)
    .download(path);
  if (error || !data) return null;
  const bytes = Buffer.from(await data.arrayBuffer());
  return { bytes, contentType };
}
