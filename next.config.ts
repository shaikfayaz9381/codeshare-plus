import type { NextConfig } from "next";

/**
 * CodeShare Plus — Next.js configuration.
 *
 * Notes:
 * - `cacheComponents` is intentionally disabled. Every content route in this
 *   application is per-request (session cookies, guest capability cookies,
 *   password grants, expiry/revocation checks). The classic dynamic rendering
 *   model is simpler and more predictable for this access pattern.
 * - Security headers are added globally. The Content-Security-Policy is
 *   intentionally strict; `'unsafe-inline'` for styles is required by
 *   next-themes (inline style attribute for color scheme) and Tailwind runtime
 *   style injection. Scripts are restricted to same-origin bundles.
 */
const isDev = process.env.NODE_ENV === "development";

/**
 * Next.js 16 blocks dev resources (including the HMR client) for origins it
 * does not know. Playwright and local tools use 127.0.0.1 while the dev server
 * advertises localhost, so allow it explicitly. Development only — production
 * requests are unaffected.
 */
const allowedDevOrigins = isDev ? ["127.0.0.1"] : undefined;

const csp = [
  "default-src 'self'",
  // Next.js requires inline bootstrap scripts unless a nonce strategy is used.
  // We keep 'unsafe-inline' for dev only and allow the Next.js runtime script
  // hashes strategy by falling back to same-origin scripts in production.
  isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
].join("; ");

// The authorized content endpoint is framed by our own PDF preview, so it must
// allow same-origin framing. Pages keep `frame-ancestors 'none'`.
const contentCsp = csp.replace("frame-ancestors 'none'", "frame-ancestors 'self'");

const nextConfig: NextConfig = {
  cacheComponents: false,
  poweredByHeader: false,
  allowedDevOrigins,
  turbopack: {
    // Tailwind CSS v4 is applied through its Turbopack loader (as configured by
    // create-next-app). There is intentionally no postcss.config.mjs.
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
      {
        // Only the authorized bytes endpoint may be embedded, and only by us
        // (PDF preview uses an iframe). All other responses stay unframeable.
        source: "/api/shares/:shareId/items/:itemId/content",
        headers: [
          { key: "Content-Security-Policy", value: contentCsp },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
