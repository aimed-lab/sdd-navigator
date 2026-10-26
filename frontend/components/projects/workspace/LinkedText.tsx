// Plain text with http(s) links made clickable. Rendered as text nodes and
// anchors only, never as HTML, so nothing a member types can inject markup.
// Put it inside an element with `whitespace-pre-wrap break-words`.

import { linkify } from "@/lib/server/projectWorkspace/colabofest";

export default function LinkedText({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((p, i) =>
        p.href ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 break-all">
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </>
  );
}
