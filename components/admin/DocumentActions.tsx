import type { OrderDocumentActions } from "@/lib/admin/order-documents";

const PRIMARY_LINK =
  "inline-flex h-10 items-center rounded-md bg-brand-800 px-4 text-sm font-bold text-white hover:bg-brand-700";
const SECONDARY_LINK =
  "inline-flex h-10 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-800 hover:bg-zinc-50";

/** Why no tax invoice is offered (paid-only rule). */
function invoiceNote(paymentStatus: string): string {
  if (paymentStatus === "refunded") {
    return "This order was refunded — the tax invoice is not downloadable from here.";
  }
  return "The tax invoice is issued after payment verification (paid orders only).";
}

/** Why no quotation is offered (provisional-only rule). */
function quotationNote(orderStatus: string): string {
  if (orderStatus === "cancelled") {
    return "This order was cancelled — no quotation is issued for it.";
  }
  if (orderStatus === "paid") {
    return "A quotation is issued only while the order is provisional; paid orders are served by the tax invoice.";
  }
  if (
    orderStatus === "delivered" ||
    orderStatus === "shipped" ||
    orderStatus === "dispatched"
  ) {
    return "This order has already moved past the quotation stage.";
  }
  return "A quotation is issued only while the order is provisional (before payment is verified).";
}

/**
 * Document downloads for an admin order: the provisional quotation plus
 * the paid-order tax invoice. Every link is a plain anchor whose
 * Content-Disposition filename comes from the server, so downloads keep
 * working without JavaScript and never carry a URL-derived name. The
 * server re-checks authorization and eligibility on every request — this
 * panel only avoids offering actions the route would refuse and explains
 * why an action is absent. Sharing stays manual: the quotation is
 * forwarded to the customer (e.g. over WhatsApp) by staff.
 */
export function DocumentActions({
  invoice,
  quotation,
  paymentStatus,
  orderStatus,
}: {
  invoice: OrderDocumentActions["invoice"];
  quotation: OrderDocumentActions["quotation"];
  paymentStatus: string;
  orderStatus: string;
}) {
  // Why an action is missing — honest, non-leaking status copy.
  const notes: string[] = [];
  if (!quotation.available) notes.push(quotationNote(orderStatus));
  else if (!quotation.existing) {
    notes.push(
      "No quotation has been issued yet — downloading creates it now and freezes it (numbered by the server).",
    );
  }
  if (!invoice.available) notes.push(invoiceNote(paymentStatus));

  return (
    <section
      aria-label="Documents"
      className="rounded-lg border border-zinc-200 bg-white p-5"
    >
      <h2 className="text-base font-bold text-zinc-900">Documents</h2>
      <p className="mt-1 text-xs leading-5 text-zinc-500">
        PDFs are generated from frozen order snapshots. Send them to the
        customer yourself (e.g. over WhatsApp) — nothing is sent
        automatically.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {quotation.available ? (
          <a href={quotation.href} download className={SECONDARY_LINK}>
            Download Quotation
          </a>
        ) : null}
        {invoice.available ? (
          <>
            <a href={invoice.href} download className={PRIMARY_LINK}>
              Download Invoice
            </a>
            <a
              href={`${invoice.href}?disposition=inline`}
              target="_blank"
              rel="noopener noreferrer"
              className={SECONDARY_LINK}
            >
              Print Invoice
            </a>
          </>
        ) : null}
      </div>
      {quotation.existing && quotation.quotationNumber ? (
        <p className="mt-3 text-xs leading-5 text-zinc-500">
          Quotation <span className="font-semibold text-zinc-700">{quotation.quotationNumber}</span>
          {quotation.validTill ? ` · valid till ${quotation.validTill}` : null}
          {" "}— frozen once issued; re-downloads are identical.
        </p>
      ) : null}
      {notes.length === 0 ? null : (
        <ul className="mt-3 flex flex-col gap-1 text-xs leading-5 text-zinc-500">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
