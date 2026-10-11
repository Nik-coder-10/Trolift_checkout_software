"use client";

import { useEffect, useState } from "react";
import { notFound } from "next/navigation";

/**
 * One-time exchange: a `?key=` capability link is POSTed to the session
 * endpoint (which sets the HttpOnly guest cookie), then the key is
 * stripped from the address bar with `replaceState` so it never lingers
 * in history, referrers or screenshots. The raw key lives only in memory.
 *
 * With `autoNotFound`, a failed exchange routes to the shared not-found
 * UI (used when the page itself could not authorize the order).
 */
export function GuestKeyExchange({
  orderId,
  autoNotFound = false,
}: {
  orderId: string;
  autoNotFound?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const key = params.get("key");
    if (!key) return;
    let cancelled = false;
    fetch(`/api/orders/${orderId}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: key }),
    })
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setFailed(true);
          return;
        }
        // Strip the key from the URL without reloading.
        params.delete("key");
        const qs = params.toString();
        const clean = `${window.location.pathname}${qs === "" ? "" : `?${qs}`}${window.location.hash}`;
        window.history.replaceState(null, "", clean);
        // Reload so server components see the new cookie.
        window.location.reload();
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (!failed) return null;
  if (autoNotFound) notFound();
  return (
    <p role="alert" className="mt-4 text-sm text-red-700">
      This order link is invalid or has expired. Use the “Recover order
      access” option with your order number and mobile number.
    </p>
  );
}
