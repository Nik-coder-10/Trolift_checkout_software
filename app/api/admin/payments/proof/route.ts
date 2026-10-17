import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/auth/session";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { downloadPaymentProof } from "@/lib/storage/payment-proofs";

/**
 * GET /api/admin/payments/proof?path=<objectPath> — stream a payment
 * screenshot to an authenticated admin. The bucket is private, so the
 * browser <img> on the verification inbox goes through this route;
 * the object path is strictly validated (single folder + file, image
 * extension only) before it reaches storage.
 */

const PROOF_PATH = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(png|jpe?g|webp)$/;

export const GET = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  await requireAdmin();
  const url = new URL(req.url);
  const path = url.searchParams.get("path") ?? "";
  if (!PROOF_PATH.test(path)) {
    throw new AppError("BAD_REQUEST", "Invalid proof path.", 400);
  }
  const proof = await downloadPaymentProof(path);
  if (!proof) {
    throw new AppError("NOT_FOUND", "Screenshot not found.", 404);
  }
  return new Response(new Uint8Array(proof.bytes), {
    status: 200,
    headers: {
      "Content-Type": proof.contentType,
      "Content-Length": String(proof.bytes.length),
      "Cache-Control": "private, no-store",
    },
  });
});
