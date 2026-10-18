import "server-only";
import PDFDocument from "pdfkit";
import { formatINR } from "@/lib/invoices/pdf";
import { amountInWords } from "@/lib/quotations/words";
import { loadQuotationLogo, loadQuotationSign } from "@/lib/quotations/assets";
import { getQuotationAbout } from "@/lib/quotations/config";
import type { QuotationData } from "@/lib/quotations/data";

/**
 * Quotation/proforma PDF renderer (server-only, Node runtime).
 *
 * Rendered EXCLUSIVELY from a frozen QuotationData document — no DB
 * reads and no arithmetic beyond layout (every rupee is copied
 * verbatim from the canonical totals). A4, Helvetica throughout
 * (built-in fonts: no font files, no network), blue/grey
 * B/W-tolerant palette, deterministic metadata (CreationDate = quote
 * date) so the same frozen document always yields the same bytes.
 *
 * Layout follows the reference quotation: Trolift logo top-right with
 * the QUOTATION title beneath it; Bill To printed ONLY when the
 * customer provided a GSTIN (a non-GST quotation carries the shipping
 * address alone); an "About Trolift Solutions" band; the frozen item
 * table and totals; and the proprietor's signature image above the
 * signatory line.
 *
 * The document is visually and textually a QUOTATION, never a tax
 * invoice: "QUOTATION" title, QTN-TS number, validity window, terms,
 * bank block and signatory — and an explicit provisional footer.
 * Currency uses "Rs." (never the ₹ glyph — absent from WinAnsi
 * standard fonts) with en-IN digit grouping from integer paise.
 */

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const INK = "#1a1a1a";
const MUTED = "#525252";
const BLUE = "#2563eb";
const LIGHT = "#e5e5e5";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** YYYY-MM-DD → "09 Oct 2026" (fail-safe: returns input when off-shape). */
export function formatQuoteDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1] ?? m[2];
  return `${m[3]} ${month} ${m[1]}`;
}

function rateLabel(rate: string | number | null): string {
  if (rate === null) return "—";
  const n = Number(rate);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;
}

interface Ctx {
  doc: InstanceType<typeof PDFDocument>;
  /** Header logo bytes (null only if the artwork failed to load). */
  logo: Buffer | null;
  /** Signatory signature-strip bytes (null only if load failed). */
  sign: Buffer | null;
}

/** Logo placement box, top-right (contain-fit, right-aligned). */
const LOGO_BOX = { width: 96, height: 60 };

function header(ctx: Ctx, quote: QuotationData): void {
  const { doc } = ctx;
  // Logo occupies the top-right corner; the QUOTATION title sits right
  // beneath it (at the very top when no logo is available).
  let titleY = MARGIN;
  if (ctx.logo) {
    doc.image(ctx.logo, PAGE_WIDTH - MARGIN - LOGO_BOX.width, MARGIN, {
      fit: [LOGO_BOX.width, LOGO_BOX.height],
      align: "center",
      valign: "center",
    });
    titleY = MARGIN + LOGO_BOX.height + 4;
  }
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(15);
  doc.text(quote.business.name.toUpperCase(), MARGIN, MARGIN, {
    width: CONTENT_WIDTH - 220,
  });
  doc.fillColor(MUTED).font("Helvetica").fontSize(8.5);
  const lines = [quote.business.address];
  const contact = [quote.business.phone, quote.business.email]
    .filter(Boolean)
    .join(" · ");
  if (contact) lines.push(contact);
  if (quote.business.gstin) lines.push(`GSTIN: ${quote.business.gstin}`);
  doc.text(lines.join("\n"), MARGIN, doc.y + 2, { width: CONTENT_WIDTH - 220 });

  doc.fillColor(BLUE).font("Helvetica-Bold").fontSize(22);
  doc.text("QUOTATION", PAGE_WIDTH - MARGIN - 220, titleY, {
    width: 220,
    align: "right",
  });
  doc.moveDown(0.8);
}

function metaTable(ctx: Ctx, quote: QuotationData): void {
  const { doc } = ctx;
  const colW = CONTENT_WIDTH / 4;
  const rows: Array<[string, string, string, string]> = [
    ["Quote No", quote.quotationNumber, "Quote Date", formatQuoteDate(quote.quotationDate)],
    ["Valid Till", formatQuoteDate(quote.validTill), "Place of Supply", quote.placeOfSupply ?? "—"],
  ];
  const startY = doc.y;
  const rowH = 20;
  rows.forEach((cells, ri) => {
    const y = startY + ri * rowH;
    cells.forEach((text, ci) => {
      const x = MARGIN + ci * colW;
      doc
        .strokeColor(LIGHT)
        .lineWidth(0.5)
        .rect(x, y, colW, rowH)
        .stroke();
      doc
        .fillColor(ci % 2 === 0 ? MUTED : INK)
        .font(ci % 2 === 0 ? "Helvetica" : "Helvetica-Bold")
        .fontSize(8.5);
      doc.text(text, x + 5, y + 5, { width: colW - 10 });
    });
  });
  doc.y = startY + rows.length * rowH + 6;
  doc
    .strokeColor(BLUE)
    .lineWidth(1.5)
    .moveTo(MARGIN, doc.y)
    .lineTo(PAGE_WIDTH - MARGIN, doc.y)
    .stroke();
  doc.moveDown(0.6);
}

/** Ship-To lines: full delivery address when the order snapshot has one. */
function shipToLines(quote: QuotationData): string[] {
  const s = quote.shipping;
  const address = (s.addressLine ?? "").trim();
  const lines = [s.name];
  if (address !== "") lines.push(address);
  lines.push(`Phone: ${s.phone}`);
  if (s.pincode !== "" && !address.includes(s.pincode)) {
    lines.push(`Delivery pincode: ${s.pincode}`);
  }
  if (s.partnerName.trim() !== "") {
    lines.push(`Delivery partner: ${s.partnerName}`);
  }
  return lines;
}

function parties(ctx: Ctx, quote: QuotationData): void {
  const { doc } = ctx;
  const colW = (CONTENT_WIDTH - 16) / 2;
  const startY = doc.y;
  // Billing address is printed ONLY when the customer provided a
  // GSTIN: without GST there is no tax consequence to bill against, so
  // the shipping address alone carries the document.
  const showBilling = (quote.customer.gstin ?? "").trim() !== "";

  if (!showBilling) {
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(10);
    doc.text("Ship To", MARGIN, startY, { width: CONTENT_WIDTH });
    doc.fillColor(INK).font("Helvetica").fontSize(9);
    doc.text(shipToLines(quote).join("\n"), MARGIN, doc.y + 2, {
      width: CONTENT_WIDTH,
    });
    doc.y += 8;
    return;
  }

  doc.fillColor(INK).font("Helvetica-Bold").fontSize(10);
  doc.text("Bill To", MARGIN, startY, { width: colW });
  doc.fillColor(INK).font("Helvetica").fontSize(9);
  const billLines = [
    quote.customer.name,
    quote.billing.addressLine,
    [quote.billing.city, quote.billing.state, quote.billing.pincode]
      .filter(Boolean)
      .join(", "),
    `GSTIN: ${quote.customer.gstin}`,
    `Phone: ${quote.customer.phone}`,
    quote.customer.email ? `Email: ${quote.customer.email}` : null,
  ];
  doc.text(
    billLines.filter((l): l is string => l !== null && l !== "").join("\n"),
    MARGIN,
    doc.y + 2,
    { width: colW },
  );
  const leftEnd = doc.y;

  doc.fillColor(INK).font("Helvetica-Bold").fontSize(10);
  doc.text("Ship To", MARGIN + colW + 16, startY, { width: colW });
  doc.fillColor(INK).font("Helvetica").fontSize(9);
  doc.text(shipToLines(quote).join("\n"), MARGIN + colW + 16, doc.y + 2, {
    width: colW,
  });
  doc.y = Math.max(leftEnd, doc.y) + 8;
}

/** Page-break when the block won't fit (no table head — not in-table). */
function ensureSpace(ctx: Ctx, height: number): void {
  const { doc } = ctx;
  if (doc.y + height > PAGE_HEIGHT - MARGIN - 40) {
    doc.addPage();
  }
}

/**
 * Where an absolutely-positioned block (bank box, signatory) starts:
 * below whichever is lower — the block's own flow (y) or the text
 * cursor — restarting on a fresh page (no table head) when it cannot
 * fit. Returning the anchor keeps the drawn y in sync with the page
 * break, so a block never renders against a stale position.
 */
function blockAnchor(ctx: Ctx, y: number, height: number): number {
  const { doc } = ctx;
  const start = Math.max(y, doc.y);
  if (start + height > PAGE_HEIGHT - MARGIN - 4) {
    doc.addPage();
    return doc.y;
  }
  return start;
}

/**
 * "About Trolift Solutions" band between the parties block and the
 * item table: frozen copy (falls back to the standard description for
 * documents frozen before the field existed).
 */
function aboutSection(ctx: Ctx, quote: QuotationData): void {
  const { doc } = ctx;
  const text = ((quote.about ?? "").trim() || getQuotationAbout()).trim();
  if (text === "") return;
  const padX = 8;
  const padTop = 6;
  const headingH = 14;
  const bodyW = CONTENT_WIDTH - padX * 2;
  const bodyH = doc.heightOfString(text, { width: bodyW, lineGap: 1 });
  const boxH = padTop + headingH + bodyH + padTop;
  ensureSpace(ctx, boxH + 10);
  const y = doc.y;
  doc.save();
  doc.fillColor("#f8fafc").rect(MARGIN, y, CONTENT_WIDTH, boxH).fill();
  doc.restore();
  doc
    .strokeColor(LIGHT)
    .lineWidth(0.5)
    .rect(MARGIN, y, CONTENT_WIDTH, boxH)
    .stroke();
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(9.5);
  doc.text("About Trolift Solutions", MARGIN + padX, y + padTop, {
    width: bodyW,
  });
  doc.fillColor(MUTED).font("Helvetica").fontSize(8.5);
  doc.text(text, MARGIN + padX, y + padTop + headingH, {
    width: bodyW,
    lineGap: 1,
  });
  doc.y = y + boxH + 8;
}

interface Column {
  title: string;
  width: number;
  align: "left" | "right" | "center";
}

const COLUMNS: Column[] = [
  { title: "S.No", width: 30, align: "center" },
  { title: "Item & Description", width: 168, align: "left" },
  { title: "HSN/SAC", width: 52, align: "center" },
  { title: "Qty", width: 40, align: "center" },
  { title: "Rate", width: 62, align: "right" },
  { title: "GST %", width: 40, align: "center" },
  { title: "GST Amt", width: 62, align: "right" },
  { title: "Amount", width: 61, align: "right" },
];

function tableHead(ctx: Ctx, y: number): number {
  const { doc } = ctx;
  let x = MARGIN;
  const height = 20;
  doc.save();
  doc.fillColor(BLUE).rect(MARGIN, y, CONTENT_WIDTH, height).fill();
  doc.restore();
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8.5);
  for (const c of COLUMNS) {
    doc.text(c.title, x + 3, y + 5, { width: c.width - 6, align: c.align });
    x += c.width;
  }
  return y + height;
}

function ensureRoom(ctx: Ctx, height: number): void {
  const { doc } = ctx;
  if (doc.y + height > PAGE_HEIGHT - MARGIN - 40) {
    doc.addPage();
    tableHead(ctx, MARGIN);
  }
}

function rowRule(ctx: Ctx): void {
  const { doc } = ctx;
  doc
    .strokeColor(LIGHT)
    .lineWidth(0.5)
    .moveTo(MARGIN, doc.y)
    .lineTo(PAGE_WIDTH - MARGIN, doc.y)
    .stroke();
}

function itemsTable(ctx: Ctx, quote: QuotationData): void {
  const { doc } = ctx;
  let y = tableHead(ctx, doc.y);
  doc.fontSize(8.5);

  const drawRow = (cells: {
    serial: string;
    name: string;
    description: string;
    hsn: string;
    qty: string;
    rate: string;
    gst: string;
    tax: string;
    amount: string;
  }) => {
    const nameHeight = doc.heightOfString(cells.name, {
      width: (COLUMNS[1]?.width ?? 168) - 6,
    });
    const descHeight =
      cells.description === ""
        ? 0
        : doc.heightOfString(cells.description, {
            width: (COLUMNS[1]?.width ?? 168) - 6,
          });
    const height = Math.max(22, nameHeight + descHeight + 10);
    ensureRoom(ctx, height);
    y = doc.y;
    let x = MARGIN;
    const texts = [
      cells.serial, "", cells.hsn, cells.qty, cells.rate,
      cells.gst, cells.tax, cells.amount,
    ];
    const aligns = COLUMNS.map((c) => c.align);
    texts.forEach((text, ci) => {
      const col = COLUMNS[ci];
      if (!col) return;
      if (ci === 1) {
        doc.fillColor(INK).font("Helvetica-Bold");
        doc.text(cells.name, x + 3, y + 4, { width: col.width - 6 });
        if (cells.description !== "") {
          doc.fillColor(MUTED).font("Helvetica").fontSize(8);
          doc.text(cells.description, x + 3, doc.y + 1, {
            width: col.width - 6,
          });
          doc.fontSize(8.5);
        }
      } else {
        doc.fillColor(INK).font("Helvetica");
        doc.text(text, x + 3, y + 4, {
          width: col.width - 6,
          align: aligns[ci],
        });
      }
      x += col.width;
    });
    doc.y = y + height;
    rowRule(ctx);
  };

  quote.items.forEach((item) => {
    drawRow({
      serial: String(item.serial),
      name: item.name,
      description: item.description,
      hsn: item.hsn ?? "",
      qty: String(item.quantity),
      rate: formatINR(item.unitPricePaise),
      gst: rateLabel(item.gstRate),
      tax: formatINR(item.taxPaise),
      amount: formatINR(item.lineTotalPaise),
    });
  });

  // Cartage (delivery) line: quoted freight with its own GST.
  drawRow({
    serial: String(quote.items.length + 1),
    name: quote.cartage.name,
    description: quote.cartage.description,
    hsn: quote.cartage.sac ?? "",
    qty: "1",
    rate: formatINR(quote.cartage.chargePaise),
    gst: rateLabel(quote.cartage.gstRate),
    tax: formatINR(quote.cartage.taxPaise),
    amount: formatINR(quote.cartage.lineTotalPaise),
  });
  doc.moveDown(0.6);
}

function totalsAndTerms(ctx: Ctx, quote: QuotationData): void {
  const { doc } = ctx;
  const t = quote.totals;
  const rows: Array<[string, number, boolean]> = [
    // Same ex-GST labelling as the tax invoice: the items column sums
    // inclusive amounts, this subtotal is the taxable base.
    [quote.treatment === "gst" ? "Sub Total (ex-GST)" : "Sub Total", t.subtotalPaise, false],
  ];
  if (quote.treatment === "gst") {
    if (t.cgstPaise + t.sgstPaise > 0) {
      rows.push(["CGST", t.cgstPaise, false]);
      rows.push(["SGST", t.sgstPaise, false]);
    } else {
      rows.push(["IGST", t.igstPaise, false]);
    }
  }
  rows.push(["Total", t.grandTotalPaise, true]);

  const boxW = 250;
  const boxX = PAGE_WIDTH - MARGIN - boxW;
  const leftW = CONTENT_WIDTH - boxW - 12;

  // Left: words + terms.
  const leftY = doc.y;
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(9.5);
  doc.text("Total In Words", MARGIN, leftY, { width: leftW });
  doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(8.5);
  doc.text(`${amountInWords(t.grandTotalPaise)} (INR)`, MARGIN, doc.y + 2, {
    width: leftW,
  });
  doc.moveDown(0.6);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(9.5);
  doc.text("Terms & Conditions", MARGIN, doc.y, { width: leftW });
  doc.fillColor(INK).font("Helvetica").fontSize(8.5);
  quote.terms.forEach((term, i) => {
    doc.text(`${i + 1}. ${term}`, MARGIN, doc.y + 2, { width: leftW });
  });
  const leftEnd = doc.y;

  // Right: totals box.
  let y = leftY;
  const rowH = 18;
  rows.forEach(([label, amount, bold]) => {
    doc
      .strokeColor(LIGHT)
      .lineWidth(0.5)
      .rect(boxX, y, boxW, rowH)
      .stroke();
    doc
      .fillColor(bold ? INK : MUTED)
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(bold ? 10 : 9);
    doc.text(label, boxX + 6, y + 4, { width: 120 });
    doc.fillColor(INK).text(formatINR(amount), boxX + 126, y + 4, {
      width: boxW - 132,
      align: "right",
    });
    y += rowH;
  });

  // Right: bank block (when configured) + signatory.
  y += 6;
  if (quote.bank) {
    const b = quote.bank;
    const bankLines = [
      b.bankName ? `Bank Name: ${b.bankName}` : null,
      b.accountName ? `Account Name: ${b.accountName}` : null,
      `Account No.: ${b.accountNumber}`,
      b.ifsc ? `IFSC: ${b.ifsc}` : null,
      b.accountType ? `Account Type: ${b.accountType}` : null,
    ].filter((l): l is string => l !== null);
    const bankH = bankLines.length * 12 + 26;
    y = blockAnchor(ctx, y, bankH);
    const by = y;
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(9);
    doc.text("Bank Details", boxX + 6, by + 4, { width: boxW - 12 });
    doc.fillColor(MUTED).font("Helvetica").fontSize(8);
    bankLines.forEach((line, i) => {
      doc.text(line, boxX + 6, by + 18 + i * 12, { width: boxW - 12 });
    });
    doc
      .strokeColor(LIGHT)
      .lineWidth(0.5)
      .rect(boxX, by, boxW, bankH)
      .stroke();
    y = by + bankH;
  }
  y += 10;
  // Signatory block: signature image box (when artwork loaded) above a
  // dashed signature rule, then the printed name/title.
  const sigNeed = (ctx.sign ? 48 + 13 : 0) + 34;
  if (quote.signatory) {
    y = blockAnchor(ctx, y, sigNeed);
    const sigBoxW = 96;
    const sigBoxH = 48;
    const sigX = PAGE_WIDTH - MARGIN - sigBoxW;
    if (ctx.sign) {
      doc.save();
      doc.fillColor("#ffffff").rect(sigX, y, sigBoxW, sigBoxH).fill();
      doc
        .strokeColor(LIGHT)
        .lineWidth(0.5)
        .rect(sigX, y, sigBoxW, sigBoxH)
        .stroke();
      doc.restore();
      doc.image(ctx.sign, sigX + 3, y + 3, {
        fit: [sigBoxW - 6, sigBoxH - 6],
        align: "center",
        valign: "center",
      });
      y += sigBoxH;
    }
    // The line the proprietor signs over (matches the reference rule).
    doc
      .save()
      .strokeColor("#9ca3af")
      .lineWidth(0.6)
      .dash(3, { space: 2 })
      .moveTo(PAGE_WIDTH - MARGIN - 170, y + 5)
      .lineTo(PAGE_WIDTH - MARGIN, y + 5)
      .stroke()
      .undash()
      .restore();
    y += 13;
    const sigTextX = PAGE_WIDTH - MARGIN - 170;
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(9.5);
    doc.text(quote.signatory.name, sigTextX, y, { width: 170, align: "right" });
    doc.fillColor(MUTED).font("Helvetica").fontSize(8.5);
    if (quote.signatory.title) {
      doc.text(quote.signatory.title, sigTextX, doc.y + 1, {
        width: 170,
        align: "right",
      });
    }
    doc.text("Authorized Signatory", sigTextX, doc.y + 1, {
      width: 170,
      align: "right",
    });
  }
  doc.y = Math.max(leftEnd, doc.y) + 6;
}

function footer(ctx: Ctx, quote: QuotationData): void {
  const { doc } = ctx;
  // Raw break (no table head): the notes must never grow a stray
  // table header when the last page is short.
  ensureSpace(ctx, 50);
  doc
    .strokeColor(LIGHT)
    .lineWidth(0.5)
    .moveTo(MARGIN, doc.y)
    .lineTo(PAGE_WIDTH - MARGIN, doc.y)
    .stroke();
  doc.moveDown(0.4);
  doc.fillColor(MUTED).font("Helvetica").fontSize(8);
  const notes = [
    "This is a provisional quotation, not a tax invoice. Prices and taxes are frozen as quoted; the final tax invoice is issued only after payment verification.",
    quote.customer.gstin
      ? "Customer GSTIN is customer-provided and not government-verified."
      : "No customer GSTIN — no GST charged on this quotation.",
    `Generated from frozen order ${quote.orderNumber} snapshots — catalogue or profile edits cannot alter this document.`,
  ];
  doc.text(notes.join(" "), MARGIN, doc.y, { width: CONTENT_WIDTH });
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    // The folio sits in the BOTTOM MARGIN band. pdfkit paginates any
    // text run past maxY() (= height − bottom margin), which would
    // spawn a blank page per folio — drop the margin for the write.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(8)
      .text(
        `Page ${i + 1} of ${pages.count} · ${quote.quotationNumber}`,
        MARGIN,
        PAGE_HEIGHT - MARGIN + 8,
        { width: CONTENT_WIDTH, align: "center" },
      );
    doc.page.margins.bottom = savedBottom;
  }
}

/** Render a frozen QuotationData to a PDF Buffer (A4). */
export async function renderQuotationPdf(quote: QuotationData): Promise<Buffer> {
  // Artwork bytes first: identical files in / embedded mean identical
  // output; failure falls back to the embedded defaults, never null
  // unless BOTH sources are unusable.
  const [logo, sign] = await Promise.all([
    loadQuotationLogo(),
    loadQuotationSign(),
  ]);
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: {
      Title: `Quotation ${quote.quotationNumber}`,
      Subject: `Trolift order ${quote.orderNumber}`,
      Author: quote.business.name,
      // Fixed metadata: identical frozen input → identical bytes.
      CreationDate: new Date(`${quote.quotationDate}T12:00:00Z`),
      ModDate: new Date(`${quote.quotationDate}T12:00:00Z`),
    },
  });
  const ctx: Ctx = { doc, logo, sign };
  header(ctx, quote);
  metaTable(ctx, quote);
  parties(ctx, quote);
  aboutSection(ctx, quote);
  itemsTable(ctx, quote);
  totalsAndTerms(ctx, quote);
  footer(ctx, quote);
  doc.flushPages();

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

/** Download filename for a quotation number (no slashes by construction). */
export function quotationFilename(quotationNumber: string): string {
  return `${quotationNumber}.pdf`;
}
