import { badRequest, notFound, ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import {
  assignDeliveryPartner,
  createShipment,
  getShipmentDetail,
  updateDispatchNotes,
  updateShipmentStatus,
  updateTrackingReference,
} from "@/lib/shipments/service";
import type { ShipmentStatus } from "@/lib/shipments/types";

const STATUSES: ReadonlyArray<ShipmentStatus> = [
  "not_ready",
  "ready",
  "dispatched",
  "in_transit",
  "delivered",
];

export const GET = withErrorHandling(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  const { id } = await params;
  const shipment = await getShipmentDetail(id);
  if (!shipment) {
    return notFound("Shipment not found.");
  }
  return ok(shipment);
});

export const POST = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  let body: unknown;
  try {
    body = (await req.json()) as unknown;
  } catch {
    throw new AppError("BAD_REQUEST", "Request body must be JSON.", 400);
  }
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const action = String(record["action"] ?? "");
  const shipmentId = String(record["shipmentId"] ?? "");
  if (shipmentId === "") {
    return badRequest("A shipment is required.");
  }
  switch (action) {
    case "status": {
      const toStatus = String(record["toStatus"] ?? "") as ShipmentStatus;
      if (!STATUSES.includes(toStatus)) {
        return badRequest("Unknown target status.");
      }
      const result = await updateShipmentStatus(shipmentId, toStatus, {
        deliveryPartnerId: record["deliveryPartnerId"]
          ? String(record["deliveryPartnerId"])
          : undefined,
        trackingReference: record["trackingReference"]
          ? String(record["trackingReference"])
          : undefined,
        expectedDeliveryDate: record["expectedDeliveryDate"]
          ? String(record["expectedDeliveryDate"])
          : undefined,
        dispatchNotes: record["dispatchNotes"]
          ? String(record["dispatchNotes"])
          : undefined,
      });
      return ok(result);
    }
    case "assign_partner": {
      const partnerId = String(record["deliveryPartnerId"] ?? "");
      if (partnerId === "") {
        return badRequest("A delivery partner is required.");
      }
      const result = await assignDeliveryPartner(shipmentId, partnerId);
      return ok(result);
    }
    case "update_tracking": {
      const reference = String(record["trackingReference"] ?? "");
      if (reference === "") {
        return badRequest("Tracking reference is required.");
      }
      const result = await updateTrackingReference(shipmentId, reference);
      return ok(result);
    }
    case "update_notes": {
      const notes = String(record["dispatchNotes"] ?? "");
      const result = await updateDispatchNotes(shipmentId, notes);
      return ok(result);
    }
    default:
      return badRequest("Unknown action.");
  }
});
