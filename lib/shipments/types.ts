import type { OrderStatus } from "@/types";

export type ShipmentStatus =
  | "not_ready"
  | "ready"
  | "dispatched"
  | "in_transit"
  | "delivered";

export const SHIPMENT_STATUSES: ReadonlyArray<ShipmentStatus> = [
  "not_ready",
  "ready",
  "dispatched",
  "in_transit",
  "delivered",
] as const;

const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, ReadonlyArray<ShipmentStatus>> = {
  not_ready: ["ready"],
  ready: ["dispatched"],
  dispatched: ["in_transit", "delivered"],
  in_transit: ["delivered"],
  delivered: [],
};

export function canTransitionShipment(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return SHIPMENT_TRANSITIONS[from].includes(to);
}

export function isTerminalShipmentStatus(status: ShipmentStatus): boolean {
  return SHIPMENT_TRANSITIONS[status].length === 0;
}

/**
 * Map shipment status changes to corresponding order status changes.
 * Returns the order status that should be set, or null if no order change needed.
 */
export function orderStatusForShipment(
  shipmentStatus: ShipmentStatus,
  currentOrderStatus: OrderStatus,
): OrderStatus | null {
  switch (shipmentStatus) {
    case "ready":
      return currentOrderStatus === "packed" ? "ready_for_dispatch" : null;
    case "dispatched":
      return currentOrderStatus === "ready_for_dispatch" ? "dispatched" : null;
    case "delivered":
      return currentOrderStatus === "dispatched"
        ? "delivered"
        : null;
    default:
      return null;
  }
}

export interface Shipment {
  id: string;
  orderId: string;
  deliveryPartnerId: string | null;
  trackingReference: string | null;
  dispatchStatus: ShipmentStatus;
  dispatchedAt: string | null;
  expectedDeliveryDate: string | null;
  deliveredAt: string | null;
  dispatchNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShipmentDetail extends Shipment {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  deliveryPincode: string;
  deliveryPartnerName: string | null;
  orderStatus: OrderStatus;
  totalPaise: number;
}

export interface ShipmentListItem {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  deliveryPincode: string;
  deliveryPartnerName: string | null;
  dispatchStatus: ShipmentStatus;
  trackingReference: string | null;
  dispatchedAt: string | null;
  expectedDeliveryDate: string | null;
  createdAt: string;
}

export interface ShipmentActionInput {
  orderId: string;
  deliveryPartnerId?: string;
  trackingReference?: string;
  expectedDeliveryDate?: string;
  dispatchNotes?: string;
}
