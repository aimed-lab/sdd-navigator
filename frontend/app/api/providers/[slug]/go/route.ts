// GET /api/providers/[slug]/go — the "Visit website" button.
//
// Logs a website_click event (slug, user id when signed in, referring path) and
// answers 302 to the provider's website from lib/data/providers.json with
// utm_source=smartdrugdiscovery&utm_medium=directory added. The destination is
// never taken from the request: only the website in the data file, so this can
// not be used as an open redirect. An unknown slug, or one with no usable
// website, is a 404.

import { NextResponse } from "next/server";
import { referrerPath, trackedWebsiteUrl } from "@/lib/server/providers/core";
import { getProviderBySlug } from "@/lib/server/providers/providers";
import { logProviderEvent } from "@/lib/server/providers/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const provider = getProviderBySlug(slug);
  const target = provider ? trackedWebsiteUrl(provider) : null;
  if (!provider || !target) return new NextResponse("Not found", { status: 404 });

  await logProviderEvent(provider.slug, "website_click", referrerPath(req.headers.get("referer")));
  return NextResponse.redirect(target, 302);
}
