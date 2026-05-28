import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pastikan PDF dari Shopee bisa di-proxy lewat API route
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },

  // Log Shopee & TikTok domain untuk image (jika ada thumbnail produk)
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.shopee.co.id" },
      { protocol: "https", hostname: "**.shopeecdn.com" },
      { protocol: "https", hostname: "**.tiktokcdn.com" },
      { protocol: "https", hostname: "**.tiktokstaticb.com" },
    ],
  },

  // Matikan X-Powered-By header
  poweredByHeader: false,
};

export default nextConfig;
