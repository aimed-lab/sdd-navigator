import { NextResponse } from "next/server";
import { fetchPaperById } from "@/lib/server/promote/fetchPaper";

// POST /api/promote/lookup  { input: "<DOI | PMID>" }  -> PaperMetadata | 404
//
// Backs the DOI/PMID autofill on the showcase submit form. Deliberately
// separate from /api/promote/generate: that route also calls Groq twice to
// draft LinkedIn posts, which this form has no use for and shouldn't pay the
// token cost (or wait time) for just to prefill three fields.
//
// PUBLIC, same as /api/promote/generate — reads open paper metadata only,
// writes nothing.

export async function POST(req: Request) {
  let input = "";
  try {
    const body = await req.json();
    if (body && typeof body.input === "string") input = body.input.trim();
  } catch {
    // fall through to the empty-input 400
  }

  if (!input) {
    return NextResponse.json({ error: "Enter a DOI or PubMed ID." }, { status: 400 });
  }

  try {
    const paper = await fetchPaperById(input);
    if (!paper) {
      return NextResponse.json(
        { error: "Couldn't find a paper for that DOI or PubMed ID. Check it and try again." },
        { status: 404 }
      );
    }
    return NextResponse.json(paper);
  } catch (e) {
    console.error("promote/lookup failed", e);
    return NextResponse.json(
      { error: "Couldn't reach the lookup service. Please try again." },
      { status: 502 }
    );
  }
}
