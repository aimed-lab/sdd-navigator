import type { NextConfig } from "next";
import { TEAMS_MODE, teamsModeRedirects } from "./lib/siteMode";

// Base44 preview only: allow the preview host to reach Next's dev assets/HMR.
// Inactive unless BASE44_PREVIEW_MODE is exactly "1".
const previewDevOrigins =
  process.env.BASE44_PREVIEW_MODE === "1" && process.env.BASE44_PUBLIC_HOST_SUFFIX
    ? [`3000-${process.env.BASE44_PUBLIC_HOST_SUFFIX}`]
    : [];

const nextConfig: NextConfig = {
  // Same origin list also lets server actions run behind the preview proxy.
  ...(previewDevOrigins.length
    ? {
        allowedDevOrigins: previewDevOrigins,
        experimental: { serverActions: { allowedOrigins: previewDevOrigins } },
      }
    : {}),
  async redirects() {
    return [
      {
        source: "/sign-in",
        destination: "/login",
        permanent: true,
      },
      // The industry page was removed; keep any shared old link working.
      {
        source: "/industry",
        destination: "/",
        permanent: true,
      },
      // Teams mode only (NEXT_PUBLIC_SITE_MODE=teams): drug-discovery routes go home.
      ...teamsModeRedirects(TEAMS_MODE),
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
};

export default nextConfig;
