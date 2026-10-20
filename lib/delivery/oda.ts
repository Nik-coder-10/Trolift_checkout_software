import { parseGstRate } from "@/lib/tax/india";

/**
 * ODA (out-of-delivery-area) door-delivery charge.
 *
 * A pincode flagged ODA on the Delhivery list is normally not
 * deliverable. The customer may instead opt into door delivery there
 * for a fixed charge — GST-inclusive, flat, the first real delivery
 * charge this all-inclusive store has ever quoted. The amount lives in
 * env (TROLIFT_ODA_CHARGE_PAISE, default ₹800) so the owner can adjust
 * it without a deploy; the label lives here so every surface (order
 * total, quotation cartage, invoice delivery row, customer message)
 * says the same words.
 *
 * The charge flows through orders.delivery_charge untouched, so the
 * DB identity (total = subtotal + delivery + tax − discount) keeps
 * holding and every reader — quotation, invoice, admin, CSV — picks
 * it up from the one column.
 */

/** Flat ODA charge in paise (default ₹800). */
export function getOdaChargePaise(): number {
  const raw = (process.env.TROLIFT_ODA_CHARGE_PAISE ?? "80000").trim();
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : 80000;
}

/**
 * GST-inclusive extraction from the flat charge: the customer always
 * pays exactly the charge, and the freight/tax split falls out of it.
 * Canonical reverse-GST (same shape as all-inclusive catalogue lines):
 * freight = round(charge × 100/(100+rate)), tax = charge − freight.
 * 18% of 800 inclusive → freight ≈ 677.97, tax ≈ 122.03.
 */
export function splitOdaCharge(input: {
  chargePaise: number;
  gstRate: string | null;
}): { freightPaise: number; taxPaise: number } {
  const { chargePaise, gstRate } = input;
  if (gstRate === null || chargePaise <= 0) {
    return { freightPaise: chargePaise, taxPaise: 0 };
  }
  const rate = parseGstRate(gstRate);
  if (!(rate > 0)) {
    return { freightPaise: chargePaise, taxPaise: 0 };
  }
  const freightPaise = Math.round((chargePaise * 100) / (100 + rate));
  return { freightPaise, taxPaise: chargePaise - freightPaise };
}

/** Line copy for the ODA charge on quotations and invoices. */
export function getOdaLineCopy(): { name: string; description: string } {
  const name = (process.env.TROLIFT_ODA_LINE_NAME ?? "").trim();
  const description = (process.env.TROLIFT_ODA_LINE_DESC ?? "").trim();
  return {
    name: name === "" ? "ODA Delivery Charge" : name,
    description:
      description === ""
        ? "Door delivery to ODA pincode - GST included"
        : description,
  };
}

/**
 * Is this frozen order an ODA door-delivery order? delivery_charge is
 * 0 on every all-inclusive order, so a positive charge is the ODA
 * marker — no extra column needed.
 */
export function isOdaOrder(deliveryChargePaise: number): boolean {
  return deliveryChargePaise > 0;
}
