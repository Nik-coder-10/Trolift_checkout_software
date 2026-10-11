import { badRequest, ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { listShipments } from "@/lib/shipments/service";
import type { ShipmentStatus } from "@/lib/shipments/types";

const STATUSES: ReadonlyArray<ShipmentStatus> = [
  "not_ready",
  "ready",
  "dispatched",
  "in_transit",
  "delivered",
];

export const GET = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  const url = new URL(req.url);
  const status = url.searchParams.get("status") as ShipmentStatus | null;
  const search = url.searchParams.get("search") ?? "";
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "15");
  if (status && !STATUSES.includes(status)) {
    return badRequest("Unknown shipment status.");
  }
  const result = await listShipments({
    status: status ?? undefined,
    search: search || undefined,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    pageSize: Math.min(Math.max(pageSize, 1), 100),
  });
  return ok(result);
});
