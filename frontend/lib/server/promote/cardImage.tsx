// lib/server/promote/cardImage.tsx — the 1200x630 visual card for a Promote
// item, laid out like a visual abstract:
//   - a green gradient top band with the type label and the headline in white;
//   - a white row with the three key facts (label + value, never cut off: the
//     font shrinks for longer text); an item with no stored facts shows its
//     standfirst there instead;
//   - a footer with the authors on the left and the site address on the right.
// Used as the page's og:image / twitter:image and as "Download visual card"
// (route: app/promote/[slug]/opengraph-image/route.tsx).
//
// NO NETWORK WHILE DRAWING, AND NEVER A 500.
//   - The item is read straight from the database with the existing server helper
//     (getPublishedArticleBySlug); nothing fetches the site URL or localhost. The
//     read has a 3 second limit.
//   - The font is a file on disk (the Geist TTF that ships inside next/og), read
//     with fs; no font is downloaded. next/og would download a font or an emoji
//     image from fonts.googleapis.com / cdn.jsdelivr.net for any character the
//     font lacks, and hang for minutes when that host is unreachable; every
//     string is therefore reduced to Basic Latin / Latin-1 first (cardText).
//   - Drawing is rendered to bytes here, under a 4 second limit. On any error or
//     timeout a simple fallback card (green band + headline) is drawn instead, and
//     if even that fails a tiny static PNG is returned. The response is always an
//     image with status 200.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { getPublishedArticleBySlug } from "@/lib/server/showcase";
import { SITE_URL } from "@/lib/articleFormat";
import { SHOWCASE_TYPE_LABEL, visibleFacts } from "@/lib/server/promote/showcaseKinds";
import { cardLayout, cardText } from "@/lib/server/promote/cardLayout";

export const CARD_SIZE = { width: 1200, height: 630 };

const GREEN = "#1A5632";
const DARK = "#033319";
const INK = "#191c1e";
const MUTED = "#5b6470";

const DB_TIMEOUT_MS = 3000;
const RENDER_TIMEOUT_MS = 4000;

/** Rejects if `p` has not settled in `ms`. The work behind it is not cancelled. */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

// The font that ships with next/og, read from disk once. A missing file means
// next/og's own built-in copy of the same font is used.
type CardFont = { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" };
let fontsPromise: Promise<CardFont[] | undefined> | null = null;

function loadFonts(): Promise<CardFont[] | undefined> {
  if (!fontsPromise) {
    fontsPromise = (async () => {
      try {
        const file = path.join(
          process.cwd(),
          "node_modules",
          "next",
          "dist",
          "compiled",
          "@vercel",
          "og",
          "Geist-Regular.ttf"
        );
        const buf = await readFile(file);
        const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
        return [
          { name: "Geist", data, weight: 400, style: "normal" },
          { name: "Geist", data, weight: 700, style: "normal" },
        ] as CardFont[];
      } catch {
        return undefined;
      }
    })();
  }
  return fontsPromise;
}

// A 1x1 green PNG: the last resort if drawing fails twice.
const LAST_RESORT_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0)
);

const HEADERS = { "Content-Type": "image/png" };

function png(bytes: ArrayBuffer | Uint8Array, cache: string): Response {
  return new Response(bytes as BodyInit, { status: 200, headers: { ...HEADERS, "Cache-Control": cache } });
}

async function draw(element: React.ReactElement): Promise<ArrayBuffer> {
  const fonts = await loadFonts();
  const res = new ImageResponse(element, { ...CARD_SIZE, ...(fonts ? { fonts } : {}) });
  return withTimeout(res.arrayBuffer(), RENDER_TIMEOUT_MS, "card render");
}

type CardData = {
  type: string;
  headline: string;
  standfirst: string;
  authors: string;
  facts: { label: string; value: string }[];
};

function FullCard({ data }: { data: CardData }) {
  const layout = cardLayout({
    headline: data.headline,
    standfirst: data.standfirst,
    authors: data.authors,
    facts: data.facts,
  });
  const host = new URL(SITE_URL).host;
  const facts = layout.facts;

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#ffffff", fontFamily: "Geist, sans-serif" }}>
      {/* Top band */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          height: 300,
          padding: "40px 64px",
          backgroundImage: `linear-gradient(135deg, ${DARK} 0%, ${GREEN} 100%)`,
          color: "#ffffff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div
            style={{
              display: "flex",
              background: "rgba(255,255,255,0.2)",
              fontSize: 24,
              fontWeight: 700,
              padding: "6px 20px",
              borderRadius: 999,
            }}
          >
            {cardText(data.type)}
          </div>
          <div style={{ display: "flex", fontSize: 24, fontWeight: 700, opacity: 0.9 }}>SmartDrugDiscovery</div>
        </div>
        <div style={{ display: "flex", fontSize: layout.headlineSize, fontWeight: 700, lineHeight: 1.12 }}>
          {layout.headline}
        </div>
      </div>

      {/* White row: the three facts, or the standfirst */}
      <div style={{ display: "flex", flex: 1, background: "#ffffff", padding: "0 64px" }}>
        {facts.length > 0 ? (
          facts.map((f, i) => (
            <div
              key={f.label}
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                justifyContent: "center",
                paddingRight: 28,
                paddingLeft: i === 0 ? 0 : 28,
                borderLeft: i === 0 ? "none" : "2px solid #e3e6e1",
              }}
            >
              <div style={{ display: "flex", color: GREEN, fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>
                {f.label.toUpperCase()}
              </div>
              <div style={{ display: "flex", marginTop: 10, color: INK, fontSize: layout.factSize, lineHeight: 1.25 }}>
                {f.value}
              </div>
            </div>
          ))
        ) : (
          <div style={{ display: "flex", alignItems: "center", color: INK, fontSize: layout.standfirstSize, lineHeight: 1.3 }}>
            {layout.standfirst}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 84,
          padding: "0 64px",
          background: "#fbfaf7",
          borderTop: "2px solid #e3e6e1",
          fontSize: 24,
        }}
      >
        <div style={{ display: "flex", color: MUTED }}>{layout.authors}</div>
        <div style={{ display: "flex", color: GREEN, fontWeight: 700 }}>{host}</div>
      </div>
    </div>
  );
}

/** The simple card used when the full one cannot be drawn: a green band and the
 *  headline. */
function FallbackCard({ headline }: { headline: string }) {
  const h = cardText(headline) || "SmartDrugDiscovery";
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 72px",
        backgroundImage: `linear-gradient(135deg, ${DARK} 0%, ${GREEN} 100%)`,
        color: "#ffffff",
        fontFamily: "Geist, sans-serif",
      }}
    >
      <div style={{ display: "flex", fontSize: 24, fontWeight: 700, opacity: 0.9 }}>SmartDrugDiscovery</div>
      <div style={{ display: "flex", marginTop: 24, fontSize: h.length > 90 ? 48 : 60, fontWeight: 700, lineHeight: 1.12 }}>
        {h.slice(0, 160)}
      </div>
    </div>
  );
}

/** Words of a slug as a stand-in headline when the item cannot be read. */
function headlineFromSlug(slug: string): string {
  const t = slug.replace(/-+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "SmartDrugDiscovery";
}

/** The card as a PNG response. Always status 200 and an image: see the header. */
export async function renderCard(slug: string): Promise<Response> {
  const started = Date.now();
  let headline = headlineFromSlug(slug);
  try {
    const article = await withTimeout(getPublishedArticleBySlug(slug), DB_TIMEOUT_MS, "card data");
    if (!article) return png(await draw(<FallbackCard headline={headline} />), "public, max-age=60");

    headline = article.headline;
    const data: CardData = {
      type: SHOWCASE_TYPE_LABEL[article.type],
      headline: article.headline,
      standfirst: article.standfirst,
      authors: article.authors,
      facts: visibleFacts(article.keyFacts).slice(0, 3),
    };
    const bytes = await draw(<FullCard data={data} />);
    const took = Date.now() - started;
    if (took > 2000) console.warn(`promote card for ${slug} took ${took}ms`);
    return png(bytes, "public, max-age=300, s-maxage=3600");
  } catch (e) {
    console.error(`promote card for ${slug} failed; drawing the fallback card`, e);
  }

  try {
    return png(await draw(<FallbackCard headline={headline} />), "no-store");
  } catch (e) {
    console.error(`promote fallback card for ${slug} failed; returning the static image`, e);
    return png(LAST_RESORT_PNG, "no-store");
  }
}
