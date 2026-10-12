import { validateImageList } from "@/lib/storage/images";
import type { Json } from "@/types/database";

/**
 * Admin product input validation (pure, unit-tested).
 * Money arrives as a rupees decimal string and converts to integer
 * paise exactly (≤2dp input enforced); the database receives a
 * NUMERIC(12,2) decimal string — floats never cross the boundary.
 */

export interface ProductFormInput {
  name: string;
  slug: string;
  description: string;
  priceRupees: string;
  category: string;
  images: string[];
  specificationsJson: string;
  stockQuantity: number;
  lowStockThreshold: number;
  isActive: boolean;
  /** GST percent as typed ("", "5", "18"); blank = not configured. */
  gstRate: string;
  /** Shipping weight in kg as typed ("", "12.5"); blank = unknown. */
  weightKg: string;
  /** HSN code as typed ("", "8716", "871680"); blank = not configured. */
  hsnCode: string;
}

export type ProductField =
  | "name"
  | "slug"
  | "description"
  | "priceRupees"
  | "category"
  | "images"
  | "specificationsJson"
  | "stockQuantity"
  | "lowStockThreshold"
  | "gstRate"
  | "weightKg"
  | "hsnCode";

export type ProductFormErrors = Partial<Record<ProductField, string>>;

export interface ValidProduct {
  name: string;
  slug: string;
  description: string;
  /** Integer paise. */
  pricePaise: number;
  category: string;
  images: string[];
  specifications: Json;
  stockQuantity: number;
  lowStockThreshold: number;
  isActive: boolean;
  /** NUMERIC(5,2) decimal string; NULL = GST not configured (0%). */
  gstRate: string | null;
  /** NUMERIC(10,3) decimal string; NULL = weight unknown. */
  weightKg: string | null;
  /** HSN 4/6/8 digits; NULL = not configured (blank cell). */
  hsnCode: string | null;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PRICE_RE = /^\d+(?:\.\d{1,2})?$/;
const RATE_RE = /^\d+(?:\.\d{1,2})?$/;
const WEIGHT_RE = /^\d+(?:\.\d{1,3})?$/;

export function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function validateProductInput(
  input: ProductFormInput,
): { errors: ProductFormErrors; value: ValidProduct | null } {
  const errors: ProductFormErrors = {};

  const name = input.name.trim();
  if (name.length < 2 || name.length > 200) {
    errors.name = "Name must be 2–200 characters.";
  }
  const slug = normalizeSlug(input.slug);
  if (!SLUG_RE.test(slug)) {
    errors.slug = "Slug must be lowercase letters, numbers and dashes.";
  }
  if (input.description.length > 5000) {
    errors.description = "Description must be under 5000 characters.";
  }
  const priceRaw = input.priceRupees.trim();
  if (!PRICE_RE.test(priceRaw)) {
    errors.priceRupees = "Price must be a non-negative amount with at most 2 decimals.";
  }
  const pricePaise = PRICE_RE.test(priceRaw)
    ? Math.round(Number(priceRaw) * 100)
    : NaN;
  if (!Number.isSafeInteger(pricePaise) || pricePaise < 0) {
    errors.priceRupees = "Price must be a non-negative amount with at most 2 decimals.";
  }
  const category = input.category.trim();
  if (category.length < 2 || category.length > 100) {
    errors.category = "Category must be 2–100 characters.";
  }
  const images = input.images.map((s) => s.trim()).filter((s) => s !== "");
  const imageError = validateImageList(images);
  if (imageError) errors.images = imageError;

  let specifications: Json = {};
  if (input.specificationsJson.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(input.specificationsJson);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        errors.specificationsJson = "Specifications must be a JSON object.";
      } else {
        specifications = parsed as Json;
      }
    } catch {
      errors.specificationsJson = "Specifications must be valid JSON.";
    }
  }

  if (
    !Number.isInteger(input.stockQuantity) ||
    input.stockQuantity < 0 ||
    input.stockQuantity > 1_000_000
  ) {
    errors.stockQuantity = "Stock must be a whole number from 0 to 1,000,000.";
  }
  if (
    !Number.isInteger(input.lowStockThreshold) ||
    input.lowStockThreshold < 0 ||
    input.lowStockThreshold > 1_000_000
  ) {
    errors.lowStockThreshold =
      "Low-stock threshold must be a whole number from 0 to 1,000,000.";
  }

  // GST rate: blank = not configured (0% on GST orders). Otherwise a
  // percent from 0–100 with at most 2 decimals, stored NUMERIC(5,2).
  const rateRaw = input.gstRate.trim().replace(/%$/, "").trim();
  let gstRate: string | null = null;
  if (rateRaw !== "") {
    const rateNum = RATE_RE.test(rateRaw) ? Number(rateRaw) : NaN;
    if (!Number.isFinite(rateNum) || rateNum < 0 || rateNum > 100) {
      errors.gstRate = "GST rate must be blank or a percent from 0 to 100 (max 2 decimals).";
    } else {
      gstRate = rateNum.toFixed(2);
    }
  }

  // HSN: blank = not configured (blank cell on documents). Otherwise
  // 4, 6 or 8 digits.
  const hsnRaw = input.hsnCode.trim();
  let hsnCode: string | null = null;
  if (hsnRaw !== "") {
    if (!/^[0-9]{4}([0-9]{2}([0-9]{2})?)?$/.test(hsnRaw)) {
      errors.hsnCode = "HSN must be blank or 4, 6 or 8 digits.";
    } else {
      hsnCode = hsnRaw;
    }
  }

  // Shipping weight: blank = unknown (weight slabs are skipped, never
  // guessed). Otherwise up to 100000 kg with at most 3 decimals,
  // stored NUMERIC(10,3).
  const weightRaw = input.weightKg.trim().replace(/kg$/, "").trim();
  let weightKg: string | null = null;
  if (weightRaw !== "") {
    const weightNum = WEIGHT_RE.test(weightRaw) ? Number(weightRaw) : NaN;
    if (!Number.isFinite(weightNum) || weightNum <= 0 || weightNum > 100000) {
      errors.weightKg =
        "Weight must be blank or 0–100000 kg (max 3 decimals).";
    } else {
      weightKg = weightNum.toFixed(3);
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors, value: null };
  }
  return {
    errors,
    value: {
      name,
      slug,
      description: input.description,
      pricePaise,
      category,
      images,
      specifications,
      stockQuantity: input.stockQuantity,
      lowStockThreshold: input.lowStockThreshold,
      isActive: input.isActive,
      gstRate,
      weightKg,
      hsnCode,
    },
  };
}

/** NUMERIC(12,2) decimal string for the database. */
export function paiseToDecimal(paise: number): string {
  return (paise / 100).toFixed(2);
}
