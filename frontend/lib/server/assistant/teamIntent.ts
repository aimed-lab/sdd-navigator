// lib/server/assistant/teamIntent.ts — which messages to the assistant are TEAM
// commands. Strict on purpose: only a clear "create a team" or "show my teams"
// sentence counts. A research question that merely mentions a team ("papers on
// team-based care") is not a command and still searches.
//
// A team command never reaches the research backend: no search, no source
// cards, no Save page, no Related questions. The panel answers it itself.
//
// No imports, so `npm test` runs it directly.

export type TeamIntent = { kind: "create"; name: string | null } | { kind: "list" };

export const TEAM_NAME_QUESTION = "What should the team be called?";
export const NON_ADMIN_COMMUNITY_NOTE = "Only site admins can create communities, so I made you a team instead.";
export const TEAM_CREATED_LINE = "Team created. You're its Lead.";

// Every pattern is anchored to the whole message, so extra words turn it back
// into a normal question.
const LEAD =
  "(?:(?:please|hey|hi|ok|okay)[,\\s]+)*" +
  "(?:(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?)?" +
  "(?:(?:please|just)\\s+)?" +
  "(?:(?:i|we)\\s*(?:want|need|would\\s+like|'d\\s+like|’d\\s+like|wanna)\\s+to\\s+|let(?:'|’)?s\\s+)?";

const VERB = "(?:create|make|start|set\\s*up|build)";

// create (me) a (new) team [called|named X | for ...]   /   (a) new team [...]
const CREATE_RE = new RegExp(
  "^" +
    LEAD +
    "(?:" +
    VERB +
    "\\s+(?:me\\s+|us\\s+)?(?:a\\s+|my\\s+|our\\s+)?(?:new\\s+)?team" +
    "|(?:a\\s+)?new\\s+team" +
    ")" +
    "(?:\\s+(?:called|named)\\s+(.+?)|\\s+for\\s+(.+?))?" +
    "\\s*[.!?]*$",
  "i"
);

// show / open / list my team(s), "my teams", "which teams am I on"
const LIST_RE = new RegExp(
  "^" +
    LEAD +
    "(?:" +
    "(?:show|list|open|see|view|find|go\\s+to|take\\s+me\\s+to)\\s+(?:me\\s+)?(?:all\\s+)?(?:of\\s+)?my\\s+teams?" +
    "|my\\s+teams?" +
    "|(?:what|which)\\s+(?:are\\s+)?(?:my\\s+)?teams?\\s+(?:am\\s+i\\s+(?:on|in)|do\\s+i\\s+(?:have|belong\\s+to))" +
    "|what\\s+are\\s+my\\s+teams" +
    ")" +
    "\\s*[.!?]*$",
  "i"
);

function cleanName(raw: string | undefined): string | null {
  if (!raw) return null;
  const n = raw
    .trim()
    .replace(/^["'“‘”’]+|["'“‘”’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return n ? n : null;
}

/** The team command in this message, or null when it is not one. */
export function detectTeamIntent(text: string): TeamIntent | null {
  const t = (text ?? "").trim();
  if (t.length < 4 || t.length > 200) return null;
  const c = CREATE_RE.exec(t);
  if (c) {
    // "called X" is the team's name. "for my talk" only says what it is for, so
    // the card still asks for a name.
    return { kind: "create", name: cleanName(c[1]) };
  }
  if (LIST_RE.test(t)) return { kind: "list" };
  return null;
}

/** What the assistant says above the team draft card. */
export function teamDraftReply(name: string | null): string {
  return name
    ? `Here is a team called ${name}. Add emails if you want to invite people, then press Create.`
    : "Let's make a team. Name it below, add emails if you want to invite people, then press Create.";
}

/** What the assistant says above the list of the person's teams. */
export function teamListReply(count: number): string {
  return count === 0
    ? "You are not on a team yet. You can create one now."
    : count === 1
      ? "You are on 1 team:"
      : `You are on ${count} teams:`;
}
