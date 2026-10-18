import type { NextConfig } from "next";

/**
 * Baseline browser-security headers for every response (the strict CSP
 * with per-request nonces lives in proxy.ts — it needs dynamic
 * control). HSTS, framing denial and MIME sniffing protection follow
 * the hardening baseline shared by Shopify/PayU-style commerce
 * platforms; they are belt-and-suspenders on top of RLS/authz.
 */
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), accelerometer=(), gyroscope=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Belt-and-suspenders on top of the per-page noindex metadata.
      {
        source: "/admin/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
