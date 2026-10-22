// The item's 1200x630 visual card, at /promote/<slug>/opengraph-image. It is the
// page's og:image AND twitter:image (both set to this absolute URL in the page's
// generateMetadata) and what "Download visual card" downloads. Drawn by
// lib/server/promote/cardImage.tsx.
//
// A route handler rather than the opengraph-image.tsx file convention: Next
// builds a file-convention image URL from the request host in some setups,
// while the share URLs must always use the site URL config. Same path, same
// ImageResponse.

import { renderCard } from "@/lib/server/promote/cardImage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // reads the font from disk
export const maxDuration = 15;

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return renderCard(slug);
}
