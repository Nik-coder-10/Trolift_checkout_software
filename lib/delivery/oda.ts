import { parseGstRate } from "@/lib/tax/india";

/**
 * ODA (out-of-delivery-area) door-delivery charge.
 *
 * A pincode flagged ODA on the Delhivery list is normally not
 * deliverable. The customer may instead opt into door delivery there
 * for a fixed charge — a flat GST-EXCLUSIVE base fee (default ₹800)
 * with 18% GST charged on top (base ₹800 + ₹144 GST = ₹944 payable).
 * This matches the store's original delivery-billing model, where the
 * base charge lives in orders.delivery_charge and its GST is folded
 * into the order's CGST/SGST or IGST split. The amount lives in env
 * (TROLIFT_ODA_CHARGE_PAISE) so the owner can adjust it without a
 * deploy; the label lives here so every surface (order total,
 * quotation cartage, invoice delivery row, customer message) says the
 * same words.
 *
 * Storage: delivery_charge carries the BASE charge only. The DB
 * identity (total = subtotal + delivery + tax − discount) keeps
 * holding because the delivery GST is part of the tax columns, and
 * every reader — quotation, invoice, admin, CSV — picks the charge up
 * from the one column and derives its GST from the configured rate.
 */

/** Flat ODA base charge in paise (default ₹800, GST-exclusive). */
export function getOdaChargePaise(): number {
  const raw = (process.env.TROLIFT_ODA_CHARGE_PAISE ?? "80000").trim();
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : 80000;
}

/**
 * Add-on GST split of the flat charge: the base freight is the charge
 * itself and 18% GST is charged on top of it — freight + tax is what
 * the customer pays.
 * 18% of 800 base → freight 800, tax 144 (customer pays 944).
 *
 * Returns { charge, 0 } for a null/zero rate (non-GST quotations).
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
  return {
    freightPaise: chargePaise,
    taxPaise: Math.round((chargePaise * rate) / 100),
  };
}

/** Line copy for the ODA charge on quotations and invoices. */
export function getOdaLineCopy(): { name: string; description: string } {
  const name = (process.env.TROLIFT_ODA_LINE_NAME ?? "").trim();
  const description = (process.env.TROLIFT_ODA_LINE_DESC ?? "").trim();
  return {
    name: name === "" ? "ODA Delivery Charge" : name,
    description:
      description === ""
        ? "Door delivery to ODA pincode - base charge plus 18% GST"
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
