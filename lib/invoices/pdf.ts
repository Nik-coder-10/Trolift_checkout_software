import "server-only";
import PDFDocument from "pdfkit";
import type { InvoiceData } from "@/lib/invoices/data";

/**
 * Tax-invoice PDF renderer (server-only, Node runtime).
 *
 * Rendered EXCLUSIVELY from a frozen InvoiceData document — this module
 * performs no DB reads and no arithmetic beyond layout (every rupee is
 * copied verbatim from the canonical totals). A4, Helvetica throughout
 * (built-in fonts: no font files, no network), high-contrast B/W-safe
 * palette, deterministic metadata (CreationDate = invoice date) so the
 * same frozen document always yields the same bytes.
 *
 * Currency uses "Rs." (never the ₹ glyph — it is absent from WinAnsi
 * standard fonts and would render blank) with en-IN digit grouping,
 * computed from integer paise without floats.
 */

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const INK = "#1a1a1a";
const MUTED = "#525252";
const ACCENT = "#1f3a4d";
const RULE = "#a3a3a3";

/** Exact en-IN grouping from integer paise (no floats anywhere). */
export function formatINR(paise: number): string {
  const rupees = Math.trunc(paise / 100);
  const p = Math.abs(paise % 100);
  return `Rs. ${rupees.toLocaleString("en-IN")}.${String(p).padStart(2, "0")}`;
}

function rateLabel(rate: string | number | null): string {
  if (rate === null) return "—";
  const n = Number(rate);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;
}

interface Ctx {
  doc: InstanceType<typeof PDFDocument>;
}

function header(ctx: Ctx, invoice: InvoiceData): void {
  const { doc } = ctx;
  doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(18);
  doc.text(invoice.business.name.toUpperCase(), MARGIN, MARGIN, {
    width: CONTENT_WIDTH - 200,
  });
  doc.fillColor(MUTED).font("Helvetica").fontSize(8.5);
  const lines = [invoice.business.address];
  const contact = [invoice.business.phone, invoice.business.email]
    .filter(Boolean)
    .join(" · ");
  if (contact) lines.push(contact);
  if (invoice.business.gstin) lines.push(`GSTIN: ${invoice.business.gstin}`);
  doc.text(lines.join("\n"), MARGIN, doc.y + 2, { width: CONTENT_WIDTH - 200 });

  const top = MARGIN;
  doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(16);
  doc.text("TAX INVOICE", PAGE_WIDTH - MARGIN - 200, top, {
    width: 200,
    align: "right",
  });
  doc.fillColor(INK).font("Helvetica").fontSize(9);
  doc.text(
    `No: ${invoice.invoiceNumber}\nDate: ${invoice.invoiceDate}\nOrder: ${invoice.orderNumber}\nPayment: ${invoice.paymentStatus} (${invoice.paymentMethod})`,
    PAGE_WIDTH - MARGIN - 200,
    doc.y + 2,
    { width: 200, align: "right" },
  );
  doc.moveDown(0.6);
  rule(ctx);
}

function rule(ctx: Ctx): void {
  const { doc } = ctx;
  doc
    .strokeColor(RULE)
    .lineWidth(0.75)
    .moveTo(MARGIN, doc.y)
    .lineTo(PAGE_WIDTH - MARGIN, doc.y)
    .stroke();
  doc.moveDown(0.6);
}

function parties(ctx: Ctx, invoice: InvoiceData): void {
  const { doc } = ctx;
  const colW = (CONTENT_WIDTH - 16) / 2;
  const startY = doc.y;

  doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(10);
  doc.text("Bill to", MARGIN, startY, { width: colW });
  doc.fillColor(INK).font("Helvetica").fontSize(9);
  const billLines = [
    invoice.customer.name,
    invoice.billing.addressLine,
    [invoice.billing.city, invoice.billing.state, invoice.billing.pincode]
      .filter(Boolean)
      .join(", "),
    `Phone: ${invoice.customer.phone}`,
  ];
  if (invoice.customer.email) billLines.push(`Email: ${invoice.customer.email}`);
  if (invoice.customer.gstin) billLines.push(`GSTIN: ${invoice.customer.gstin}`);
  else billLines.push("GSTIN: — (no GST charged)");
  doc.text(
    billLines.filter((l) => l !== "").join("\n"),
    MARGIN,
    doc.y + 2,
    { width: colW },
  );
  const leftEnd = doc.y;

  doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(10);
  doc.text("Ship to", MARGIN + colW + 16, startY, { width: colW });
  doc.fillColor(INK).font("Helvetica").fontSize(9);
  const shipLines = [
    invoice.shipping.name,
    `Phone: ${invoice.shipping.phone}`,
    `Delivery pincode: ${invoice.shipping.pincode}`,
    `Delivery partner: ${invoice.shipping.partnerName}`,
  ];
  doc.text(shipLines.join("\n"), MARGIN + colW + 16, doc.y + 2, {
    width: colW,
  });
  doc.y = Math.max(leftEnd, doc.y) + 6;
  rule(ctx);
}

interface Column {
  key: string;
  title: string;
  width: number;
  align: "left" | "right" | "center";
}

const COLUMNS: Column[] = [
  { key: "n", title: "#", width: 24, align: "center" },
  { key: "desc", title: "Description", width: 196, align: "left" },
  { key: "qty", title: "Qty", width: 32, align: "center" },
  { key: "unit", title: "Unit (Rs.)", width: 62, align: "right" },
  { key: "taxable", title: "Taxable", width: 62, align: "right" },
  { key: "rate", title: "GST%", width: 40, align: "center" },
  { key: "tax", title: "Tax", width: 62, align: "right" },
  { key: "total", title: "Line total", width: 77, align: "right" },
];

function tableHead(ctx: Ctx, y: number): number {
  const { doc } = ctx;
  let x = MARGIN;
  doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(8.5);
  for (const c of COLUMNS) {
    doc.text(c.title, x, y, { width: c.width, align: c.align });
    x += c.width;
  }
  const bottom = doc.y + 3;
  doc
    .strokeColor(RULE)
    .lineWidth(0.5)
    .moveTo(MARGIN, bottom)
    .lineTo(PAGE_WIDTH - MARGIN, bottom)
    .stroke();
  return bottom + 4;
}

function ensureRoom(ctx: Ctx, height: number): void {
  const { doc } = ctx;
  if (doc.y + height > PAGE_HEIGHT - MARGIN - 30) {
    doc.addPage();
    tableHead(ctx, MARGIN);
  }
}

function itemsTable(ctx: Ctx, invoice: InvoiceData): void {
  const { doc } = ctx;
  let y = tableHead(ctx, doc.y);
  doc.fontSize(8.5);
  invoice.items.forEach((item, i) => {
    const cells = [
      String(i + 1),
      item.name,
      String(item.quantity),
      formatINR(item.unitPricePaise),
      formatINR(item.taxablePaise),
      rateLabel(item.gstRate),
      formatINR(item.taxPaise),
      formatINR(item.lineTotalPaise),
    ];
    const height =
      Math.max(
        ...cells.map((text, ci) =>
          doc.heightOfString(text, {
            width: COLUMNS[ci]?.width ?? 60,
          }),
        ),
      ) + 6;
    ensureRoom(ctx, height);
    y = doc.y;
    let x = MARGIN;
    doc.fillColor(INK).font("Helvetica");
    cells.forEach((text, ci) => {
      const col = COLUMNS[ci];
      if (!col) return;
      doc.text(text, x, y, { width: col.width, align: col.align });
      x += col.width;
    });
    doc.y = y + height;
  });
  doc
    .strokeColor(RULE)
    .lineWidth(0.5)
    .moveTo(MARGIN, doc.y)
    .lineTo(PAGE_WIDTH - MARGIN, doc.y)
    .stroke();
  doc.moveDown(0.6);
}

function totals(ctx: Ctx, invoice: InvoiceData): void {
  const { doc } = ctx;
  const t = invoice.totals;
  const rows: Array<[string, number, boolean]> = [
    ["Subtotal (ex-GST)", t.subtotalPaise, false],
  ];
  if (invoice.treatment === "gst") {
    if (t.cgstPaise + t.sgstPaise > 0) {
      rows.push(["CGST", t.cgstPaise, false]);
      rows.push(["SGST", t.sgstPaise, false]);
    } else {
      rows.push(["IGST", t.igstPaise, false]);
    }
  }
  rows.push([`Delivery (${invoice.shipping.partnerName})`, t.deliveryPaise, false]);
  rows.push(["Grand total", t.grandTotalPaise, true]);

  const labelW = 300;
  const valueW = CONTENT_WIDTH - labelW;
  ensureRoom(ctx, rows.length * 16 + 8);
  for (const [label, amount, bold] of rows) {
    const y = doc.y;
    doc
      .fillColor(bold ? ACCENT : MUTED)
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(bold ? 11 : 9);
    doc.text(label, PAGE_WIDTH - MARGIN - CONTENT_WIDTH, y, {
      width: labelW,
      align: "right",
    });
    doc
      .fillColor(bold ? ACCENT : INK)
      .text(formatINR(amount), PAGE_WIDTH - MARGIN - valueW, y, {
        width: valueW,
        align: "right",
      });
    doc.y = y + (bold ? 18 : 14);
  }
  doc.moveDown(0.4);
}

function footer(ctx: Ctx, invoice: InvoiceData): void {
  const { doc } = ctx;
  ensureRoom(ctx, 60);
  rule(ctx);
  doc.fillColor(MUTED).font("Helvetica").fontSize(8);
  const notes = [
    invoice.customer.gstin
      ? "Customer GSTIN is customer-provided and not government-verified."
      : invoice.treatment === "gst"
        ? "No customer GSTIN — B2C sale, GST charged with no input credit."
        : "No customer GSTIN — no GST charged on this order.",
    `Generated from frozen order ${invoice.orderNumber} snapshots — catalogue or profile edits cannot alter this document.`,
  ];
  doc.text(notes.join(" "), MARGIN, doc.y, { width: CONTENT_WIDTH });
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(8)
      .text(
        `Page ${i + 1} of ${pages.count} · ${invoice.invoiceNumber}`,
        MARGIN,
        PAGE_HEIGHT - MARGIN + 8,
        { width: CONTENT_WIDTH, align: "center" },
      );
  }
}

/** Render a frozen InvoiceData to a PDF Buffer (A4). */
export async function renderInvoicePdf(invoice: InvoiceData): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: {
      Title: `Tax Invoice ${invoice.invoiceNumber}`,
      Subject: `Trolift order ${invoice.orderNumber}`,
      Author: invoice.business.name,
      // Fixed metadata: identical frozen input → identical bytes.
      CreationDate: new Date(`${invoice.invoiceDate}T12:00:00Z`),
      ModDate: new Date(`${invoice.invoiceDate}T12:00:00Z`),
    },
  });
  const ctx: Ctx = { doc };
  header(ctx, invoice);
  parties(ctx, invoice);
  itemsTable(ctx, invoice);
  totals(ctx, invoice);
  footer(ctx, invoice);
  doc.flushPages();

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

/** Download filename: slashes are filesystem-hostile, use dashes. */
export function invoiceFilename(invoiceNumber: string): string {
  return `${invoiceNumber.replaceAll("/", "-")}.pdf`;
}
