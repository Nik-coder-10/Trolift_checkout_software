"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PriceDisplay } from "@/components/ui/PriceDisplay";
import {
  OrderStatusBadge,
  PaymentStatusBadge,
} from "@/components/ui/StatusBadge";
import { canIssueQuotation } from "@/lib/quotations/data";
import type { OrderStatus, PaymentStatus } from "@/types";
import type { ApiResponse } from "@/types/api";

interface MyOrder {
  orderId: string;
  orderNumber: string;
  createdAt: string;
  totalPaise: number;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  deliveryPincode: string;
  deliveryPartnerName: string | null;
}

/**
 * Past orders by mobile number. The lookup response rotates a guest
 * session cookie for every listed order (HttpOnly), so each "View"
 * link below works immediately — the order UUID alone authorizes
 * nothing, the cookie does. Quotations stay downloadable while the
 * order is provisional; once paid, the invoice takes over.
 */
export function MyOrdersForm() {
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [searched, setSearched] = useState(false);
  const [orders, setOrders] = useState<MyOrder[] | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (phone.trim() === "") {
      setError("Enter the mobile number used for your orders.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/orders/my", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const json = (await res.json()) as ApiResponse<{ orders: MyOrder[] }>;
      if (!json.ok) {
        setError(json.error.message);
        return;
      }
      setOrders(json.data.orders);
      setSearched(true);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <form noValidate onSubmit={submit} aria-label="Find my orders">
        <Input
          label="Mobile number"
          name="my-orders-phone"
          autoComplete="tel"
          inputMode="tel"
          placeholder="10-digit mobile"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={error ?? undefined}
        />
        <div className="mt-3">
          <Button type="submit" loading={submitting} className="w-full sm:w-auto">
            Find my orders
          </Button>
        </div>
        <p className="mt-2 text-xs leading-5 text-zinc-500">
          Use the mobile number you entered at checkout. We restore order
          access on this device only.
        </p>
      </form>

      {searched && orders !== null ? (
        orders.length === 0 ? (
          <div className="mt-6">
            <Alert tone="info" title="No orders found">
              No orders exist for this mobile number.{" "}
              <Link href="/orders/recover" className="font-semibold underline">
                Recover by order number
              </Link>{" "}
              if you have your order number, or{" "}
              <Link href="/products" className="font-semibold underline">
                start shopping
              </Link>
              .
            </Alert>
          </div>
        ) : (
          <ul className="mt-6 flex flex-col gap-3" aria-label="Your orders">
            {orders.map((order) => {
              const provisional = canIssueQuotation(order.orderStatus);
              return (
                <li
                  key={order.orderId}
                  className="rounded-lg border border-zinc-200 bg-white p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold tracking-wide text-zinc-900">
                        {order.orderNumber}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {new Date(order.createdAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                        {" · "}
                        {order.deliveryPartnerName ?? "Delhivery"},{" "}
                        {order.deliveryPincode}
                      </p>
                    </div>
                    <PriceDisplay
                      amountPaise={order.totalPaise}
                      size="sm"
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <PaymentStatusBadge status={order.paymentStatus} />
                    <OrderStatusBadge status={order.orderStatus} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      href={`/orders/${order.orderId}`}
                      className="inline-flex h-10 items-center justify-center rounded-md bg-brand-800 px-4 text-sm font-bold text-white hover:bg-brand-700"
                    >
                      View order
                    </Link>
                    {order.paymentStatus === "pending" ||
                    order.paymentStatus === "failed" ? (
                      <Link
                        href={`/orders/${order.orderId}/pay`}
                        className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
                      >
                        Pay now
                      </Link>
                    ) : null}
                    {provisional ? (
                      <a
                        href={`/api/orders/${order.orderId}/quotation`}
                        download
                        className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
                      >
                        Download quotation
                      </a>
                    ) : null}
                    {order.paymentStatus === "paid" ? (
                      <a
                        href={`/api/orders/${order.orderId}/invoice`}
                        download
                        className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
                      >
                        Download invoice
                      </a>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </div>
  );
}
