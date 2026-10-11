import { revalidatePath } from "next/cache";
import { badRequest, ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { setPartnerActive } from "@/lib/admin/delivery";

/** POST …/partners/[id]/active — activate/deactivate (no deletes). */
export const POST = withErrorHandling(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  const { id } = await params;
  let body: unknown;
  try {
    body = (await req.json()) as unknown;
  } catch {
    throw new AppError("BAD_REQUEST", "Request body must be JSON.", 400);
  }
  const isActive =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)["isActive"]
      : undefined;
  if (typeof isActive !== "boolean") {
    return badRequest("isActive must be true or false.");
  }
  await setPartnerActive(id, isActive);
  revalidatePath("/admin/delivery");
  return ok({ id, isActive });
});
