import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BuyBox } from "@/components/cart/BuyBox";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { PriceDisplay } from "@/components/ui/PriceDisplay";
import { StockBadge } from "@/components/ui/StatusBadge";
import { ProductGallery } from "@/components/products/ProductGallery";
import { RelatedProducts } from "@/components/products/RelatedProducts";
import { getProductBySlug, getProductSlugs } from "@/lib/catalog/queries";
import {
  formatSpecEntries,
  priceToPaise,
  slugifyCategory,
} from "@/lib/catalog/products";
import { siteConfig } from "@/config/site";
import { toJsonLdScript } from "@/lib/seo/jsonld";
import {
  isValidImageSrc,
  PRODUCT_IMAGE_PLACEHOLDER,
} from "@/lib/storage/images";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Product not found" };
  return {
    title: `${product.name} — price & specs`,
    description: `${product.description} Category: ${product.category}. Ex-GST pricing with GST invoice.`,
    alternates: { canonical: `/products/${product.slug}` },
  };
}

/**
 * Known slugs are prerendered; unknown slugs 404 at routing level
 * (dynamicParams = false), which is why this returns a proper 404
 * status instead of an embedded not-found boundary.
 */
export const dynamicParams = false;

export async function generateStaticParams() {
  const slugs = await getProductSlugs();
  return slugs.map((slug) => ({ slug }));
}

/**
 * Product detail: gallery, info, specs, quantity + cart interface,
 * sales enquiry, related items. Read-only — no checkout, payment
 * or delivery logic. Inactive/unknown slugs 404.
 */
export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  // Only well-formed paths reach the gallery (a malformed path would
  // request a non-image); an asset that is missing entirely still shows
  // the branded placeholder in place, via ProductImage.
  const validImages = product.images.filter((src) => isValidImageSrc(src));
  const images =
    validImages.length > 0
      ? validImages.map((src, i) => ({
          src,
          alt: `${product.name} — photo ${i + 1}`,
        }))
      : [
          {
            src: PRODUCT_IMAGE_PLACEHOLDER,
            alt: `${product.name} — product photo unavailable`,
          },
        ];
  const specs = formatSpecEntries(product.specifications);

  // Structured data from DB fields only: no ratings, reviews, brand or
  // shipping claims. Availability mirrors the reserve-aware status.
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    category: product.category,
    image: images.map((img) => `${siteConfig.url}${img.src}`),
    offers: {
      "@type": "Offer",
      price: product.price,
      priceCurrency: "INR",
      availability:
        product.availability === "out_of_stock"
          ? "https://schema.org/OutOfStock"
          : product.availability === "low_stock"
            ? "https://schema.org/LimitedAvailability"
            : "https://schema.org/InStock",
      url: `${siteConfig.url}/products/${product.slug}`,
    },
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: toJsonLdScript(structuredData) }}
      />
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Products", href: "/products" },
          {
            label: product.category,
            href: `/products?category=${slugifyCategory(product.category)}`,
          },
          { label: product.name },
        ]}
      />
      <div className="mt-4 grid gap-8 lg:grid-cols-2">
        <ProductGallery images={images} productName={product.name} />
        <div>
          <p className="text-xs font-bold tracking-[0.14em] text-brand-700 uppercase">
            {product.category}
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900 sm:text-3xl">
            {product.name}
          </h1>
          <div className="mt-2">
            <StockBadge status={product.availability} />
          </div>
          <p className="mt-3 text-sm leading-6 text-zinc-600">{product.description}</p>
          <div className="mt-4 border-y border-zinc-200 py-4">
            <PriceDisplay
              amountPaise={priceToPaise(product.price)}
              unitNote="incl. GST & delivery · GST invoice included"
              size="lg"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Serviceability is confirmed against your delivery pincode before payment.
            </p>
          </div>
          <div className="mt-4">
            <BuyBox
              availability={product.availability}
              product={{
                productId: product.id,
                slug: product.slug,
                name: product.name,
                category: product.category,
                pricePaise: priceToPaise(product.price),
                image: images[0]?.src ?? PRODUCT_IMAGE_PLACEHOLDER,
                stockQuantity: product.stock_quantity,
              }}
            />
          </div>
          <div className="mt-3">
            <Link
              href="/contact"
              className="inline-flex h-12 w-full items-center justify-center rounded-md bg-brand-800 px-6 text-base font-bold text-white hover:bg-brand-700"
            >
              Enquire about this product
            </Link>
          </div>
        </div>
      </div>
      {specs.length > 0 ? (
        <section aria-labelledby="specs-heading" className="mt-10">
          <h2 id="specs-heading" className="text-xl font-extrabold tracking-tight text-zinc-900">
            Specifications
          </h2>
          <dl className="mt-3 overflow-hidden rounded-lg border border-zinc-200 bg-white">
            {specs.map((s) => (
              <div
                key={s.label}
                className="grid grid-cols-[140px_1fr] gap-3 border-b border-zinc-100 px-4 py-2.5 text-sm last:border-0 sm:grid-cols-[220px_1fr]"
              >
                <dt className="font-semibold text-zinc-500 capitalize">{s.label}</dt>
                <dd className="font-medium text-zinc-900">{s.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      <RelatedProducts category={product.category} excludeId={product.id} />
    </div>
  );
}
