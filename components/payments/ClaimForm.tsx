"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { isValidPaymentReference } from "@/lib/payments/claims";
import type { ApiResponse } from "@/types/api";

/**
 * UTR claim form: submits ONLY the payment reference for the order.
 * No amount field exists anywhere here — the server charges nothing
 * from the browser. Success means SUBMITTED (awaiting admin), never paid.
 */
export function ClaimForm({ orderId }: { orderId: string }) {
  const [reference, setReference] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isValidPaymentReference(reference)) {
      setError("Enter the 6–30 character reference from your UPI app (usually the 12-digit UTR).");
      return;
    }
    if (phone.trim() === "") {
      setError("Enter the mobile number used for this order.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // The HttpOnly guest cookie authorizes this automatically; if the
      // customer arrived on a one-time `?key=` link that has not been
      // exchanged yet, forward it as well (memory only, never stored).
      const key =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("key")
          : null;
      const res = await fetch("/api/payments/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          reference: reference.trim(),
          phone: phone.trim(),
          ...(key ? { accessToken: key } : {}),
        }),
      });
      const json = (await res.json()) as ApiResponse<{ orderNumber: string }>;
      if (!json.ok) {
        setError(json.error.message);
        return;
      }
      setDone(true);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <Alert tone="success" title="Payment submitted for verification">
        Our team will verify your payment against the reference and confirm
        your order. This usually happens within a few business hours.
      </Alert>
    );
  }

  return (
    <form noValidate onSubmit={submit} aria-label="Submit payment reference">
      <Input
        label="Order mobile number"
        name="claim-phone"
        autoComplete="tel"
        inputMode="tel"
        placeholder="Mobile number from the order"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <div className="mt-3">
        <Input
          label="UPI transaction / UTR number"
          name="payment-reference"
          autoComplete="off"
          placeholder="12-digit UTR from your UPI app"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          error={error ?? undefined}
          hint="Find it in your UPI app's payment history after paying."
        />
      </div>
      <div className="mt-3">
        <Button type="submit" loading={submitting} className="w-full sm:w-auto">
          I Have Paid — Submit Reference
        </Button>
      </div>
      <p className="mt-2 text-xs leading-5 text-zinc-500">
        This only records your claim. Your order is confirmed after we
        verify the payment — it is never marked paid automatically.
      </p>
    </form>
  );
}
