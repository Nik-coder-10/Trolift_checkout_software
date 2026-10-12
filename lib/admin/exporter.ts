import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { AppError } from "@/lib/api/errors";
import { escapeCsvCell, escapeCsvExportCell } from "@/lib/admin/csv";
import { logAdminAudit } from "@/lib/admin/audit";

/**
 * Admin CSV exports (server-only, admins only).
 *
 * Closed dataset whitelist — there is no endpoint that exports an
 * arbitrary table. Every dataset declares its EXACT columns up front:
 * only admin-visible fields, never credentials, tokens, keys or
 * internal secrets (asserted by tests on the header sets). Orders and
 * order money come exclusively from frozen snapshots — current
 * catalogue prices are never consulted, so an export is a historical
 * record, not a recomputation.
 *
 * Generation is server-side and chunked (500 rows per query) into a
 * stream, so neither the browser nor the server holds a giant table
 * in memory at once. The row count is known up front (exact count
 * query), which also feeds the audit entry written before streaming.
 */

export type ExportDataset = "products" | "rates" | "customers" | "orders";

export const EXPORT_DATASETS: ExportDataset[] = [
  "products",
  "rates",
  "customers",
  "orders",
];

const CHUNK_SIZE = 500;

type AdminClient = Awaited<ReturnType<typeof createClient>>;

interface DatasetDef {
  filename: (stamp: string) => string;
  count: (client: AdminClient) => Promise<number>;
  columns: string[];
  /** Null when exhausted. Rows are string cells in column order. */
  page: (client: AdminClient, from: number, to: number) => Promise<string[][] | null>;
}

const str = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
};

async function countTable(
  client: AdminClient,
  table: string,
): Promise<number> {
  const { count, error } = await client
    .from(table)
    .select("id", { count: "exact", head: true });
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not count export rows.", 500);
  }
  return count ?? 0;
}

const DEFINITIONS: Record<ExportDataset, DatasetDef> = {
  products: {
    filename: (s) => `products-${s}.csv`,
    count: (c) => countTable(c, "products"),
    // Column order matches the product CSV import header exactly (plus
    // trailing hsn) so an export re-imports without edits. HSN travels
    // or it is lost — never silently dropped.
    columns: [
      "name", "slug", "description", "category", "price",
      "stock", "threshold", "active", "gst", "weight", "hsn",
    ],
    page: async (client, from, to) => {
      const { data, error } = await client
        .from("products")
        .select(
          "slug,name,description,category,price,stock_quantity," +
            "low_stock_threshold,is_active,gst_rate,weight_kg,hsn_code",
        )
        .order("slug", { ascending: true })
        .range(from, to);
      if (error) {
        throw new AppError("INTERNAL_ERROR", "Product export failed.", 500);
      }
      const rows = (data ?? []) as unknown as Array<{
        slug: string;
        name: string;
        description: string;
        category: string;
        price: string;
        stock_quantity: number;
        low_stock_threshold: number;
        is_active: boolean;
        gst_rate: string | null;
        weight_kg: string | null;
        hsn_code: string | null;
      }>;
      if (rows.length === 0) return null;
      return rows.map((r) => [
        r.name, r.slug, r.description, r.category, r.price,
        str(r.stock_quantity), str(r.low_stock_threshold), str(r.is_active),
        r.gst_rate ?? "", r.weight_kg ?? "", r.hsn_code ?? "",
      ]);
    },
  },
  rates: {
    filename: (s) => `delivery-rates-${s}.csv`,
    count: (c) => countTable(c, "delivery_pincode_rates"),
    columns: [
      "pincode", "partner", "charge", "serviceable",
      "min_order", "max_order", "eta_min", "eta_max",
    ],
    page: async (client, from, to) => {
      const { data, error } = await client
        .from("delivery_pincode_rates")
        .select(
          "pincode,delivery_charge,serviceable,min_order_amount," +
            "max_order_amount,eta_min_days,eta_max_days," +
            "delivery_partners!inner(name)",
        )
        .order("pincode", { ascending: true })
        .order("delivery_charge", { ascending: true })
        .range(from, to);
      if (error) {
        throw new AppError("INTERNAL_ERROR", "Rate export failed.", 500);
      }
      const rows = (data ?? []) as unknown as Array<{
        pincode: string;
        delivery_charge: string;
        serviceable: boolean;
        min_order_amount: string | null;
        max_order_amount: string | null;
        eta_min_days: number | null;
        eta_max_days: number | null;
        delivery_partners: { name: string } | null;
      }>;
      if (rows.length === 0) return null;
      return rows.map((r) => [
        r.pincode,
        r.delivery_partners?.name ?? "",
        r.delivery_charge,
        str(r.serviceable),
        r.min_order_amount ?? "",
        r.max_order_amount ?? "",
        r.eta_min_days === null ? "" : str(r.eta_min_days),
        r.eta_max_days === null ? "" : str(r.eta_max_days),
      ]);
    },
  },
  customers: {
    filename: (s) => `customers-${s}.csv`,
    count: (c) => countTable(c, "customers"),
    columns: [
      "name", "phone", "email", "gstin",
      "billing_name", "billing_address", "billing_city",
      "billing_state", "billing_pincode", "created_at",
    ],
    page: async (client, from, to) => {
      const { data, error } = await client
        .from("customers")
        .select(
          "name,phone,email,gstin,billing_name,billing_address_line," +
            "billing_city,billing_state,billing_pincode,created_at",
        )
        .order("created_at", { ascending: true })
        .range(from, to);
      if (error) {
        throw new AppError("INTERNAL_ERROR", "Customer export failed.", 500);
      }
      const rows = (data ?? []) as unknown as Array<{
        name: string;
        phone: string;
        email: string | null;
        gstin: string | null;
        billing_name: string | null;
        billing_address_line: string | null;
        billing_city: string | null;
        billing_state: string | null;
        billing_pincode: string | null;
        created_at: string;
      }>;
      if (rows.length === 0) return null;
      return rows.map((r) => [
        r.name, r.phone, r.email ?? "", r.gstin ?? "",
        r.billing_name ?? "", r.billing_address_line ?? "",
        r.billing_city ?? "", r.billing_state ?? "",
        r.billing_pincode ?? "", r.created_at,
      ]);
    },
  },
  orders: {
    filename: (s) => `orders-${s}.csv`,
    count: (c) => countTable(c, "orders"),
    columns: [
      "order_number", "created_at", "customer_name", "customer_phone",
      "customer_email", "gstin", "billing_name", "billing_address",
      "billing_city", "billing_state", "billing_pincode",
      "subtotal", "delivery_charge", "taxable", "cgst", "sgst", "igst",
      "total", "payment_status", "order_status",
      "delivery_pincode", "delivery_partner",
    ],
    page: async (client, from, to) => {
      // Snapshots ONLY — the customer master is never read, so history
      // cannot shift under an export.
      const { data, error } = await client
        .from("orders")
        .select(
          "order_number,created_at,customer_name_snapshot," +
            "customer_phone_snapshot,customer_email_snapshot,gstin_snapshot," +
            "billing_name,billing_address_line,billing_city,billing_state," +
            "billing_pincode,subtotal,delivery_charge,taxable_amount," +
            "cgst_amount,sgst_amount,igst_amount,total_amount," +
            "payment_status,order_status,delivery_pincode,delivery_partner_name",
        )
        .order("created_at", { ascending: true })
        .range(from, to);
      if (error) {
        throw new AppError("INTERNAL_ERROR", "Order export failed.", 500);
      }
      const rows = (data ?? []) as unknown as Array<{
        order_number: string;
        created_at: string;
        customer_name_snapshot: string;
        customer_phone_snapshot: string;
        customer_email_snapshot: string | null;
        gstin_snapshot: string | null;
        billing_name: string | null;
        billing_address_line: string | null;
        billing_city: string | null;
        billing_state: string | null;
        billing_pincode: string | null;
        subtotal: string;
        delivery_charge: string;
        taxable_amount: string;
        cgst_amount: string;
        sgst_amount: string;
        igst_amount: string;
        total_amount: string;
        payment_status: string;
        order_status: string;
        delivery_pincode: string;
        delivery_partner_name: string;
      }>;
      if (rows.length === 0) return null;
      return rows.map((r) => [
        r.order_number, r.created_at,
        r.customer_name_snapshot, r.customer_phone_snapshot,
        r.customer_email_snapshot ?? "", r.gstin_snapshot ?? "",
        r.billing_name ?? "", r.billing_address_line ?? "",
        r.billing_city ?? "", r.billing_state ?? "",
        r.billing_pincode ?? "",
        r.subtotal, r.delivery_charge, r.taxable_amount,
        r.cgst_amount, r.sgst_amount, r.igst_amount, r.total_amount,
        r.payment_status, r.order_status,
        r.delivery_pincode, r.delivery_partner_name,
      ]);
    },
  },
};

/** Column headers per dataset (also the sensitive-field contract). */
export function exportColumns(dataset: ExportDataset): string[] {
  return [...DEFINITIONS[dataset].columns];
}

export interface ExportHandle {
  filename: string;
  rowCount: number;
  stream: ReadableStream<Uint8Array>;
}

/**
 * Build a streamed CSV export: exact count first (feeds the audit
 * entry), then chunked row queries encoded on the fly. The caller
 * must be an admin — enforced here, not just at the route.
 */
export async function buildExport(
  dataset: ExportDataset,
  actorUserId: string | null,
): Promise<ExportHandle> {
  await requireAdmin();
  const client = await createClient();
  const def = DEFINITIONS[dataset];
  const rowCount = await def.count(client);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = def.filename(stamp);
  const columns = def.columns;

  await logAdminAudit({
    actorUserId,
    operation: `export.${dataset}`,
    dataset,
    totalRows: rowCount,
    insertedRows: 0,
    updatedRows: 0,
    failedRows: 0,
    result: "success",
    summary: { filename, streamed: true },
  });

  const encoder = new TextEncoder();
  let offset = 0;
  let headerSent = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!headerSent) {
        headerSent = true;
        controller.enqueue(
          encoder.encode(columns.map(escapeCsvCell).join(",") + "\n"),
        );
        return;
      }
      const chunk = await def.page(client, offset, offset + CHUNK_SIZE - 1);
      if (!chunk) {
        controller.close();
        return;
      }
      offset += chunk.length;
      controller.enqueue(
        encoder.encode(
          chunk
            .map((row) => row.map(escapeCsvExportCell).join(","))
            .join("\n") + "\n",
        ),
      );
    },
    async cancel() {
      // Client went away mid-download: nothing to roll back (reads only).
    },
  });

  return { filename, rowCount, stream };
}
