import { revalidatePath } from "next/cache";
import { ok } from "@/lib/api/response";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { deleteWeightSlab } from "@/lib/admin/delivery";

/** DELETE /api/admin/delivery/slabs/[id] — remove a band (orders keep snapshots). */
export const DELETE = withErrorHandling(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  const { id } = await params;
  await deleteWeightSlab(id);
  revalidatePath("/admin/delivery");
  return ok({ id });
});
