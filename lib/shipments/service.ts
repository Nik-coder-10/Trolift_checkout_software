import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { AppError } from "@/lib/api/errors";
import { logOrderEvent } from "@/lib/admin/orders";
import { canTransition } from "@/lib/orders/transitions";
import { canTransitionShipment, orderStatusForShipment } from "@/lib/shipments/types";
import { requireAdmin } from "@/lib/auth/session";
import type {
  Shipment,
  ShipmentDetail,
  ShipmentListItem,
  ShipmentStatus,
} from "@/lib/shipments/types";

const TRACKING_REF_MAX = 60;
const TRACKING_REF_PATTERN = /^[A-Za-z0-9\-_]+$/;

function validateTrackingReference(ref: string): void {
  if (ref.length > TRACKING_REF_MAX) {
    throw new AppError("VALIDATION_ERROR", `Tracking reference must be at most ${TRACKING_REF_MAX} characters.`, 422);
  }
  if (!TRACKING_REF_PATTERN.test(ref)) {
    throw new AppError("VALIDATION_ERROR", "Tracking reference may only contain letters, numbers, hyphens and underscores.", 422);
  }
}

/**
 * Admin-only reads. Both functions use the service-role client (they
 * join customer PII), so each starts with requireAdmin() — exactly
 * like every other entry point in this module. Without this gate the
 * admin shipments API would answer unauthenticated callers.
 */
export async function getShipmentByOrderId(orderId: string): Promise<Shipment | null> {
  await requireAdmin();
  const client = createAdminClient();
  const { data, error } = await client
    .from("shipments")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not load shipment.", 500);
  }
  return data as unknown as Shipment | null;
}

export async function getShipmentDetail(shipmentId: string): Promise<ShipmentDetail | null> {
  await requireAdmin();
  const client = createAdminClient();
  const { data, error } = await client
    .from("shipments")
    .select(
      "*,orders!inner(order_number,delivery_pincode,order_status,total_amount,customers!inner(name,phone))",
    )
    .eq("id", shipmentId)
    .maybeSingle();
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not load shipment.", 500);
  }
  if (!data) return null;
  const row = data as unknown as {
    id: string;
    order_id: string;
    delivery_partner_id: string | null;
    tracking_reference: string | null;
    dispatch_status: ShipmentStatus;
    dispatched_at: string | null;
    expected_delivery_date: string | null;
    delivered_at: string | null;
    dispatch_notes: string | null;
    created_at: string;
    updated_at: string;
    orders: {
      order_number: string;
      delivery_pincode: string;
      order_status: string;
      total_amount: string;
      customers: { name: string; phone: string };
    };
  };
  return {
    id: row.id,
    orderId: row.order_id,
    deliveryPartnerId: row.delivery_partner_id,
    trackingReference: row.tracking_reference,
    dispatchStatus: row.dispatch_status,
    dispatchedAt: row.dispatched_at,
    expectedDeliveryDate: row.expected_delivery_date,
    deliveredAt: row.delivered_at,
    dispatchNotes: row.dispatch_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    orderNumber: row.orders.order_number,
    customerName: row.orders.customers.name,
    customerPhone: row.orders.customers.phone,
    deliveryPincode: row.orders.delivery_pincode,
    deliveryPartnerName: null,
    orderStatus: row.orders.order_status as ShipmentDetail["orderStatus"],
    totalPaise: Math.round(Number(row.orders.total_amount) * 100),
  };
}

export async function listShipments(query: {
  status?: ShipmentStatus;
  search?: string;
  page: number;
  pageSize: number;
}): Promise<{ shipments: ShipmentListItem[]; total: number }> {
  await requireAdmin();
  const client = await createClient();
  let builder = client
    .from("shipments")
    .select(
      "id,order_id,dispatch_status,tracking_reference,dispatched_at,expected_delivery_date,created_at,orders!inner(order_number,delivery_pincode,customers!inner(name))",
      { count: "exact" },
    );
  if (query.status) {
    builder = builder.eq("dispatch_status", query.status);
  }
  if (query.search) {
    const pattern = `%${query.search.replace(/[%_\\]/g, "")}%`;
    builder = builder.or(`orders.order_number.ilike.${pattern}`);
  }
  const from = (query.page - 1) * query.pageSize;
  const { data, error, count } = await builder
    .order("created_at", { ascending: false })
    .range(from, from + query.pageSize - 1);
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not load shipments.", 500);
  }
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    order_id: string;
    dispatch_status: ShipmentStatus;
    tracking_reference: string | null;
    dispatched_at: string | null;
    expected_delivery_date: string | null;
    created_at: string;
    orders: { order_number: string; delivery_pincode: string; customers: { name: string } };
  }>;
  return {
    shipments: rows.map((r) => ({
      id: r.id,
      orderId: r.order_id,
      orderNumber: r.orders.order_number,
      customerName: r.orders.customers.name,
      deliveryPincode: r.orders.delivery_pincode,
      deliveryPartnerName: null,
      dispatchStatus: r.dispatch_status,
      trackingReference: r.tracking_reference,
      dispatchedAt: r.dispatched_at,
      expectedDeliveryDate: r.expected_delivery_date,
      createdAt: r.created_at,
    })),
    total: count ?? 0,
  };
}

export async function createShipment(orderId: string): Promise<Shipment> {
  await requireAdmin();
  const client = await createClient();
  const { data: order, error: orderError } = await client
    .from("orders")
    .select("id,order_status")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError || !order) {
    throw new AppError("NOT_FOUND", "Order not found.", 404);
  }
  const orderRow = order as unknown as { id: string; order_status: string };
  if (orderRow.order_status !== "ready_for_dispatch") {
    throw new AppError(
      "BAD_REQUEST",
      "Shipment can only be created when the order is ready for dispatch.",
      409,
    );
  }
  const { data: existing } = await client
    .from("shipments")
    .select("id")
    .eq("order_id", orderId)
    .maybeSingle();
  if (existing) {
    throw new AppError("CONFLICT", "A shipment already exists for this order.", 409);
  }
  const { data, error } = await client
    .from("shipments")
    .insert({ order_id: orderId, dispatch_status: "not_ready" })
    .select("*")
    .maybeSingle();
  if (error || !data) {
    throw new AppError("INTERNAL_ERROR", "Could not create shipment.", 500);
  }
  return data as unknown as Shipment;
}

export async function updateShipmentStatus(
  shipmentId: string,
  toStatus: ShipmentStatus,
  input: {
    deliveryPartnerId?: string;
    trackingReference?: string;
    expectedDeliveryDate?: string;
    dispatchNotes?: string;
  },
): Promise<Shipment> {
  await requireAdmin();
  const client = await createClient();
  const { data: shipment, error: shipmentError } = await client
    .from("shipments")
    .select("*,orders!inner(id,order_status)")
    .eq("id", shipmentId)
    .maybeSingle();
  if (shipmentError || !shipment) {
    throw new AppError("NOT_FOUND", "Shipment not found.", 404);
  }
  const row = shipment as unknown as {
    id: string;
    order_id: string;
    dispatch_status: ShipmentStatus;
    orders: { id: string; order_status: string };
  };
  if (!canTransitionShipment(row.dispatch_status, toStatus)) {
    throw new AppError(
      "BAD_REQUEST",
      `Cannot move shipment from ${row.dispatch_status} to ${toStatus}.`,
      409,
    );
  }
  if (input.trackingReference !== undefined) {
    validateTrackingReference(input.trackingReference);
  }
  if (input.deliveryPartnerId) {
    const { data: partner } = await client
      .from("delivery_partners")
      .select("id")
      .eq("id", input.deliveryPartnerId)
      .maybeSingle();
    if (!partner) {
      throw new AppError("VALIDATION_ERROR", "Selected delivery partner does not exist.", 422);
    }
  }
  const updates: Record<string, unknown> = { dispatch_status: toStatus };
  if (input.deliveryPartnerId !== undefined) {
    updates.delivery_partner_id = input.deliveryPartnerId;
  }
  if (input.trackingReference !== undefined) {
    updates.tracking_reference = input.trackingReference;
  }
  if (input.expectedDeliveryDate !== undefined) {
    updates.expected_delivery_date = input.expectedDeliveryDate;
  }
  if (input.dispatchNotes !== undefined) {
    updates.dispatch_notes = input.dispatchNotes;
  }
  if (toStatus === "dispatched") {
    updates.dispatched_at = new Date().toISOString();
  }
  if (toStatus === "delivered") {
    updates.delivered_at = new Date().toISOString();
  }
  const { data, error } = await client
    .from("shipments")
    .update(updates)
    .eq("id", shipmentId)
    .select("*")
    .maybeSingle();
  if (error || !data) {
    throw new AppError("INTERNAL_ERROR", "Could not update shipment.", 500);
  }
  const newShipment = data as unknown as Shipment;
  const orderStatus = orderStatusForShipment(toStatus, row.orders.order_status as never);
  if (orderStatus && canTransition(row.orders.order_status as never, orderStatus)) {
    const { transitionOrderStatus } = await import("@/lib/admin/orders");
    await transitionOrderStatus(row.orders.id, orderStatus);
  }
  return newShipment;
}

export async function assignDeliveryPartner(
  shipmentId: string,
  partnerId: string,
): Promise<Shipment> {
  await requireAdmin();
  const client = await createClient();
  const { data: partner } = await client
    .from("delivery_partners")
    .select("id")
    .eq("id", partnerId)
    .maybeSingle();
  if (!partner) {
    throw new AppError("VALIDATION_ERROR", "Selected delivery partner does not exist.", 422);
  }
  const { data, error } = await client
    .from("shipments")
    .update({ delivery_partner_id: partnerId })
    .eq("id", shipmentId)
    .select("*")
    .maybeSingle();
  if (error || !data) {
    throw new AppError("INTERNAL_ERROR", "Could not assign delivery partner.", 500);
  }
  return data as unknown as Shipment;
}

export async function updateTrackingReference(
  shipmentId: string,
  reference: string,
): Promise<Shipment> {
  validateTrackingReference(reference);
  await requireAdmin();
  const client = await createClient();
  const { data, error } = await client
    .from("shipments")
    .update({ tracking_reference: reference })
    .eq("id", shipmentId)
    .select("*")
    .maybeSingle();
  if (error || !data) {
    throw new AppError("INTERNAL_ERROR", "Could not update tracking reference.", 500);
  }
  return data as unknown as Shipment;
}

export async function updateDispatchNotes(
  shipmentId: string,
  notes: string,
): Promise<Shipment> {
  await requireAdmin();
  const client = await createClient();
  const { data, error } = await client
    .from("shipments")
    .update({ dispatch_notes: notes })
    .eq("id", shipmentId)
    .select("*")
    .maybeSingle();
  if (error || !data) {
    throw new AppError("INTERNAL_ERROR", "Could not update dispatch notes.", 500);
  }
  return data as unknown as Shipment;
}
