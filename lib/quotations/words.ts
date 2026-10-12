/**
 * Amount in words, Indian numbering (pure, unit-tested).
 *
 * "Indian Rupee Five Thousand Eight Hundred Fifty Seven Only" for
 * whole rupees; paise append as "and Paise Ten Only". All math stays
 * in integer paise — the input is already exact.
 */

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight",
  "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
  "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];

const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy",
  "Eighty", "Ninety",
];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n] ?? "";
  const t = TENS[Math.floor(n / 10)] ?? "";
  const o = ONES[n % 10] ?? "";
  return o === "" ? t : `${t} ${o}`;
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const head = h > 0 ? `${ONES[h]} Hundred` : "";
  const tail = rest > 0 ? twoDigits(rest) : "";
  return [head, tail].filter((s) => s !== "").join(" ");
}

/**
 * Indian-system words for a non-negative integer rupee value.
 *
 * Grouping is the Indian convention throughout: the last three digits,
 * then successive two-digit groups (Thousand, Lakh, Crore, Arab,
 * Kharab). Anything beyond Kharab fails closed rather than rendering
 * grammatically incorrect wording.
 */
const PAIR_NAMES = ["Thousand", "Lakh", "Crore", "Arab", "Kharab"];

export function rupeesInWords(rupees: number): string {
  if (!Number.isSafeInteger(rupees) || rupees < 0) {
    throw new Error("[quotations] Amount in words needs a non-negative integer.");
  }
  if (rupees === 0) return "Zero";
  const parts: Array<{ name: string; value: number }> = [];
  const rest = rupees % 1000;
  let n = Math.floor(rupees / 1000);
  for (const name of PAIR_NAMES) {
    if (n <= 0) break;
    const pair = n % 100;
    if (pair > 0) parts.unshift({ name, value: pair });
    n = Math.floor(n / 100);
  }
  if (n > 0) {
    throw new Error("[quotations] Amount exceeds the supported words range.");
  }
  const words = parts.map(({ name, value }) => `${twoDigits(value)} ${name}`);
  if (rest > 0) words.push(threeDigits(rest));
  return words.join(" ");
}

/** Full amount line for the document from integer paise. */
export function amountInWords(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) {
    throw new Error("[quotations] Amount in words needs a non-negative integer paise amount.");
  }
  const rupees = Math.trunc(paise / 100);
  const p = paise % 100;
  const head = `Indian Rupee ${rupeesInWords(rupees)}`;
  return p === 0 ? `${head} Only` : `${head} and Paise ${twoDigits(p)} Only`;
}
