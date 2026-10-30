"use client";

// The white card in the team hero: the join QR (about 112px), "Scan to join",
// then Download QR and Copy link side by side. The QR is built in the browser
// from window.location.origin so it points at the host the page is served from.

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { teamJoinUrl } from "@/lib/server/teams/teamRules";

const INK = "#191c1e";

const BTN =
  "inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-[#d9d5c9] bg-white px-2.5 py-1.5 text-[12.5px] font-semibold leading-5 text-on-background hover:border-primary hover:text-primary disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

export default function TeamQrCard({ slug, name }: { slug: string; name: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    QRCode.toDataURL(teamJoinUrl(window.location.origin, slug), {
      width: 320,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: INK, light: "#ffffff" },
    })
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [slug]);

  async function download() {
    // A big, high-contrast PNG: crisp when projected or printed.
    const url = await QRCode.toDataURL(teamJoinUrl(window.location.origin, slug), {
      width: 1200,
      margin: 4,
      errorCorrectionLevel: "H",
      color: { dark: "#000000", light: "#ffffff" },
    });
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}-join-qr.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(teamJoinUrl(window.location.origin, slug));
    } catch {
      // The link is still in the address bar; failing quietly strands no one.
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  // Below 640px the card is hidden behind one outline button; from 640px it is always shown.
  const [shown, setShown] = useState(false);

  return (
    <div className="w-full lg:w-[220px] shrink-0 flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-expanded={shown}
        aria-controls="team-qr-card"
        className="sm:hidden inline-flex items-center justify-center gap-2 rounded-lg border border-white/70 px-4 py-2.5 text-[14px] font-semibold leading-5 text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <span className="material-symbols-outlined text-[20px]">qr_code_2</span>
        {shown ? "Hide QR code" : "Show QR code to invite"}
      </button>

      <div
        id="team-qr-card"
        className={`${shown ? "flex" : "hidden"} sm:flex w-full rounded-2xl bg-white text-on-background p-4 flex-col items-center gap-2 shadow-[0_6px_20px_rgba(0,0,0,0.18)]`}
      >
        <div className="w-28 h-28 rounded-lg bg-white border border-[#e8e4da] p-1.5 flex items-center justify-center">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={`QR code to join ${name}`} width={100} height={100} className="w-full h-full" />
          ) : (
            <span className="material-symbols-outlined text-secondary/40 text-5xl">qr_code_2</span>
          )}
        </div>
        <span className="text-[13px] leading-5 font-semibold text-secondary">Scan to join</span>
        {/* Side by side while there is room (a full-width card); stacked, one per row,
            in the 220px card on desktop, where two labels do not fit on one line. */}
        <div className="flex w-full flex-row lg:flex-col gap-2">
          <button type="button" onClick={download} disabled={!src} className={`${BTN} flex-1`}>
            <span className="material-symbols-outlined text-[16px]">download</span>
            Download QR
          </button>
          <button type="button" onClick={copy} className={`${BTN} flex-1`}>
            <span className="material-symbols-outlined text-[16px]">{copied ? "check" : "link"}</span>
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      </div>
    </div>
  );
}
