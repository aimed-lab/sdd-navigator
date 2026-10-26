"use client";

// "Join with a QR code": a real button on the teams home. It opens a full-screen
// sheet with the rear camera and reads QR codes continuously (the browser's
// BarcodeDetector when it exists, else the small jsqr library, which is what
// iPhone Safari uses). Only a link to a team page is accepted, and it is opened
// on the site the visitor is on now. Where there is no camera (desktop, blocked,
// no HTTPS) or as a fallback, a team link can be pasted instead. The camera is
// stopped when the sheet closes or the page goes away.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseTeamLink } from "@/lib/server/teams/teamLink";

type Camera = "starting" | "on" | "unavailable";

type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue?: string }[]> };
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

const NOT_TEAM = "That QR code isn't a team link.";
const SCAN_EVERY_MS = 150;
const MAX_SCAN_WIDTH = 480;

const INPUT =
  "w-full bg-white border border-[#d9d5c9] rounded-lg px-4 py-3 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40";

export default function JoinQrScanner() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-2xl border border-[#e8e4da] bg-white px-6 py-4 text-center flex flex-col items-center justify-center gap-1 hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 transition-colors"
      >
        <span className="font-label-lg text-[18px] text-on-background inline-flex items-center gap-2">
          <span className="material-symbols-outlined">qr_code_scanner</span>
          Join with a QR code
        </span>
        <span className="font-body-sm text-body-sm text-secondary">Scan the QR code your organiser shared</span>
      </button>
      {open && <ScannerSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function ScannerSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<Camera>("starting");
  const [cameraNote, setCameraNote] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const done = useRef(false);

  const go = useCallback(
    (path: string) => {
      if (done.current) return;
      done.current = true;
      router.push(path);
      onClose();
    },
    [router, onClose]
  );

  // The camera effect must not restart when the parent re-renders, so it reads go through a ref.
  const goRef = useRef(go);
  goRef.current = go;

  // Camera + scan loop. Everything it starts is stopped in the cleanup, which
  // runs when the sheet closes or the page navigates away (the component unmounts).
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopped = false;
    let lastBad = "";
    let lastBadAt = 0;

    const stop = () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      const v = videoRef.current;
      if (v) v.srcObject = null;
    };

    const onValue = (value: string) => {
      const link = parseTeamLink(value, window.location.origin);
      if (link.ok) {
        stop();
        goRef.current(link.path);
        return;
      }
      // Not ours: say so, keep scanning, and do not flash the same code repeatedly.
      const now = Date.now();
      if (value !== lastBad || now - lastBadAt > 2500) {
        setMessage(NOT_TEAM);
        lastBad = value;
        lastBadAt = now;
        window.setTimeout(() => setMessage((m) => (m === NOT_TEAM ? null : m)), 2500);
      }
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraNote("The camera isn't available in this browser.");
        setCamera("unavailable");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
      } catch (e) {
        const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
        setCameraNote(denied ? "The camera is blocked. Allow it in your browser, or paste the link." : "No camera could be started.");
        setCamera("unavailable");
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // autoplay can reject while the stream still works; frames arrive anyway
      }
      setCamera("on");

      const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
      let detector: Detector | null = null;
      try {
        detector = Ctor ? new Ctor({ formats: ["qr_code"] }) : null;
      } catch {
        detector = null;
      }
      const jsQR = detector ? null : (await import("jsqr")).default;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      const tick = async () => {
        if (stopped) return;
        try {
          if (video.readyState >= 2 && video.videoWidth > 0) {
            let value: string | undefined;
            if (detector) {
              value = (await detector.detect(video))[0]?.rawValue;
            } else if (jsQR && ctx) {
              const k = Math.min(1, MAX_SCAN_WIDTH / video.videoWidth);
              canvas.width = Math.round(video.videoWidth * k);
              canvas.height = Math.round(video.videoHeight * k);
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              value = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data;
            }
            if (value && !stopped) onValue(value);
          }
        } catch {
          // a failed frame is skipped
        }
        if (!stopped) timer = window.setTimeout(tick, SCAN_EVERY_MS);
      };
      tick();
    })();

    const onHide = () => stop();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      stop();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const submitPaste = (e: React.FormEvent) => {
    e.preventDefault();
    const link = parseTeamLink(pasted, window.location.origin);
    if (!link.ok) return setPasteError(NOT_TEAM.replace("QR code", "link"));
    go(link.path);
  };

  const paste = (
    <form onSubmit={submitPaste} className="flex flex-col gap-2">
      <label htmlFor="paste-team-link" className="font-label-md text-label-md">
        {camera === "unavailable" ? "Paste a team link" : "Or paste a team link"}
      </label>
      <div className="flex gap-2">
        <input
          id="paste-team-link"
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={pasted}
          onChange={(e) => {
            setPasted(e.target.value);
            setPasteError(null);
          }}
          placeholder="https://…/teams/your-team"
          className={INPUT}
        />
        <button type="submit" className="btn-primary px-5 rounded-lg font-label-md text-label-md shrink-0">
          Go
        </button>
      </div>
      {pasteError && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {pasteError}
        </p>
      )}
    </form>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label="Scan a team QR code" className="fixed inset-0 z-[80] bg-black flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <h2 className="font-label-lg text-[16px] leading-6">Scan the team QR code</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-white/60 px-4 py-2 font-label-md text-label-md text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          Cancel
        </button>
      </div>

      {camera === "unavailable" ? (
        <div className="flex-1 overflow-y-auto bg-[#fbfaf7] text-on-background px-4 py-6 flex flex-col gap-4">
          {cameraNote && <p className="font-body-md text-body-md text-secondary">{cameraNote}</p>}
          {paste}
        </div>
      ) : (
        <>
          <div className="relative flex-1 min-h-0 overflow-hidden">
            {/* playsInline + muted: iPhone Safari will not show a live camera inline otherwise */}
            <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 w-full h-full object-cover" />
            {camera === "starting" && (
              <p className="absolute inset-0 flex items-center justify-center text-white/90 font-body-md text-body-md">
                Starting the camera…
              </p>
            )}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="w-[62vmin] max-w-[320px] aspect-square rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
            {message && (
              <p
                role="alert"
                className="absolute left-4 right-4 bottom-4 rounded-lg bg-white px-4 py-3 text-center font-body-md text-body-md text-error"
              >
                {message}
              </p>
            )}
          </div>
          <div className="bg-[#fbfaf7] text-on-background px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{paste}</div>
        </>
      )}
    </div>
  );
}
