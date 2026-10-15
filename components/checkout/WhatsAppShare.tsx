"use client";

import { useEffect, useRef } from "react";
import {
  buildOrderMessage,
  whatsAppLink,
  toWaNumber,
} from "@/lib/whatsapp/order-message";
import type { OrderMessageInput } from "@/lib/whatsapp/order-message";

/**
 * Post-order WhatsApp share. The order is already placed; this only
 * opens prefilled click-to-chat conversations (Trolift + the customer)
 * so nothing is re-typed. Auto-open is a best effort — pop-up blockers
 * may swallow it after the async submit, so the buttons always remain.
 */
export function WhatsAppShare({
  message,
  businessNumber,
}: {
  message: OrderMessageInput;
  businessNumber: string;
}) {
  const text = buildOrderMessage(message);
  const businessLink = whatsAppLink(businessNumber, text);
  const customerDigits = toWaNumber(message.customerPhone);
  const customerLink = customerDigits !== "" ? whatsAppLink(message.customerPhone, text) : null;
  const opened = useRef(false);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    try {
      window.open(businessLink, "_blank", "noopener,noreferrer");
    } catch {
      // Blocked or unavailable — the button below still works.
    }
  }, [businessLink]);

  return (
    <div className="mt-5 rounded-lg border border-green-200 bg-white p-4 text-left">
      <h3 className="text-sm font-bold text-zinc-900">
        Send this order on WhatsApp
      </h3>
      <p className="mt-1 text-xs leading-5 text-zinc-500">
        Your name, business details, GSTIN, items, total and delivery status
        are filled in — just press send. A copy is prepared for Trolift and
        for your own number.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <a
          href={businessLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-[#25D366] px-5 text-sm font-bold text-white hover:bg-[#1ebe5b]"
        >
          Send to Trolift
        </a>
        {customerLink ? (
          <a
            href={customerLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md border border-[#25D366] bg-white px-5 text-sm font-bold text-[#128C7E] hover:bg-green-50"
          >
            Send to my WhatsApp
          </a>
        ) : null}
      </div>
      {businessNumber.trim() === "" ? (
        <p className="mt-2 text-xs text-amber-800">
          Trolift&apos;s WhatsApp number is not configured yet — set{" "}
          <code>NEXT_PUBLIC_WHATSAPP_NUMBER</code> to enable automatic
          addressing.
        </p>
      ) : null}
    </div>
  );
}
