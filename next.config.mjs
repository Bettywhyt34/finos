/** @type {import('next').NextConfig} */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const securityHeaders = [
  // Prevent clickjacking
  { key: "X-Frame-Options",           value: "DENY" },
  // Stop MIME-type sniffing
  { key: "X-Content-Type-Options",    value: "nosniff" },
  // Referrer policy
  { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
  // Permissions policy — disable unused browser APIs
  {
    key:   "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // HSTS — force HTTPS (1 year, include subdomains)
  {
    key:   "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
  // Content-Security-Policy
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Scripts: self + inline (Next.js requires unsafe-inline for RSC hydration)
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      // Styles: self + inline (Tailwind CSS-in-JS)
      "style-src 'self' 'unsafe-inline'",
      // Images: self + data URIs + Supabase storage
      `img-src 'self' data: blob: https://*.supabase.co`,
      // Fonts: self
      "font-src 'self'",
      // API connections: self + integration partners + Frankfurter FX
      [
        "connect-src 'self'",
        "https://*.supabase.co",
        "https://revflowapp.com",
        "https://xpenxflow.com",
        "https://api.xpenxflow.com",
        "https://earnmark360.com.ng",
        "https://api.frankfurter.app",
        "https://*.upstash.io",
      ].join(" "),
      // Frames: none
      "frame-src 'none'",
      // Objects: none
      "object-src 'none'",
      // Base URI: self
      "base-uri 'self'",
      // Form action: self
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig = {
  eslint: {
    // Pre-existing unused-var warnings in integration processors — no runtime impact
    ignoreDuringBuilds: true,
  },
  // -- Security headers on all routes --
  async headers() {
    return [
      {
        source:  "/(.*)",
        headers: securityHeaders,
      },
      // CORS for integration OAuth callback routes:
      // The callback URLs are visited by the integration servers redirecting
      // the user's browser, so standard browser CORS applies.
      {
        source: "/api/integrations/:path*",
        headers: [
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Allow-Origin",      value: APP_URL },
          { key: "Access-Control-Allow-Methods",     value: "GET,POST,OPTIONS" },
          {
            key:   "Access-Control-Allow-Headers",
            value: "Content-Type, X-Discovery-Signature",
          },
        ],
      },
    ];
  },

  // -- Image domains (if using next/image with external sources) --
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
};

export default nextConfig;
