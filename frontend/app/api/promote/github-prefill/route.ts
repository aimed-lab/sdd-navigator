import { NextResponse } from "next/server";
import { fetchRepoByUrl } from "@/lib/server/promote/fetchRepo";

// POST /api/promote/github-prefill  { url: "<GitHub repo URL>" }
//   -> RepoMetadata | 404
//
// OPTIONAL PREFILL ONLY — for the tool type's structured form
// (components/promote/SubmitFlow.tsx). This does NOT generate a post; it
// hands back raw repo metadata + README so the client can suggest values
// for a few of the five questions (description -> one-liner, language/
// topics -> context, a README code block -> example commands). The person
// still answers all five questions themselves, and can ignore or edit
// anything this suggests — see lib/showcaseTypes.ts's own header on why a
// fetch was never meant to be the thing generation happens from.
//
// PUBLIC, same posture as /api/promote/generate — reads public repo data
// only, writes nothing.

export async function POST(req: Request) {
  let url = "";
  try {
    const body = await req.json();
    if (body && typeof body.url === "string") url = body.url.trim();
  } catch {
    // fall through to the empty-input 400
  }

  if (!url) {
    return NextResponse.json({ error: "Enter a GitHub repository URL." }, { status: 400 });
  }

  try {
    const repo = await fetchRepoByUrl(url);
    if (!repo) {
      return NextResponse.json(
        { error: "Couldn't find that repository. Check the URL and try again." },
        { status: 404 }
      );
    }
    return NextResponse.json(repo);
  } catch (e) {
    console.error("promote/github-prefill failed", e);
    return NextResponse.json(
      { error: "Couldn't reach the lookup service. Please try again." },
      { status: 502 }
    );
  }
}
