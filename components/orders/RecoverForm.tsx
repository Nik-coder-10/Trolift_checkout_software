"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { ApiResponse } from "@/types/api";

/**
 * Order recovery: order number + order mobile → fresh guest session.
 * The server response is identical whether or not the pair matches, so
 * nothing about arbitrary orders leaks. The issued token is exchanged
 * into the HttpOnly cookie by the server's Set-Cookie; the raw value
 * below lives only in this closure and is used once to redirect.
 */
export function RecoverForm() {
  const [orderNumber, setOrderNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (orderNumber.trim() === "" || phone.trim() === "") {
      setError("Enter your order number and the mobile number from the order.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/orders/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNumber: orderNumber.trim(),
          phone: phone.trim(),
        }),
      });
      const json = (await res.json()) as ApiResponse<{
        orderId: string;
      }>;
      if (!json.ok) {
        // Generic: never confirms or denies a specific order.
        setError(json.error.message);
        return;
      }
      setOrderId(json.data.orderId);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (orderId) {
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="success" title="Access restored">
          Your order session is restored on this device.
        </Alert>
        <Link
          href={`/orders/${orderId}`}
          className="inline-flex h-11 items-center justify-center rounded-md bg-brand-800 px-5 text-sm font-bold text-white hover:bg-brand-700"
        >
          View my order
        </Link>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={submit} aria-label="Recover order access">
      <Input
        label="Order number"
        name="recover-order-number"
        autoComplete="off"
        placeholder="e.g. TRL-2026-000001"
        value={orderNumber}
        onChange={(e) => setOrderNumber(e.target.value)}
      />
      <div className="mt-3">
        <Input
          label="Mobile number from the order"
          name="recover-phone"
          autoComplete="tel"
          inputMode="tel"
          placeholder="10-digit mobile"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={error ?? undefined}
        />
      </div>
      <div className="mt-3">
        <Button type="submit" loading={submitting} className="w-full sm:w-auto">
          Restore access
        </Button>
      </div>
      <p className="mt-2 text-xs leading-5 text-zinc-500">
        We only restore access when both values match the order. Guessing an
        order number alone reveals nothing.
      </p>
    </form>
  );
}
