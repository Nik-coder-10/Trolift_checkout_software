import { ok } from "@/lib/api/response";
import { withErrorHandling } from "@/lib/api/handler";

export const GET = withErrorHandling(async (_req: Request) => {
  return ok({
    status: "ok",
    service: "trolift-platform",
    time: new Date().toISOString(),
  });
});
