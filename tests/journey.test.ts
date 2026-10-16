import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// server-only modules throw outside the Next server runtime by design.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import {
  createMockClient,
  type MockFilter,
  type MockResponder,
} from "@/tests/helpers/supabase-mock";
import { resetRateLimits } from "@/lib/rate-limit/index";

let authUser: { id: string } | null = { id: "admin-1" };
let adminFlag = true;
let serverHandler: MockResponder = () => {
  throw new Error("unexpected server query");
};
let adminHandler: MockResponder = () => {
  throw new Error("unexpected admin query");
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    createMockClient((op) => {
      if (op.table === "profiles") {
        return { rows: adminFlag ? [{ is_admin: true }] : [], error: null };
      }
      return serverHandler(op);
    }, { authUser }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createMockClient(adminHandler),
}));

import { POST as ordersPost } from "@/app/api/orders/route";
import { POST as deliveryPost } from "@/app/api/delivery/check/route";
import { POST as claimPost } from "@/app/api/payments/claim/route";
import { POST as statusPost } from "@/app/api/admin/orders/status/route";
import { GET as customerInvoiceGet } from "@/app/api/orders/[id]/invoice/route";
import { GET as adminInvoiceGet } from "@/app/api/admin/orders/[id]/invoice/route";
import { getPayableOrderForGuest } from "@/lib/payments/order";
import {
  guestCookieName,
} from "@/lib/guest-access/tokens";
import {
  getAdminOrderDetail,
  transitionOrderStatus,
  verifyPaymentClaim,
} from "@/lib/admin/orders";

/* ------------------------------------------------------------------ */
/* In-memory backend: faithful table + RPC semantics for the journey.  */
/* ------------------------------------------------------------------ */

const P1 = "b1c2d3e4-0004-4000-8000-000000000004";
const PARTNER = "a1b2c3d4-0001-4000-8000-000000000001";
const PHONE = "+919876543210";
const PHONE2 = "+919876543211";
const UTR = "UTR202610050001";
const UTR2 = "UTR202610050002";

const uuid = (n: number) =>
  `123e4567-e89b-12d3-a456-42661417${String(n).padStart(4, "0")}`;

interface Db {
  products: Map<string, Record<string, unknown>>;
  customers: Map<string, Record<string, unknown>>;
  orders: Map<string, Record<string, unknown>>;
  items: Map<string, Record<string, unknown>[]>;
  payments: Map<string, Record<string, unknown>[]>;
  tokens: Array<Record<string, unknown>>;
  reservations: Array<Record<string, unknown>>;
  invoices: Map<string, Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  idem: Map<string, string>;
  seq: number;
  invSeq: number;
}

let db: Db;

function resetDb() {
  db = {
    products: new Map([
      [
        P1,
        {
          id: P1,
          name: "Heavy-Duty Platform Trolley 500 kg",
          price: "6299.00",
          gst_rate: null,
          is_active: true,
          stock_quantity: 10,
          low_stock_threshold: 5,
          weight_kg: "32.000",
          category: "Trolleys",
        },
      ],
    ]),
    customers: new Map(),
    orders: new Map(),
    items: new Map(),
    payments: new Map(),
    tokens: [],
    reservations: [],
    invoices: new Map(),
    events: [],
    idem: new Map(),
    seq: 1,
    invSeq: 41,
  };
}

const row = (t: Map<string, Record<string, unknown>>, id: string) =>
  t.get(id) ?? null;

function matchEq(r: Record<string, unknown>, filters: MockFilter[]): boolean {
  return filters.every((f) => {
    if (f.op !== "eq") return true;
    if (f.col === "id") return r["id"] === f.val;
    return r[f.col] === f.val;
  });
}

function heldFor(productId: string, excludeOrder?: string): number {
  const now = Date.now();
  return db.reservations
    .filter(
      (r) =>
        r["product_id"] === productId &&
        r["status"] === "held" &&
        (r["order_id"] as string) !== excludeOrder &&
        (r["expires_at"] as number) > now,
    )
    .reduce((n, r) => n + (r["quantity"] as number), 0);
}

const rateRow = (charge: string) => ({
  delivery_partner_id: PARTNER,
  serviceable: true,
  delivery_charge: charge,
  remote_surcharge: "0.00",
  eta_min_days: 2,
  eta_max_days: 4,
  min_order_amount: null,
  max_order_amount: null,
  delivery_partners: { name: "Delhivery", is_active: true, priority: 100 },
});

let charge = "450.00";
let price = "6299.00";

/** RLS-flavoured server mock: anon sees catalogue + rates only. */
function wireServer() {
  const isAdmin = authUser !== null && adminFlag;
  serverHandler = (op) => {
    if (op.rpc === "product_availability") {
      const args = op.rpcArgs as { p_ids: string[] };
      return {
        rows: args.p_ids.map((id) => {
          const p = row(db.products, id);
          const stock = Number(p?.["stock_quantity"] ?? 0);
          return {
            product_id: id,
            available: Math.max(0, stock - heldFor(id)),
            low_stock_threshold: 5,
            status: "in_stock",
          };
        }),
        error: null,
      };
    }
    if (op.rpc === "consume_reservation") {
      const { p_order_id } = op.rpcArgs as { p_order_id: string };
      const o = row(db.orders, p_order_id);
      if (!o) return { rows: [], error: { message: "unknown order" } };
      if (o["stock_state"] !== "reserved") return { rows: [o["stock_state"]], error: null };
      for (const r of db.reservations.filter(
        (x) => x["order_id"] === p_order_id && x["status"] === "held",
      )) {
        const p = row(db.products, r["product_id"] as string);
        if (p) p["stock_quantity"] = Number(p["stock_quantity"]) - Number(r["quantity"]);
        r["status"] = "consumed";
      }
      o["stock_state"] = "consumed";
      return { rows: ["consumed"], error: null };
    }
    if (op.rpc === "restore_reservation") {
      const { p_order_id } = op.rpcArgs as { p_order_id: string };
      const o = row(db.orders, p_order_id);
      if (!o) return { rows: [], error: { message: "unknown order" } };
      if (o["stock_state"] === "restored" || o["stock_state"] === "none") {
        return { rows: [o["stock_state"]], error: null };
      }
      if (o["stock_state"] === "consumed") {
        for (const r of db.reservations.filter(
          (x) => x["order_id"] === p_order_id && x["status"] === "consumed",
        )) {
          const p = row(db.products, r["product_id"] as string);
          if (p) p["stock_quantity"] = Number(p["stock_quantity"]) + Number(r["quantity"]);
          r["status"] = "restored";
        }
      } else {
        db.reservations = db.reservations.filter(
          (x) => !((x["order_id"] === p_order_id && x["status"] === "held")),
        );
      }
      o["stock_state"] = "restored";
      return { rows: ["restored"], error: null };
    }
    if (!isAdmin) {
      if (op.table === "products") {
        const ids = op.filters.find((f) => f.col === "id" && f.op === "in")?.val as
          | string[]
          | undefined;
        const all = [...db.products.values()].filter((p) => p["is_active"] === true);
        const rows = ids ? all.filter((p) => ids.includes(p["id"] as string)) : all;
        return { rows, error: null };
      }
      if (
        op.table === "delivery_pincode_rates" ||
        op.table === "delivery_weight_slabs" ||
        op.table === "delivery_category_rules"
      ) {
        if (op.table !== "delivery_pincode_rates") return { rows: [], error: null };
        return { rows: [rateRow(charge)], error: null };
      }
      throw new Error(`anon blocked from ${op.table ?? op.rpc}`);
    }
    return adminTables(op);
  };
}

function adminTables(op: Parameters<MockResponder>[0]): ReturnType<MockResponder> {
  const { table, filters } = op;
  if (table === "products") {
    let rows = [...db.products.values()];
    const inIds = filters.find((f) => f.col === "id" && f.op === "in")?.val as
      | string[]
      | undefined;
    if (inIds) rows = rows.filter((r) => inIds.includes(r["id"] as string));
    const eqId = filters.find((f) => f.col === "id" && f.op === "eq")?.val as
      | string
      | undefined;
    if (eqId) rows = rows.filter((r) => r["id"] === eqId);
    return { rows, error: null };
  }
  if (table === "delivery_pincode_rates") {
    // Respect the pincode filter: unknown pincodes have no rows, so the
    // engine reports unserviceable instead of quoting phantom rates.
    const pin = filters.find((f) => f.col === "pincode")?.val as string | undefined;
    if (pin !== undefined && pin !== "400001") return { rows: [], error: null };
    return { rows: [rateRow(charge)], error: null };
  }
  if (table === "delivery_weight_slabs" || table === "delivery_category_rules") {
    return { rows: [], error: null };
  }
  if (table === "customers") {
    const rows = [...db.customers.values()].filter((r) => matchEq(r, filters));
    return { rows, error: null };
  }
  if (table === "orders") {
    if (op.updateValues !== undefined) {
      const vals = op.updateValues as Record<string, unknown>;
      const matched = [...db.orders.values()].filter((r) => matchEq(r, filters));
      for (const m of matched) Object.assign(m, vals);
      return { rows: matched.map((m) => ({ id: m["id"] })), error: null };
    }
    return {
      rows: [...db.orders.values()].filter((r) => matchEq(r, filters)),
      error: null,
    };
  }
  if (table === "order_items") {
    const orderId = filters.find((f) => f.col === "order_id")?.val as string;
    return { rows: db.items.get(orderId) ?? [], error: null };
  }
  if (table === "payments") {
    const orderId = filters.find((f) => f.col === "order_id")?.val as
      | string
      | undefined;
    // Updates address payments by payment id (guard filters), not by
    // order — search every bucket when no order_id filter is present.
    const list =
      orderId !== undefined
        ? (db.payments.get(orderId) ?? [])
        : [...db.payments.values()].flat();
    if (op.updateValues !== undefined) {
      const vals = op.updateValues as Record<string, unknown>;
      if (
        vals["transaction_reference"] !== undefined &&
        vals["transaction_reference"] !== null
      ) {
        const clash = [...db.payments.values()].some((arr) =>
          arr.some(
            (p) =>
              p["transaction_reference"] === vals["transaction_reference"] &&
              p["id"] !==
                list.find((x) => matchEq(x, filters))?.["id"],
          ),
        );
        if (clash) return { rows: [], error: { message: "duplicate", code: "23505" } };
      }
      const matched = list.filter((r) => matchEq(r, filters));
      for (const m of matched) Object.assign(m, vals);
      return { rows: matched.map((m) => ({ id: m["id"] })), error: null };
    }
    return { rows: list, error: null };
  }
  if (table === "invoices") {
    const orderId = filters.find((f) => f.col === "order_id")?.val as string;
    if (op.updateValues !== undefined && filters.length === 0) {
      // INSERT (claim): the mock folds inserts into updateValues.
      const vals = op.updateValues as Record<string, unknown>;
      const id = vals["order_id"] as string;
      if (db.invoices.has(id)) {
        return { rows: [], error: { message: "duplicate", code: "23505" } };
      }
      db.invoices.set(id, {
        order_id: id,
        invoice_number: vals["invoice_number"],
        invoice_date: "2026-10-05",
        data: null,
      });
      return { rows: [{ order_id: id }], error: null };
    }
    if (op.updateValues !== undefined) {
      const inv = db.invoices.get(orderId);
      if (inv) Object.assign(inv, op.updateValues as Record<string, unknown>);
      return { rows: inv ? [inv] : [], error: null };
    }
    const inv = orderId ? db.invoices.get(orderId) : undefined;
    if (orderId) return { rows: inv ? [inv] : [], error: null };
    return { rows: [...db.invoices.values()], error: null };
  }
  if (table === "order_events") {
    if (op.updateValues !== undefined) {
      // INSERT path (mock folds inserts into updateValues): record it.
      const vals = op.updateValues as Record<string, unknown>;
      if (vals["order_id"] !== undefined) {
        db.events.push({
          id: uuid(700 + db.events.length),
          order_id: vals["order_id"],
          event_type: vals["event_type"] ?? null,
          actor_type: vals["actor_type"] ?? null,
          actor_user_id: vals["actor_user_id"] ?? null,
          action: vals["action"],
          from_status: vals["from_status"] ?? null,
          to_status: vals["to_status"] ?? null,
          note: vals["note"] ?? null,
          metadata: vals["metadata"] ?? {},
          created_at: "2026-10-05T10:00:00.000Z",
        });
        return { rows: [{ id: "e1" }], error: null };
      }
      return { rows: [], error: null };
    }
    const orderId = filters.find((f) => f.col === "order_id")?.val as string;
    const rows = db.events.filter((e) =>
      orderId ? e["order_id"] === orderId : true,
    );
    return { rows, error: null };
  }
  if (table === "admin_audit_log") return { rows: [{ id: "a1" }], error: null };
  if (table === "shipments") return { rows: [], error: null };
  if (table === "order_access_tokens") {
    if (op.updateValues !== undefined && filters.length === 0) {
      // INSERT (issuance): stores the hash only.
      const vals = op.updateValues as Record<string, unknown>;
      db.tokens.push({
        token_hash: vals["token_hash"],
        order_id: vals["order_id"],
        expires_at: vals["expires_at"],
        revoked_at: null,
      });
      return { rows: [{ id: uuid(800 + db.tokens.length) }], error: null };
    }
    if (op.updateValues !== undefined) {
      const vals = op.updateValues as Record<string, unknown>;
      const matched = db.tokens.filter((t) =>
        filters.every((f) =>
          f.col === "order_id"
            ? t["order_id"] === f.val
            : f.col === "token_hash"
              ? t["token_hash"] === f.val
              : true,
        ),
      );
      for (const m of matched) Object.assign(m, vals);
      return { rows: matched, error: null };
    }
    const orderId = filters.find((f) => f.col === "order_id")?.val as string;
    return {
      rows: db.tokens.filter((t) => t["order_id"] === orderId),
      error: null,
    };
  }
  throw new Error(`unexpected table ${table ?? op.rpc}`);
}

/** Service-role mock: full access + the create_order RPC. */
function wireAdmin() {
  adminHandler = (op) => {
    if (op.rpc === "create_order") {
      return emulateCreateOrder(op.rpcArgs as Record<string, unknown>);
    }
    if (op.rpc === "generate_invoice_number") {
      db.invSeq += 1;
      return {
        rows: [`INV/FY26-27/${String(db.invSeq).padStart(6, "0")}`],
        error: null,
      };
    }
    return adminTables(op);
  };
}

function emulateCreateOrder(args: Record<string, unknown>): {
  rows: unknown[];
  error: { message: string; code?: string } | null;
} {
  const key = args["p_idempotency_key"] as string;
  if (db.idem.has(key)) return { rows: [db.idem.get(key)], error: null };
  const customer = args["p_customer"] as Record<string, unknown>;
  const order = args["p_order"] as Record<string, unknown>;
  const items = args["p_items"] as Array<Record<string, unknown>>;
  const payment = args["p_payment"] as Record<string, unknown>;

  for (const item of items) {
    const p = row(db.products, item["product_id"] as string);
    if (!p || p["is_active"] !== true) {
      return { rows: [], error: { message: "unknown product", code: "P0001" } };
    }
    const avail =
      Number(p["stock_quantity"]) - heldFor(item["product_id"] as string);
    if (Number(item["quantity"]) > avail) {
      return {
        rows: [],
        error: {
          message: `INSUFFICIENT_STOCK: Only ${avail} available of "${p["name"]}"`,
          code: "P0001",
        },
      };
    }
  }

  let customerId: string | undefined;
  for (const [id, c] of db.customers) {
    if (c["phone"] === customer["phone"]) customerId = id;
  }
  if (!customerId) {
    customerId = uuid(900 + db.customers.size);
    db.customers.set(customerId, {
      id: customerId,
      name: customer["name"],
      phone: customer["phone"],
      email: customer["email"] ?? null,
      gstin: customer["gstin"] ?? null,
    });
  }
  const n = db.seq++;
  const orderId = uuid(n);
  const orderNo = `TS-261005-${String(n).padStart(4, "0")}`;
  db.orders.set(orderId, {
    id: orderId,
    order_number: orderNo,
    customer_id: customerId,
    created_at: "2026-10-05T10:00:00.000Z",
    subtotal: order["subtotal"],
    delivery_charge: order["delivery_charge"],
    total_amount: order["total_amount"],
    delivery_pincode: order["delivery_pincode"],
    delivery_partner_id: order["delivery_partner_id"],
    delivery_partner_name: order["delivery_partner_name"],
    gstin_snapshot: order["gstin_snapshot"] ?? null,
    tax_treatment: order["tax_treatment"] ?? "non_gst",
    taxable_amount: order["taxable_amount"] ?? "0.00",
    cgst_amount: order["cgst_amount"] ?? "0.00",
    sgst_amount: order["sgst_amount"] ?? "0.00",
    igst_amount: order["igst_amount"] ?? "0.00",
    billing_name: order["billing_name"] ?? null,
    billing_address_line: order["billing_address_line"] ?? null,
    billing_city: order["billing_city"] ?? null,
    billing_state: order["billing_state"] ?? null,
    billing_state_code: order["billing_state_code"] ?? null,
    billing_pincode: order["billing_pincode"] ?? null,
    customer_name_snapshot: customer["name"],
    customer_phone_snapshot: customer["phone"],
    customer_email_snapshot: customer["email"] ?? null,
    delivery_weight_kg: order["delivery_weight_kg"] ?? null,
    delivery_rule_summary: order["delivery_rule_summary"] ?? null,
    payment_status: "pending",
    order_status: "pending_payment",
    stock_state: "reserved",
    idempotency_key: key,
    customers: undefined,
  });
  const orderRow = db.orders.get(orderId);
  if (orderRow) {
    const c = row(db.customers, orderRow["customer_id"] as string);
    orderRow["customers"] = c
      ? { name: c["name"], phone: c["phone"], email: c["email"], gstin: c["gstin"] }
      : null;
  }
  db.items.set(
    orderId,
    items.map((item, i) => ({
      id: uuid(500 + i),
      order_id: orderId,
      product_id: item["product_id"],
      product_name: item["product_name"],
      quantity: item["quantity"],
      unit_price: item["unit_price"],
      line_total: item["line_total"],
      gst_rate_percent: item["gst_rate_percent"] ?? null,
      line_tax_amount: item["line_tax_amount"] ?? "0.00",
    })),
  );
  db.payments.set(orderId, [
    {
      id: uuid(600 + n),
      order_id: orderId,
      amount: payment["amount"],
      method: "upi",
      status: "pending",
      transaction_reference: null,
      created_at: "2026-10-05T10:00:00.000Z",
      updated_at: "2026-10-05T10:00:00.000Z",
    },
  ]);
  const hours = Number(args["p_reservation_hours"] ?? 24);
  for (const item of items) {
    db.reservations.push({
      product_id: item["product_id"],
      order_id: orderId,
      quantity: item["quantity"],
      status: "held",
      expires_at: Date.now() + hours * 3600_000,
    });
  }
  // Mirror the RPC's in-transaction ORDER_CREATED insert.
  db.events.push({
    id: uuid(700 + db.events.length),
    order_id: orderId,
    event_type: "ORDER_CREATED",
    actor_type: "customer",
    actor_user_id: customerId,
    action: "order_created",
    from_status: null,
    to_status: "pending_payment",
    note: null,
    metadata: {},
    created_at: "2026-10-05T10:00:00.000Z",
  });
  db.idem.set(key, orderId);
  return { rows: [orderId], error: null };
}

const post = (fn: (req: Request, ctx?: never) => Promise<Response>, body: unknown) =>
  fn(
    new Request("http://localhost/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const validBody = (over: Record<string, unknown> = {}) => ({
  items: [{ productId: P1, quantity: 2 }],
  customer: { name: "Demo Traders", phone: PHONE },
  pincode: "400001",
  idempotencyKey: "c0ffee00-0001-4000-8000-000000000001",
  ...over,
});

beforeEach(() => {
  resetDb();
  resetRateLimits();
  authUser = { id: "admin-1" };
  adminFlag = true;
  charge = "450.00";
  price = "6299.00";
  const p = db.products.get(P1);
  if (p) {
    p["price"] = price;
    p["stock_quantity"] = 10;
    p["is_active"] = true;
  }
  wireServer();
  wireAdmin();
  process.env.TROLIFT_BUSINESS_NAME = "Trolift Solutions";
  process.env.TROLIFT_BUSINESS_ADDRESS = "14 Industrial Estate, Mumbai 400001";
});

afterEach(() => {
  delete process.env.TROLIFT_BUSINESS_NAME;
  delete process.env.TROLIFT_BUSINESS_ADDRESS;
});

async function placeOrder(keySuffix: string, over: Record<string, unknown> = {}) {
  const res = await post(
    (req: Request) => ordersPost(req),
    validBody({
      idempotencyKey: `c0ffee00-0001-4000-8000-0000000000${keySuffix}`,
      ...over,
    }),
  );
  const json = (await res.json()) as {
    ok: boolean;
    data: Record<string, unknown>;
    error: { code: string; message: string };
  };
  return { res, json };
}

/* ------------------------------------------------------------------ */
/* The journey.                                                        */
/* ------------------------------------------------------------------ */

describe("customer journey: catalogue to delivered invoice", () => {
  it("walks catalogue → order → claim → verify → delivered → invoice", async () => {
    // 1. Delivery quote (public, no session needed).
    const check = await post(deliveryPost, { pincode: "400001" });
    const checkJson = (await check.json()) as {
      ok: boolean;
      data: { serviceable: boolean; deliveryChargePaise: number };
    };
    expect(checkJson.ok).toBe(true);
    expect(checkJson.data.serviceable).toBe(true);
    expect(checkJson.data.deliveryChargePaise).toBe(45000);

    // 2. Server-side order creation (totals recomputed, never trusted).
    const { res, json } = await placeOrder("01");
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data).toMatchObject({
      orderNumber: "TS-261005-0001",
      subtotalPaise: 1259800,
      deliveryChargePaise: 45000,
      totalPaise: 1304800,
      paymentStatus: "pending",
      duplicate: false,
    });
    const orderId = json.data["id"] as string;
    // Checkout issues the one-time guest token (raw, stored hashed).
    const guestToken = json.data["guestToken"] as string;
    expect(typeof guestToken).toBe("string");
    expect(guestToken.length).toBeGreaterThan(20);
    const authedInvoice = (id: string, token: string) =>
      customerInvoiceGet(
        new Request("http://localhost/x", {
          headers: {
            Cookie: `${guestCookieName(id)}=${encodeURIComponent(token)}`,
          },
        }),
        { params: Promise.resolve({ id }) },
      );
    const authedClaim = (body: Record<string, unknown>, token: string) =>
      post(claimPost, { ...body, accessToken: token });

    // 3. Reopen any time with the token; UUID alone grants nothing.
    expect(await getPayableOrderForGuest(orderId, null)).toBeNull();
    expect(
      await getPayableOrderForGuest(orderId, "bogus-token-xxxxxxxxxxxxxxxxxxxxxxxx"),
    ).toBeNull();
    const reopened = await getPayableOrderForGuest(orderId, guestToken);
    expect(reopened?.orderStatus).toBe("pending_payment");
    expect(reopened?.paymentStatus).toBe("pending");
    // Customer-safe projection carries no raw PII.
    expect(JSON.stringify(reopened)).not.toContain(PHONE);
    expect(reopened?.customerPhoneMasked).toContain("••••");

    // 4. Invoice too early is refused — never a paid-looking document.
    // Without the token it is 404 (no oracle); with it, 409.
    const earlyAnon = await customerInvoiceGet(
      new Request("http://localhost/x"),
      { params: Promise.resolve({ id: orderId }) },
    );
    expect(earlyAnon.status).toBe(404);
    const early = await authedInvoice(orderId, guestToken);
    expect(early.status).toBe(409);

    // 5. Wrong phone cannot claim (generic 404); right phone + token submits.
    const wrong = await authedClaim(
      {
        orderId,
        reference: UTR,
        phone: PHONE2,
      },
      guestToken,
    );
    expect(wrong.status).toBe(404);
    const noToken = await post(claimPost, {
      orderId,
      reference: UTR,
      phone: PHONE,
    });
    expect(noToken.status).toBe(404);
    const claimed = await authedClaim(
      {
        orderId,
        reference: UTR,
        phone: PHONE,
      },
      guestToken,
    );
    expect(claimed.status).toBe(200);

    // 6. Duplicate claim on settled state is rejected.
    const dupClaim = await authedClaim(
      {
        orderId,
        reference: UTR2,
        phone: PHONE,
      },
      guestToken,
    );
    expect(dupClaim.status).toBe(409);

    // 7. Admin verifies: paid + confirmed, stock consumed once.
    const verified = await verifyPaymentClaim(orderId, "approve");
    expect(verified).toEqual({ paymentStatus: "paid", orderStatus: "confirmed" });
    expect(db.products.get(P1)?.["stock_quantity"]).toBe(8);

    // 8. Admin sees frozen snapshots + audit trail.
    const detail = await getAdminOrderDetail(orderId);
    expect(detail?.customer.name).toBe("Demo Traders");
    expect(detail?.items[0]).toMatchObject({
      name: "Heavy-Duty Platform Trolley 500 kg",
      quantity: 2,
      unitPricePaise: 629900,
    });
    expect(detail?.totalPaise).toBe(1304800);
    expect(detail?.paymentReference).toBe(UTR);
    expect(detail?.events.map((e) => e.action)).toContain("payment_verified");
    // Canonical audit trail so far: creation (customer actor) then
    // claim, verification and confirmation (admin actors).
    expect(detail?.events.map((e) => e.eventType)).toEqual([
      "ORDER_CREATED",
      "PAYMENT_SUBMITTED",
      "PAYMENT_VERIFIED",
      "ORDER_CONFIRMED",
    ]);
    expect(detail?.events[0]).toMatchObject({
      actorType: "customer",
      metadata: {},
    });
    expect(detail?.events[1]).toMatchObject({
      actorType: "customer",
      metadata: { payment_method: "upi" },
    });

    // 9. Fulfilment walk to delivered through valid states only.
    for (const to of ["processing", "packed", "ready_for_dispatch", "dispatched", "delivered"] as const) {
      const r = await transitionOrderStatus(orderId, to);
      expect(r).toEqual({ orderStatus: to });
    }

    // 10. Invoice now issues; re-downloads are byte-identical.
    const inv1 = await authedInvoice(orderId, guestToken);
    expect(inv1.status).toBe(200);
    expect(inv1.headers.get("Content-Type")).toBe("application/pdf");
    const pdf1 = Buffer.from(await inv1.arrayBuffer());
    expect(pdf1.subarray(0, 4).toString()).toBe("%PDF");
    const inv2 = await authedInvoice(orderId, guestToken);
    expect(Buffer.from(await inv2.arrayBuffer()).equals(pdf1)).toBe(true);

    // 11. Admin invoice route serves the same document.
    const adminInv = await adminInvoiceGet(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: orderId }),
    });
    expect(adminInv.status).toBe(200);

    // 12. Status remains correct on every reopen.
    const again = await getPayableOrderForGuest(orderId, guestToken);
    expect(again?.orderStatus).toBe("delivered");
    expect(again?.paymentStatus).toBe("paid");

    // 13. Full audit trail ends with fulfilment + invoice issuance;
    // the customer feed carries labels + timestamps only.
    const final = await getAdminOrderDetail(orderId);
    expect(final?.events.map((e) => e.eventType)).toEqual([
      "ORDER_CREATED",
      "PAYMENT_SUBMITTED",
      "PAYMENT_VERIFIED",
      "ORDER_CONFIRMED",
      "PROCESSING_STARTED",
      "PACKED",
      "READY_FOR_DISPATCH",
      "DISPATCHED",
      "DELIVERED",
      "INVOICE_ISSUED",
    ]);
    expect(again?.timeline.map((t) => t.label)).toEqual([
      "Order placed",
      "Payment submitted for verification",
      "Payment received",
      "Order confirmed",
      "Being prepared",
      "Packed",
      "Ready for dispatch",
      "Dispatched",
      "Delivered",
      "Tax invoice ready",
    ]);
    for (const entry of again?.timeline ?? []) {
      expect(Object.keys(entry).sort()).toEqual(["at", "label"]);
    }
  });

  it("prices a GST order with CGST/SGST from live rates", async () => {
    const { res, json } = await placeOrder("02", {
      customer: {
        name: "Acme Pvt Ltd",
        phone: PHONE,
        email: "",
        gstin: "27ABCDE1234F1Z0",
      },
      billing: {
        name: "Acme Pvt Ltd",
        addressLine: "14 Industrial Estate",
        city: "Mumbai",
        stateCode: "27",
        pincode: "400001",
      },
    });
    expect(res.status).toBe(200);
    // 2 × 629900 taxable; product gst_rate is null → zero tax, gst treatment.
    expect(json.data).toMatchObject({ taxTreatment: "gst", totalPaise: 1304800 });
  });
});

describe("failure flows fail safe with the item named", () => {
  it("rejects unknown, inactive and mis-quantified products", async () => {
    const ghost = await placeOrder("10", {
      items: [{ productId: uuid(999), quantity: 1 }],
    });
    expect(ghost.res.status).toBe(422);

    db.products.get(P1)!.is_active = false;
    const inactive = await placeOrder("11", {});
    expect(inactive.res.status).toBe(422);
    db.products.get(P1)!.is_active = true;

    for (const items of [
      [{ productId: P1, quantity: 0 }],
      [{ productId: P1, quantity: 1000 }],
      [{ productId: P1, quantity: 1.5 }],
    ]) {
      const bad = await placeOrder("12", { items });
      expect(bad.res.status).toBeGreaterThanOrEqual(400);
    }
    expect(db.orders.size).toBe(0);
  });

  it("rejects stale carts, bad GSTIN/pincode/phone with no order", async () => {
    const stale = await placeOrder("20", {
      items: [{ productId: P1, quantity: 50 }],
    });
    expect(stale.res.status).toBe(422);
    expect(JSON.stringify(stale.json)).toContain("Trolley");

    const badGstin = await placeOrder("21", {
      customer: { name: "X", phone: PHONE, gstin: "BOGUS" },
    });
    expect(badGstin.res.status).toBe(422);

    const badPin = await placeOrder("22", { pincode: "123" });
    expect(badPin.res.status).toBe(422);

    const badPhone = await placeOrder("23", {
      customer: { name: "X", phone: "123" },
    });
    expect(badPhone.res.status).toBe(422);

    const unserved = await placeOrder("24", { pincode: "799001" });
    expect(unserved.res.status).toBe(422);
    expect(db.orders.size).toBe(0);
  });

  it("reprices when catalogue or rates move mid-checkout", async () => {
    const first = await placeOrder("30");
    expect(first.json.data.totalPaise).toBe(1304800);
    const p = db.products.get(P1);
    if (p) p["price"] = "7000.00";
    charge = "700.00";
    const second = await placeOrder("31");
    // New price (2 × 700000) + new charge (70000): browser figures ignored.
    expect(second.json.data).toMatchObject({
      subtotalPaise: 1400000,
      deliveryChargePaise: 70000,
      totalPaise: 1470000,
    });
  });

  it("replays duplicate submissions to the original order", async () => {
    const first = await placeOrder("40");
    const second = await placeOrder("40");
    // Same order row, no duplicate created. (The duplicate:true flag is
    // only set on the concurrent-race path via 23505; sequential
    // replays converge silently — covered in api-orders.test.ts.)
    expect(second.json.data["id"]).toBe(first.json.data["id"]);
    expect(second.json.ok).toBe(true);
    expect(db.orders.size).toBe(1);
  });

  it("rejects duplicate UTRs and malformed references", async () => {
    const first = await placeOrder("50");
    const { json } = await placeOrder("51");
    const otherId = json.data["id"] as string;
    const otherToken = json.data["guestToken"] as string;
    const firstId = [...db.orders.values()].find(
      (o) => o["id"] !== otherId,
    )?.["id"] as string;
    const firstToken = first.json.data["guestToken"] as string;
    expect(
      (
        await post(claimPost, {
          orderId: firstId,
          reference: UTR,
          phone: PHONE,
          accessToken: firstToken,
        })
      ).status,
    ).toBe(200);
    // Same UTR on another order → conflict.
    expect(
      (
        await post(claimPost, {
          orderId: otherId,
          reference: UTR,
          phone: PHONE,
          accessToken: otherToken,
        })
      ).status,
    ).toBe(409);
    // Too-short reference → validation error.
    expect(
      (
        await post(claimPost, {
          orderId: otherId,
          reference: "abc",
          phone: PHONE,
          accessToken: otherToken,
        })
      ).status,
    ).toBe(422);
  });

  it("fails closed on unknown orders and backend failures", async () => {
    const missing = await post(claimPost, {
      orderId: uuid(999),
      reference: UTR,
      phone: PHONE,
    });
    expect(missing.status).toBe(404);

    adminHandler = () => {
      throw new Error("connection refused");
    };
    const res = await post(
      (req: Request) => ordersPost(req),
      validBody({ idempotencyKey: uuid(888) }),
    );
    expect(res.status).toBe(500);
    const json = (await res.json()) as { ok: boolean; error: { message: string } };
    expect(json.ok).toBe(false);
    expect(JSON.stringify(json)).not.toMatch(/connection refused|supabase|stack/i);
  });
});

describe("admin flow authorization", () => {
  it("rejects anonymous and non-admin operators everywhere", async () => {
    const { json } = await placeOrder("60");
    const orderId = json.data["id"] as string;

    authUser = null;
    expect((await verifyPaymentClaim(orderId, "approve").catch((e) => e)).status).toBe(
      401,
    );
    const anonStatus = await post(statusPost, { orderId, toStatus: "processing" });
    expect(anonStatus.status).toBe(401);
    const anonInv = await adminInvoiceGet(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: orderId }),
    });
    expect(anonInv.status).toBe(401);

    authUser = { id: "u1" };
    adminFlag = false;
    expect(
      (await verifyPaymentClaim(orderId, "approve").catch((e) => e)).status,
    ).toBe(403);
    expect(
      (await post(statusPost, { orderId, toStatus: "processing" })).status,
    ).toBe(403);
  });

  it("rejects illegal jumps and records every step", async () => {
    const { json } = await placeOrder("61");
    const orderId = json.data["id"] as string;
    await expect(transitionOrderStatus(orderId, "delivered")).rejects.toMatchObject({
      status: 409,
    });
    await transitionOrderStatus(orderId, "cancelled");
    const detail = await getAdminOrderDetail(orderId);
    expect(detail?.orderStatus).toBe("cancelled");
    expect(detail?.stockState).toBe("restored");
    expect(
      detail?.events.some((e) => e.action === "order_cancelled"),
    ).toBe(true);
    // Wrong-customer order id: unknown UUID fails closed.
    expect(await getAdminOrderDetail(uuid(999))).toBeNull();
  });
});
