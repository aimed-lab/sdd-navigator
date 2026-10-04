"use client";

// The homepage "drug discovery map": five colored lines drawn like a metro map,
// all passing through one central interchange (SmartDrugDiscovery). Plain inline
// SVG, no libraries. Every station is a link; locked stations are dashed grey
// with a lock and go to /invite.
//
// Geometry notes (viewBox units, 1 unit ~ 1px at desktop width):
//   * Papers / Projects / People run horizontally through the interchange at
//     y = 376 / 400 / 424. Data / Tools run vertically at x = 545 / 655. Only
//     the interchange pill (drawn last) overlaps them, so the lines never cross
//     anywhere else.
//   * Every bend is 45°. Stations sit on straight segments, never on a bend.
//   * Labels go on the free side of their line: above for Papers and Projects,
//     below for People, left for Data, right for Tools.
//   * The PHGDH case-study route (lib/phgdhRoute.ts) is a sixth, thicker line in
//     coral. It rises through the free corridor between the Data and Tools
//     verticals (x = 600), so it crosses no other line. Stations 1-3 sit on its
//     bottom-left run (labels below), stations 4-6 on its top-right run (labels
//     above). By default it is full color and the five lines fade to 25%; a
//     toggle under the map swaps that.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { isExternal, PHGDH_STEPS } from "@/lib/phgdhRoute";

type Side = "above" | "below" | "left" | "right";

interface Station {
  label: string[]; // one or two lines
  x: number;
  y: number;
  side: Side;
  href: string;
  locked?: boolean;
  /** Opens in a new tab (the label then shows a ↗). */
  external?: boolean;
}

interface MapLine {
  id: string;
  name: string;
  color: string;
  path: string;
  stations: Station[];
}

const LOCKED_HREF = "/invite";
// Tools and Data stations open the Explore feed filtered to that chip, which
// leads with the hand-picked list (lib/curated.ts).
const TOOLS_HREF = "/explore?category=tool";
const DATASETS_HREF = "/explore?category=dataset";
const LOCKED_GREY = "#9ca3af";

const LINES: MapLine[] = [
  {
    id: "papers",
    name: "Papers",
    color: "#2563eb",
    path: "M100 296 H300 L380 376 H820 L900 296 H1140",
    stations: [
      { label: ["Key papers"], x: 100, y: 296, side: "above", href: "/explore" },
      { label: ["Latest papers"], x: 260, y: 296, side: "above", href: "/explore" },
      {
        label: ["Our lab's papers"],
        x: 960,
        y: 296,
        side: "above",
        href: "/explore/AI%20drug%20discovery",
      },
      { label: ["Industry news"], x: 1140, y: 296, side: "above", href: "/explore" },
    ],
  },
  {
    id: "data",
    name: "Data",
    color: "#f97316",
    path: "M465 110 V180 L545 260 V540 L465 620 V690",
    stations: [
      {
        label: ["Gene expression"],
        x: 465,
        y: 110,
        side: "left",
        href: DATASETS_HREF,
      },
      { label: ["Target evidence"], x: 545, y: 300, side: "left", href: "/explore/PHGDH" },
      {
        label: ["Patient cohorts", "(OneFlorida+)"],
        x: 545,
        y: 500,
        side: "left",
        href: LOCKED_HREF,
        locked: true,
      },
      { label: ["Virtual cell"], x: 465, y: 690, side: "left", href: LOCKED_HREF, locked: true },
    ],
  },
  {
    id: "tools",
    name: "Tools",
    color: "#16a34a",
    path: "M735 110 V180 L655 260 V540 L735 620 V690",
    stations: [
      { label: ["RDKit"], x: 735, y: 110, side: "right", href: TOOLS_HREF },
      {
        label: ["AutoDock Vina"],
        x: 655,
        y: 300,
        side: "right",
        href: TOOLS_HREF,
      },
      {
        label: ["Single cell models"],
        x: 655,
        y: 500,
        side: "right",
        href: TOOLS_HREF,
      },
      { label: ["PAGER"], x: 735, y: 690, side: "right", href: TOOLS_HREF },
    ],
  },
  {
    id: "projects",
    name: "Projects",
    color: "#9333ea",
    path: "M100 400 H1140",
    stations: [
      {
        label: ["ColaboFest 2026"],
        x: 100,
        y: 400,
        side: "above",
        href: "/communities/colabofest-2026",
      },
      { label: ["Collaborate board"], x: 260, y: 400, side: "above", href: "/collaborate" },
      { label: ["Promote your work"], x: 960, y: 400, side: "above", href: "/promote" },
      {
        label: ["Sponsored challenges"],
        x: 1140,
        y: 400,
        side: "above",
        href: LOCKED_HREF,
        locked: true,
      },
    ],
  },
  {
    id: "people",
    name: "People",
    color: "#ec4899",
    path: "M100 504 H300 L380 424 H820 L900 504 H1140",
    stations: [
      { label: ["Communities"], x: 100, y: 504, side: "below", href: "/communities" },
      {
        label: ["Talent graph"],
        x: 260,
        y: 504,
        side: "below",
        href: LOCKED_HREF,
        locked: true,
      },
      {
        label: ["Company directory"],
        x: 960,
        y: 504,
        side: "below",
        href: LOCKED_HREF,
        locked: true,
      },
      { label: ["Experts"], x: 1140, y: 504, side: "below", href: LOCKED_HREF, locked: true },
    ],
  },
];

const ROUTE_ID = "phgdh";
const ROUTE_COLOR = "#C2410C";

// Station positions along the route, by step key (lib/phgdhRoute.ts).
const ROUTE_POS: Record<string, { x: number; y: number; side: Side }> = {
  papers: { x: 120, y: 745, side: "below" },
  alert: { x: 280, y: 745, side: "below" },
  collection: { x: 440, y: 745, side: "below" },
  analysis: { x: 800, y: 37, side: "above" },
  patent: { x: 960, y: 37, side: "above" },
  join: { x: 1120, y: 37, side: "above" },
};

const ROUTE: MapLine = {
  id: ROUTE_ID,
  name: "PHGDH route",
  color: ROUTE_COLOR,
  path: "M120 745 H535 L600 680 V105 L668 37 H1120",
  stations: PHGDH_STEPS.map((step) => {
    const external = isExternal(step.href);
    return {
      label: [external ? `${step.station} ↗` : step.station],
      ...ROUTE_POS[step.key],
      href: step.href,
      locked: step.locked,
      external,
    };
  }),
};

const ALL_LINES: MapLine[] = [...LINES, ROUTE];

const VIEW_X = -20;
const VIEW_W = 1300;
const VIEW_Y = -10;
const VIEW_H = 810;
const HUB_X = 600; // centre of the interchange pill
const R = 12; // station radius
const LABEL_GAP = 24;

function labelPlacement(s: Station) {
  const n = s.label.length;
  const lh = 17; // line height
  switch (s.side) {
    case "above":
      return { x: s.x, y: s.y - LABEL_GAP - (n - 1) * lh, anchor: "middle" as const };
    case "below":
      return { x: s.x, y: s.y + LABEL_GAP + 14, anchor: "middle" as const };
    case "left":
      return { x: s.x - LABEL_GAP, y: s.y + 5 - ((n - 1) * lh) / 2, anchor: "end" as const };
    case "right":
      return { x: s.x + LABEL_GAP, y: s.y + 5 - ((n - 1) * lh) / 2, anchor: "start" as const };
  }
}

// Plain anchor for stations that leave the site: new tab, no opener.
function ExternalLink(props: React.ComponentProps<"a">) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
}

function StationNode({
  station,
  color,
  lineId,
  setHover,
}: {
  station: Station;
  color: string;
  lineId: string;
  setHover: (id: string | null) => void;
}) {
  const [grow, setGrow] = useState(false);
  const p = labelPlacement(station);
  const name = station.label.join(" ");
  const Wrapper = station.external ? ExternalLink : Link;
  return (
    <Wrapper
      href={station.href}
      aria-label={station.locked ? `${name} (invite code required)` : name}
      onMouseEnter={() => {
        setGrow(true);
        setHover(lineId);
      }}
      onMouseLeave={() => {
        setGrow(false);
        setHover(null);
      }}
      onFocus={() => {
        setGrow(true);
        setHover(lineId);
      }}
      onBlur={() => {
        setGrow(false);
        setHover(null);
      }}
      className="outline-none"
    >
      {/* Generous invisible hit area so the stop is easy to tap on a phone. */}
      <circle cx={station.x} cy={station.y} r={22} fill="transparent" />
      <g
        style={{
          transform: grow ? "scale(1.3)" : "scale(1)",
          transformOrigin: `${station.x}px ${station.y}px`,
          transition: "transform 150ms ease",
        }}
      >
        <circle
          cx={station.x}
          cy={station.y}
          r={R}
          fill="#fff"
          stroke={station.locked ? LOCKED_GREY : color}
          strokeWidth={5}
          strokeDasharray={station.locked ? "5 3.5" : undefined}
        />
        {station.locked && (
          <g
            transform={`translate(${station.x - 5} ${station.y - 6})`}
            fill="none"
            stroke="#6b7280"
            strokeWidth={1.6}
          >
            <path d="M2.2 5 V3.4 a2.8 2.8 0 0 1 5.6 0 V5" />
            <rect x="0.8" y="5" width="8.4" height="6.2" rx="1.2" fill="#6b7280" />
          </g>
        )}
      </g>
      <text
        textAnchor={p.anchor}
        x={p.x}
        y={p.y}
        className="font-label-md"
        fontSize={16}
        fontWeight={station.locked ? 500 : 600}
        fill={station.locked ? "#6b7280" : "#191c1e"}
        style={{ pointerEvents: "none" }}
      >
        {station.label.map((l, i) => (
          <tspan key={l} x={p.x} dy={i === 0 ? 0 : 17} fontSize={i === 0 ? 16 : 14}>
            {l}
          </tspan>
        ))}
      </text>
    </Wrapper>
  );
}

export default function DiscoveryMap() {
  const [hover, setHover] = useState<string | null>(null);
  // Which lines are emphasised: the PHGDH route (default) or the five network lines.
  const [mode, setMode] = useState<"route" | "network">("route");
  const emphasised = (id: string) => (mode === "route" ? id === ROUTE_ID : id !== ROUTE_ID);
  const boxRef = useRef<HTMLDivElement>(null);

  // When the box is narrower than the map (phones), open scrolled so the
  // central hub is centered. A no-op on desktop, where nothing scrolls.
  useEffect(() => {
    const box = boxRef.current;
    if (!box || box.scrollWidth <= box.clientWidth) return;
    const hubFraction = (HUB_X - VIEW_X) / VIEW_W;
    box.scrollLeft = hubFraction * box.scrollWidth - box.clientWidth / 2;
  }, []);

  return (
    <div>
      <div
        ref={boxRef}
        className="rounded-2xl border border-outline-variant/60 bg-white shadow-sm overflow-x-auto max-w-full"
      >
        <svg
          viewBox={`${VIEW_X} ${VIEW_Y} ${VIEW_W} ${VIEW_H}`}
          role="group"
          aria-label="Drug discovery map: the PHGDH route and five lines, Papers, Data, Tools, Projects and People, all meeting at SmartDrugDiscovery"
          className="block w-full min-w-[1000px] h-auto"
        >
          {/* Lines (the route last, so it sits on top where it matters) */}
          {ALL_LINES.map((line) => {
            const isRoute = line.id === ROUTE_ID;
            const on = hover === line.id;
            return (
              <path
                key={line.id}
                d={line.path}
                fill="none"
                stroke={line.color}
                strokeWidth={(isRoute ? 13 : 10) + (on ? 4 : 0)}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={on || emphasised(line.id) ? 1 : 0.25}
                style={{ transition: "stroke-width 150ms ease, opacity 200ms ease" }}
              />
            );
          })}

          {/* Stations and labels: faded lines keep readable (and clickable) stops */}
          {ALL_LINES.map((line) => (
            <g
              key={line.id}
              opacity={hover === line.id || emphasised(line.id) ? 1 : 0.45}
              style={{ transition: "opacity 200ms ease" }}
            >
              {line.stations.map((s) => (
                <StationNode
                  key={s.label[0]}
                  station={s}
                  color={line.color}
                  lineId={line.id}
                  setHover={setHover}
                />
              ))}
            </g>
          ))}

          {/* Central interchange, drawn last so it sits over every line */}
          <Link href="/explore" aria-label="SmartDrugDiscovery, explore everything">
            <rect
              x={475}
              y={355}
              width={250}
              height={90}
              rx={45}
              fill="#fff"
              stroke="#002109"
              strokeWidth={7}
            />
            <text
              x={600}
              y={407}
              textAnchor="middle"
              className="font-headline-md"
              fontSize={22}
              fontWeight={700}
              fill="#002109"
              style={{ pointerEvents: "none" }}
            >
              SmartDrugDiscovery
            </text>
          </Link>
        </svg>
      </div>

      <div className="mt-3 text-center">
        <button
          type="button"
          onClick={() => setMode((m) => (m === "route" ? "network" : "route"))}
          className="font-label-md text-label-md text-primary hover:underline underline-offset-4"
        >
          {mode === "route" ? "Show the full network" : "Show the PHGDH route"} ⇄
        </button>
      </div>

      <p className="md:hidden mt-2 text-center font-label-sm text-label-sm text-secondary">
        <span className="material-symbols-outlined align-middle text-base mr-1">swipe</span>
        Swipe to explore the map
      </p>

      {/* Legend */}
      <ul className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-2">
        {ALL_LINES.map((line) => (
          <li
            key={line.id}
            className="flex items-center gap-2 font-label-md text-label-md text-on-surface"
          >
            <span
              aria-hidden
              className="inline-block h-2 w-7 rounded-full"
              style={{ background: line.color }}
            />
            {line.name}
          </li>
        ))}
        <li className="flex items-center gap-2 font-label-md text-label-md text-secondary">
          <span
            aria-hidden
            className="inline-block h-4 w-4 rounded-full border-[3px] border-dashed"
            style={{ borderColor: LOCKED_GREY }}
          />
          Invite code
        </li>
      </ul>
    </div>
  );
}
