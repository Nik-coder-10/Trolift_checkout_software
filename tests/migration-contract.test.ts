import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ORDER_TRANSITIONS } from "@/lib/orders/transitions";

/**
 * Migration/application contract: every OrderStatus the application
 * state machine can produce must be storable under the database
 * orders_order_status_check. Live staging (Prompt 44) proved a drift
 * here fails fulfilment with a misleading 409 (packed /
 * ready_for_dispatch missing from the 0012-era CHECK).
 *
 * The test parses the migration SQL (last definition wins, mirroring
 * ordered application) — no database required.
 */
function dbStatusValues(): string[] {
  const dir = join(__dirname, "..", "supabase", "migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let last: string[] | null = null;
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    const blocks = [
      ...sql.matchAll(
        /orders_order_status_check\s+check\s*\(\s*order_status\s+in\s*\(([^)]+)\)/gi,
      ),
    ];
    for (const block of blocks) {
      const values = [...(block[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
      if (values.length > 0) last = values;
    }
  }
  if (!last) throw new Error("orders_order_status_check not found in migrations");
  return last;
}

describe("DB status CHECK covers the app state machine", () => {
  it("every ORDER_TRANSITIONS key is storable", () => {
    const dbValues = dbStatusValues();
    for (const status of Object.keys(ORDER_TRANSITIONS)) {
      expect(dbValues, `DB CHECK missing status: ${status}`).toContain(status);
    }
  });

  it("every transition target is storable", () => {
    const dbValues = dbStatusValues();
    const targets = new Set(Object.values(ORDER_TRANSITIONS).flat());
    for (const target of targets) {
      expect(dbValues, `DB CHECK missing target: ${target}`).toContain(target);
    }
  });
});
