import type { NextConfig } from "next";
import { TEAMS_MODE, teamsModeRedirects } from "./lib/siteMode";

const nextConfig: NextConfig = {
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
