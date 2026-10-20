"use client";

import { useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { isValidPaymentReference, MAX_PROOF_BYTES } from "@/lib/payments/claims";
import type { ApiResponse } from "@/types/api";

const PROOF_ACCEPT = "image/png,image/jpeg,image/webp";

function proofTypeError(file: File): string | null {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    return "The payment screenshot must be a PNG, JPEG or WebP image.";
  }
  if (file.size > MAX_PROOF_BYTES) {
    return "The payment screenshot must be 5 MB or smaller.";
  }
  return null;
}

/**
 * Payment-claim form: order mobile + the payment screenshot (both
 * mandatory) + an optional UPI reference. Submits ONE multipart
 * request — no amount field exists anywhere here; the server charges
 * nothing from the browser. Success means SUBMITTED (awaiting admin),
 * never paid.
 */
export function ClaimForm({ orderId }: { orderId: string }) {
  const [reference, setReference] = useState("");
  const [phone, setPhone] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onProofChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (file === null) {
      setProof(null);
      return;
    }
    const typeError = proofTypeError(file);
    if (typeError) {
      setProof(null);
      if (fileRef.current) fileRef.current.value = "";
      setError(typeError);
      return;
    }
    setProof(file);
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // The screenshot is the mandatory evidence; the reference is
    // optional help — but when given, it must be well-formed.
    if (reference.trim() !== "" && !isValidPaymentReference(reference)) {
      setError("The reference must be 6–30 letters or digits — or leave it blank.");
      return;
    }
    if (phone.trim() === "") {
      setError("Enter the mobile number used for this order.");
      return;
    }
    if (proof === null) {
      setError("Attach the screenshot of your payment.");
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
      const form = new FormData();
      form.set("orderId", orderId);
      form.set("reference", reference.trim());
      form.set("phone", phone.trim());
      if (key) form.set("accessToken", key);
      form.set("screenshot", proof);
      const res = await fetch("/api/payments/claim", {
        method: "POST",
        body: form,
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
        Our team will verify your payment against the screenshot and
        confirm your order. This usually happens within a few business
        hours.
      </Alert>
    );
  }

  return (
    <form noValidate onSubmit={submit} aria-label="Submit payment proof">
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
          label="UPI transaction / UTR number (optional)"
          name="payment-reference"
          autoComplete="off"
          placeholder="From your UPI app, if available"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          hint="Optional — the screenshot alone is enough for us to verify."
        />
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        <label
          htmlFor="payment-proof"
          className="text-sm font-semibold text-zinc-800"
        >
          Payment screenshot <span className="font-normal text-zinc-500">(required)</span>
        </label>
        <input
          ref={fileRef}
          id="payment-proof"
          name="payment-proof"
          type="file"
          accept={PROOF_ACCEPT}
          aria-invalid={error?.includes("screenshot") ? true : undefined}
          className="text-sm text-zinc-700 file:mr-3 file:h-10 file:cursor-pointer file:rounded-md file:border file:border-zinc-300 file:bg-white file:px-4 file:text-sm file:font-semibold file:text-zinc-800 hover:file:bg-zinc-50"
          onChange={onProofChange}
        />
        <p className="text-xs text-zinc-500">
          Screenshot of the successful payment — PNG, JPEG or WebP, up to 5 MB.
        </p>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <div className="mt-3">
        <Button type="submit" loading={submitting} className="w-full sm:w-auto">
          I Have Paid
        </Button>
      </div>
      <p className="mt-2 text-xs leading-5 text-zinc-500">
        This only records your claim. Your order is confirmed after we
        verify the payment — it is never marked paid automatically.
      </p>
    </form>
  );
}
