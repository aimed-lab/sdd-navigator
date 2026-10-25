// The assistant's "status of my projects": recognising the question and writing
// the answer. Pure, so `npm test` covers it.

import { buildProjectStatus, dueLabel } from "./status.ts";

/** Is this chat message asking for the status of the researcher's projects? */
export function projectStatusQuestion(text: string): { matches: boolean; colabofestOnly: boolean } {
  const t = (text ?? "").trim();
  const asks =
    /\b(?:status|progress|how(?:'s| is| are)|update on|updates on|where (?:are|do) we)\b[^.?!]{0,60}\b(?:my|our)\b[^.?!]{0,30}\bprojects?\b/i.test(t) ||
    /\b(?:my|our)\b[^.?!]{0,30}\bprojects?\b[^.?!]{0,30}\b(?:status|progress|doing)\b/i.test(t);
  return { matches: asks, colabofestOnly: asks && /colabo\s*fest/i.test(t) };
}

type ReplyStatus = ReturnType<typeof buildProjectStatus>;

/** The assistant's answer, as short markdown. */
export function formatStatusReply(statuses: ReplyStatus[], opts: { colabofestOnly?: boolean; total?: number } = {}): string {
  if (statuses.length === 0) {
    return opts.colabofestOnly
      ? "You are not on any ColaboFest 2026 projects yet."
      : "You are not on any projects yet. Open Projects and click New project to start one.";
  }
  const blocks = statuses.map((s) => {
    const lines = [`**${s.project}**: ${s.status}`];
    for (const l of s.checklists) {
      lines.push(`- ${l.list}: ${l.total === 0 ? "no items yet" : `${l.ready} of ${l.total} ready`}`);
    }
    if (s.overdue_items.length > 0) {
      const shown = s.overdue_items.slice(0, 5).map((o) => {
        const who = o.owner ? o.owner : "no owner";
        const due = o.due ? `, due ${dueLabel(o.due) ?? o.due}` : "";
        return `${o.item} (${who}${due})`;
      });
      const more = s.overdue_items.length > 5 ? `; and ${s.overdue_items.length - 5} more` : "";
      lines.push(`- Overdue: ${shown.join("; ")}${more}`);
    } else {
      lines.push("- Nothing overdue");
    }
    for (const h of s.open_help_requests.slice(0, 3)) {
      lines.push(`- Needs help: ${h.text}${h.by ? ` (${h.by})` : ""}`);
    }
    if (s.latest_updates.length > 0) {
      lines.push(`- Latest: ${s.latest_updates.map((u) => `${u.text} (${u.posted})`).join("; ")}`);
    } else {
      lines.push("- No updates posted yet");
    }
    if (s.wiki_pages.length > 0) lines.push(`- Wiki pages: ${s.wiki_pages.slice(0, 6).join(", ")}`);
    return lines.join("\n");
  });
  const more = opts.total && opts.total > statuses.length ? `\n\nShowing ${statuses.length} of ${opts.total} projects.` : "";
  return blocks.join("\n\n") + more;
}
