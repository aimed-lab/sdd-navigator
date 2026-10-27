"use client";

// A one-time toast carried in the URL across a redirect: /teams?left=1 shows
// "You left the team.". The parameter is removed from the address bar once shown.

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check } from "lucide-react";

const MESSAGES: Record<string, string> = { left: "You left the team." };

export default function FlashToast() {
  const params = useSearchParams();
  const router = useRouter();
  const key = Object.keys(MESSAGES).find((k) => params.get(k) === "1") ?? null;
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!key) return;
    setText(MESSAGES[key]);
    router.replace("/teams", { scroll: false });
    const t = window.setTimeout(() => setText(null), 3500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!text) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed z-[90] left-1/2 -translate-x-1/2 bottom-[max(1.25rem,env(safe-area-inset-bottom))] max-w-[calc(100vw-32px)] rounded-full bg-[#1c1b17] text-white px-5 py-3 text-[14.5px] font-semibold leading-5 shadow-[0_8px_30px_rgba(0,0,0,0.3)] inline-flex items-center gap-2"
    >
      <Check size={18} strokeWidth={2} className="text-[#6ee7a0]" aria-hidden />
      {text}
    </div>
  );
}
