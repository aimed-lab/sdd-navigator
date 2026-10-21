"use client";

// QR code for the community's join link (`/communities/<slug>?join=1`).
// Built in the browser with the `qrcode` package, from window.location.origin,
// so it always points at the host the page is really served from (a server
// component only knows the path). Admins also get a PNG download sized for
// slides and posters.

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { joinUrl } from "@/lib/server/communityHome/communityHome";

const INK = "#191c1e";

export default function JoinQr({
  slug,
  name,
  isAdmin,
}: {
  slug: string;
  name: string;
  isAdmin: boolean;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    QRCode.toDataURL(joinUrl(window.location.origin, slug), {
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
    const url = await QRCode.toDataURL(joinUrl(window.location.origin, slug), {
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

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="w-28 h-28 rounded-lg bg-white border border-outline-variant/40 p-1.5 flex items-center justify-center">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={`QR code to join ${name}`} width={104} height={104} className="w-full h-full" />
        ) : (
          <span className="material-symbols-outlined text-secondary/40 text-4xl">qr_code_2</span>
        )}
      </div>
      <span className="font-label-sm text-label-sm text-secondary">Scan to join</span>
      {isAdmin && (
        <button
          type="button"
          onClick={download}
          disabled={!src}
          className="font-label-sm text-label-sm text-primary hover:underline underline-offset-4 disabled:opacity-40 inline-flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[16px]">download</span>
          Download QR (PNG)
        </button>
      )}
    </div>
  );
}
