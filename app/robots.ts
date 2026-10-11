import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";

/**
 * robots.txt (generated, so the sitemap URL follows
 * NEXT_PUBLIC_SITE_URL instead of being hard-coded).
 *
 * Admin, API and cart/checkout/order paths are disallowed on top of
 * their noindex metadata: order pages are capability URLs (nobody
 * should index them) and admin/API responses are not crawlable
 * content. The public catalogue stays fully open.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/admin/",
          "/api/",
          "/cart",
          "/checkout",
          "/orders/",
        ],
      },
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  };
}
