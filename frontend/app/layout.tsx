import type { Metadata } from "next";
import { Newsreader } from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { AuthProvider } from "@/context/AuthContext";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import GeneralFeedback from "@/components/feedback/GeneralFeedback";
import AssistantChat from "@/components/explore/AssistantChat";

// Serif for editorial titles (Explore, homepage tiles). Exposed as --font-title,
// used by the `font-title` Tailwind class. Body and labels keep Inter/Geist.
const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-title",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SmartDrugDiscovery",
  description:
    "Explore, Build, Promote — one platform for the drug-discovery community.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={newsreader.variable}>
      <head>
        {/* Fonts per DESIGN.md: Geist (display/headline/label) + Inter (body) + Material Symbols */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Geist:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen flex flex-col bg-background text-on-background font-body-md">
        <AuthProvider>
          <Nav />
          <main className="flex-1 pt-16">{children}</main>
          <Footer />
          {/* Floating, out of normal flow — available on every page, unlike
              the per-page card it replaced. See its own docstring. */}
          <GeneralFeedback />
          {/* The AI assistant side panel: mounted once so the chat survives
              moving between Explore and /pages. Renders only on those routes. */}
          <AssistantChat />
        </AuthProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
