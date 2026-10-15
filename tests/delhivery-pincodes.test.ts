import { describe, expect, it } from "vitest";
import {
  COVERAGE_REASON,
  DELHIVERY_LIST_META,
  delhiveryCoverageStats,
  lookupDelhiveryPincode,
  normalizeLookupPincode,
} from "@/lib/delivery/delhivery-pincodes";
import { DELHIVERY_PINCODE_DATA } from "@/lib/delivery/delhivery-pincodes.generated";

/**
 * The operator rule under test, straight from the requirement:
 *   ODA = false in the Delhivery list → the pincode IS deliverable.
 *   ODA = true  in the Delhivery list → the pincode is NOT deliverable.
 * Blank flags and pincodes absent from the list are never promised.
 */

describe("delivery list integrity (generated data)", () => {
  it("ships the full export, structurally sound", () => {
    const entries = DELHIVERY_PINCODE_DATA.split(",");
    expect(entries).toHaveLength(DELHIVERY_LIST_META.rows);
    expect(DELHIVERY_LIST_META.rows).toBe(21339);
    for (const entry of entries) {
      // 6-digit pincode + ODA flag + base36 state index.
      expect(entry).toMatch(/^\d{6}[01-][0-9a-z]$/);
    }
    expect(new Set(entries.map((e) => e.slice(0, 6))).size).toBe(entries.length);
  });

  it("records its provenance", () => {
    expect(DELHIVERY_LIST_META.source).toContain("Delhivery");
    expect(DELHIVERY_LIST_META.sheet).toBe("Pincode list");
    expect(DELHIVERY_LIST_META.generated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("accounts for every entry exactly once", () => {
    const stats = delhiveryCoverageStats();
    expect(stats.listed).toBe(DELHIVERY_LIST_META.rows);
    expect(stats.deliverable + stats.oda + stats.unconfirmed).toBe(stats.listed);
    // Fixed counts from the delivered workbook (0 / 1 / blank flags).
    expect(stats).toEqual({
      listed: 21339,
      deliverable: 11913,
      oda: 9385,
      unconfirmed: 41,
    });
  });
});

describe("lookupDelhiveryPincode: false in the list means deliverable", () => {
  it.each([
    ["303905", "Rajasthan"],
    ["400001", "Maharashtra"],
    ["110075", "Delhi"],
    ["799001", "Tripura"],
    ["380015", "Gujarat"],
  ])("marks ODA=false pincode %s deliverable", (pincode, state) => {
    const coverage = lookupDelhiveryPincode(pincode);
    expect(coverage.listed).toBe(true);
    expect(coverage.oda).toBe(false);
    expect(coverage.deliverable).toBe(true);
    expect(coverage.state).toBe(state);
    expect(coverage.reason).toBeNull();
  });
});

describe("lookupDelhiveryPincode: true in the list means NOT deliverable", () => {
  it.each(["680522", "140407", "205301"])(
    "blocks ODA=true pincode %s",
    (pincode) => {
      const coverage = lookupDelhiveryPincode(pincode);
      expect(coverage.listed).toBe(true);
      expect(coverage.oda).toBe(true);
      expect(coverage.deliverable).toBe(false);
      expect(coverage.reason).toBe(COVERAGE_REASON.oda);
    },
  );
});

describe("lookupDelhiveryPincode: unconfirmable pincodes are never promised", () => {
  it("blocks pincodes absent from the list", () => {
    for (const pincode of ["123456", "999999", "996511"]) {
      const coverage = lookupDelhiveryPincode(pincode);
      expect(coverage.listed).toBe(false);
      expect(coverage.oda).toBeNull();
      expect(coverage.deliverable).toBe(false);
      expect(coverage.reason).toBe(COVERAGE_REASON.unlisted);
    }
  });

  it("blocks entries whose ODA flag is blank in the source", () => {
    const coverage = lookupDelhiveryPincode("751028");
    expect(coverage.listed).toBe(true);
    expect(coverage.oda).toBeNull();
    expect(coverage.deliverable).toBe(false);
    expect(coverage.reason).toBe(COVERAGE_REASON.unconfirmed);
  });

  it("never throws on malformed input", () => {
    for (const raw of ["", "   ", "abc", "12", "4000011", null, undefined, "४००००१"]) {
      const coverage = lookupDelhiveryPincode(raw);
      expect(coverage.deliverable).toBe(false);
      expect(coverage.reason).toBeTruthy();
    }
  });
});

describe("smart matching", () => {
  it("strips spaces and dashes before matching", () => {
    expect(normalizeLookupPincode(" 400 001 ")).toBe("400001");
    expect(normalizeLookupPincode("400-001")).toBe("400001");
    expect(lookupDelhiveryPincode("400 001").deliverable).toBe(true);
    expect(lookupDelhiveryPincode("303905 ").state).toBe("Rajasthan");
  });

  it("does not silently truncate over-long input", () => {
    // "91400001" is not a pincode: no last-6 fallback that could match
    // a different area than the customer typed.
    expect(lookupDelhiveryPincode("91400001").deliverable).toBe(false);
    expect(lookupDelhiveryPincode("91400001").pincode).toBe("91400001");
  });
});
