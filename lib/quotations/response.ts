import { quotationFilename } from "@/lib/quotations/pdf";

/**
 * Serve a rendered quotation PDF. Frozen documents are immutable, so a
 * long private cache is safe (per-order URL, capability-gated).
 */
export function quotationPdfResponse(
  quotationNumber: string,
  pdf: Buffer,
  inline: boolean,
): Response {
  // Exact view bytes (Buffer may pool a larger ArrayBuffer). The cast is
  // safe: pdfkit hands us a real Buffer, always ArrayBuffer-backed.
  const bytes = pdf.buffer.slice(
    pdf.byteOffset,
    pdf.byteOffset + pdf.byteLength,
  ) as ArrayBuffer;
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${
        inline ? "inline" : "attachment"
      }; filename="${quotationFilename(quotationNumber)}"`,
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Length": String(pdf.byteLength),
    },
  });
}
