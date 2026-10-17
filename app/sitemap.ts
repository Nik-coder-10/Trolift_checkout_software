import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";
import { getCategories, getProductSlugs } from "@/lib/catalog/queries";

/**
 * sitemap.xml (generated from the live catalogue).
 *
 * Contains only public, indexable pages: home, the catalogue, one
 * entry per category and one per active product. Cart, checkout,
 * order tracking and admin are deliberately absent (they are noindex
 * and capability-based). `getProductSlugs()` returns active products
 * only and degrades to an empty list without a backend, so the
 * sitemap never fails the build.
 *
 * Revalidated hourly: the build-time snapshot would otherwise go
 * stale as soon as new products are published.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteConfig.url.replace(/\/$/, "");
  const now = new Date();

  const [slugs, categories] = await Promise.all([
    getProductSlugs(),
    getCategories(),
  ]);

  const staticEntries: MetadataRoute.Sitemap = [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${base}/products`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${base}/contact`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];

  const categoryEntries: MetadataRoute.Sitemap = categories.map((c) => ({
    url: `${base}/products?category=${encodeURIComponent(c.slug)}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  const productEntries: MetadataRoute.Sitemap = slugs.map((slug) => ({
    url: `${base}/products/${slug}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  return [...staticEntries, ...categoryEntries, ...productEntries];
}
