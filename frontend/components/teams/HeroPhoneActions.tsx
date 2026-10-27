"use client";

// Two buttons in the team hero on a phone: "Show QR" (opens the join QR in a small
// dialog with Download QR) and "Copy link". On a desktop the QR card on the right of
// the hero does this job, so these are hidden from `md` up.

import { useState } from "react";
import { Check, Download, Link as LinkIcon, QrCode } from "lucide-react";
import QRCode from "qrcode";
import Sheet from "@/components/ui/Sheet";
import { teamJoinUrl } from "@/lib/server/teams/teamRules";

const INK = "#191c1e";

export default function HeroPhoneActions({ slug, name }: { slug: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const show = async () => {
    setOpen(true);
    if (src) return;
    try {
      setSrc(
        await QRCode.toDataURL(teamJoinUrl(window.location.origin, slug), {
          width: 560,
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: INK, light: "#ffffff" },
        })
      );
    } catch {
      setSrc(null);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(teamJoinUrl(window.location.origin, slug));
    } catch {
      // The link is still in the address bar; failing quietly strands no one.
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const download = async () => {
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
  };

  return (
    <>
      <div className="md:hidden flex gap-2 mt-3.5">
        <button
          type="button"
          onClick={show}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-[10px] bg-white px-2 py-[9px] text-[13px] font-bold leading-5 text-[#0f6b33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        >
          <QrCode size={18} strokeWidth={1.75} aria-hidden />
          Show QR
        </button>
        <button
          type="button"
          onClick={copy}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-white/30 bg-white/[0.12] px-2 py-[9px] text-[13px] font-bold leading-5 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        >
          {copied ? <Check size={18} strokeWidth={1.75} aria-hidden /> : <LinkIcon size={18} strokeWidth={1.75} aria-hidden />}
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>

      {open && (
        <Sheet title="Scan to join" onClose={() => setOpen(false)}>
          <div className="flex flex-col items-center gap-4">
            <div className="w-56 h-56 rounded-xl border border-[#e8e4da] bg-white p-2 grid place-items-center">
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt={`QR code to join ${name}`} className="w-full h-full" />
              ) : (
                <QrCode size={64} strokeWidth={1.25} className="text-[#6b6a64]/50" aria-hidden />
              )}
            </div>
            <p className="text-[13.5px] leading-5 text-[#6b6a64] text-center">Anyone who scans this can join {name}.</p>
            <button
              type="button"
              onClick={download}
              disabled={!src}
              className="inline-flex items-center justify-center gap-1.5 rounded-[10px] bg-[#0f6b33] px-5 py-2.5 text-[13px] font-bold leading-5 text-white hover:bg-[#0b3d22] disabled:opacity-40"
            >
              <Download size={18} strokeWidth={1.75} aria-hidden />
              Download QR
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
