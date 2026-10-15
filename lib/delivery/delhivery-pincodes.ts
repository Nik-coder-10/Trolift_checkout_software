/**
 * Delhivery pincode-list coverage — the "can we deliver to this PIN?"
 * source of truth for the delivery engine.
 *
 * Pure and database-free: the list ships with the app as generated data
 * (delhivery-pincodes.generated.ts, 21,339 PIN codes) and is decoded
 * once per process into a Map, so a verdict is available even when
 * Supabase is unconfigured or unreachable.
 *
 * THE OPERATOR RULE (verified in tests/delhivery-pincodes.test.ts):
 *   ODA = false ("0") in the list → the pincode IS deliverable.
 *   ODA = true  ("1") in the list → the pincode is NOT deliverable.
 *   A blank flag or a pincode absent from the list cannot be promised,
 *   so both are treated as not deliverable — never promise what the
 *   list does not confirm.
 *
 * This module only answers coverage. Charges, partners and order
 * windows stay in lib/delivery/engine.ts.
 */

import {
  DELHIVERY_LIST_GENERATED,
  DELHIVERY_LIST_ROWS,
  DELHIVERY_LIST_SHEET,
  DELHIVERY_LIST_SOURCE,
  DELHIVERY_PINCODE_DATA,
  FACILITY_STATES,
} from "./delhivery-pincodes.generated";

/** Customer-safe explanation for each non-deliverable verdict. */
export const COVERAGE_REASON = {
  /** Listed, ODA flagged (out of delivery area). */
  oda: "We can't deliver to this pincode — it's outside our delivery area.",
  /** Not in the list at all. */
  unlisted: "We don't deliver to this pincode yet.",
  /** Listed, but the source left the ODA flag blank. */
  unconfirmed: "We couldn't confirm doorstep delivery for this pincode yet.",
} as const;

export interface PincodeCoverage {
  /** Digits-only pincode that was looked up ("" when the input had none). */
  pincode: string;
  /** Whether the pincode appears in the Delhivery list. */
  listed: boolean;
  /** ODA flag: true = out of delivery area, false = standard, null = blank. */
  oda: boolean | null;
  /** Delivery state for the pincode (null when unknown). */
  state: string | null;
  /** The verdict: listed AND ODA false. */
  deliverable: boolean;
  /** Explanation when not deliverable, else null. */
  reason: string | null;
}

/** Provenance of the loaded list (shown to operators, asserted in tests). */
export const DELHIVERY_LIST_META = {
  source: DELHIVERY_LIST_SOURCE,
  sheet: DELHIVERY_LIST_SHEET,
  rows: DELHIVERY_LIST_ROWS,
  generated: DELHIVERY_LIST_GENERATED,
} as const;

const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";

interface ListEntry {
  oda: boolean | null;
  state: string | null;
}

let decoded: ReadonlyMap<string, ListEntry> | null = null;

/**
 * Decode the generated payload once (21,339 fixed-width entries), then
 * serve lookups from a Map. Nothing here throws on malformed data:
 * a bad entry simply never matches a pincode.
 */
function entries(): ReadonlyMap<string, ListEntry> {
  if (decoded) return decoded;
  const map = new Map<string, ListEntry>();
  for (const entry of DELHIVERY_PINCODE_DATA.split(",")) {
    if (entry.length !== 8) continue;
    const flag = entry[6];
    map.set(entry.slice(0, 6), {
      oda: flag === "0" ? false : flag === "1" ? true : null,
      state: FACILITY_STATES[BASE36.indexOf(entry[7] ?? "")] ?? null,
    });
  }
  decoded = map;
  return map;
}

/**
 * Digits-only form of user input, so "400 001" and " 400001 " both
 * resolve. Callers still validate the shape before quoting.
 */
export function normalizeLookupPincode(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\D+/g, "");
}

/** One pincode in, one coverage verdict out. Never throws. */
export function lookupDelhiveryPincode(
  raw: string | null | undefined,
): PincodeCoverage {
  const pincode = normalizeLookupPincode(raw);
  const entry = pincode.length === 6 ? entries().get(pincode) : undefined;
  if (!entry) {
    return {
      pincode,
      listed: false,
      oda: null,
      state: null,
      deliverable: false,
      reason: COVERAGE_REASON.unlisted,
    };
  }
  const deliverable = entry.oda === false;
  return {
    pincode,
    listed: true,
    oda: entry.oda,
    state: entry.state,
    deliverable,
    reason: deliverable
      ? null
      : entry.oda === true
        ? COVERAGE_REASON.oda
        : COVERAGE_REASON.unconfirmed,
  };
}

/**
 * Aggregate counts over the loaded list — diagnostics for operators and
 * a structural assertion for tests (deliverable + oda + unconfirmed
 * must equal listed).
 */
export function delhiveryCoverageStats(): {
  listed: number;
  deliverable: number;
  oda: number;
  unconfirmed: number;
} {
  let deliverable = 0;
  let oda = 0;
  let unconfirmed = 0;
  for (const entry of entries().values()) {
    if (entry.oda === false) deliverable += 1;
    else if (entry.oda === true) oda += 1;
    else unconfirmed += 1;
  }
  return { listed: entries().size, deliverable, oda, unconfirmed };
}
