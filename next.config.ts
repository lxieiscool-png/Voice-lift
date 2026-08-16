import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Never sniff content types (blocks a class of upload-based XSS).
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Reel is never legitimately iframed — block clickjacking.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Camera + mic stay enabled for Reel itself (Drill Check records
          // in-browser); everything else the app doesn't use is off.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=()" },
          // Vercel already serves HSTS on custom domains, but being explicit
          // costs nothing and survives a hosting move.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
