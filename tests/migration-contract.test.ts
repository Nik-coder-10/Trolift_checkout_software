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

function readMigrations(): Array<{ file: string; sql: string }> {
  const dir = join(__dirname, "..", "supabase", "migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(dir, file), "utf8") }));
}

describe("invoice + tax integrity (Prompt 49)", () => {
  it("enforces the CGST+SGST vs IGST exclusivity + non-GST zero-tax CHECK", () => {
    const all = readMigrations()
      .map((m) => m.sql)
      .join("\n");
    expect(all).toContain("orders_tax_split_check");
    // Legacy all-zero rows must satisfy the constraint (it validates).
    expect(all).toMatch(/cgst_amount \+ sgst_amount = 0 or igst_amount = 0/);
    expect(all).toMatch(/tax_treatment <> 'non_gst'/);
  });

  it("locks invoice numbering to the service role", () => {
    const all = readMigrations()
      .map((m) => m.sql)
      .join("\n");
    expect(all).toMatch(
      /revoke execute on function public\.generate_invoice_number\(text\) from authenticated/,
    );
    expect(all).toMatch(
      /revoke all on sequence public\.invoice_number_seq from authenticated/,
    );
    expect(all).toMatch(
      /grant usage, select on sequence public\.invoice_number_seq to service_role/,
    );
  });
});

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

describe("import_products HSN omission policy (Prompt 62)", () => {
  // The four behavioural cases are proven against real PostgreSQL in
  // scripts/db-drills/import-products-hsn.sql. This static guard keeps
  // CI honest: it fails the moment 0032 reverts to the unconditional
  // overwrite that silently erased an existing HSN for keyless callers.
  const sql = readFileSync(
    join(__dirname, "..", "supabase", "migrations", "0032_import_hsn.sql"),
    "utf8",
  );

  it("UPDATE preserves an existing HSN when the key is absent", () => {
    // `?` tests key presence; absent -> keep the stored value.
    expect(sql).toMatch(
      /when\s+v_item\s+\?\s+'hsn_code'\s+then\s+nullif\(v_item\s+->>\s+'hsn_code',\s*''\)\s+else\s+hsn_code\s+end/i,
    );
  });

  it("INSERT stores NULL for an absent or blank HSN", () => {
    const insert = sql.slice(sql.indexOf("insert into public.products"));
    expect(insert).toMatch(/hsn_code/);
    expect(insert).toMatch(/nullif\(v_item ->> 'hsn_code', ''\)/);
  });

  it("never unconditionally overwrites hsn_code on UPDATE", () => {
    expect(sql).not.toMatch(
      /update public\.products set[\s\S]*?hsn_code = nullif\(v_item ->> 'hsn_code', ''\),\s*\n\s*updated_at/i,
    );
  });
});
