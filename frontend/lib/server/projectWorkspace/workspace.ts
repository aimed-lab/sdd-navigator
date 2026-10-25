// Project workspace (/projects/[id]): the pure helpers. Which tabs exist and how
// ?tab= is read, the sidebar label, checklist progress and next items, and the
// nesting of a project's wiki pages. No I/O, no next/* imports, so
// `npm test` covers it and client components may import it.

export const TAB_KEYS = ["overview", "updates", "wiki", "tasks", "files", "team", "proposal"] as const;
export type TabKey = (typeof TAB_KEYS)[number];

export const TAB_LABEL: Record<TabKey, string> = {
  overview: "Overview",
  updates: "Updates",
  wiki: "Wiki",
  tasks: "Tasks & checklists",
  files: "Files",
  team: "Team",
  proposal: "Proposal",
};

export const TAB_ICON: Record<TabKey, string> = {
  overview: "dashboard",
  updates: "campaign",
  wiki: "menu_book",
  tasks: "checklist",
  files: "folder_shared",
  team: "group",
  proposal: "description",
};

/** The tabs a project shows. Proposal exists only for a challenge project. */
export function visibleTabs(isChallenge: boolean): TabKey[] {
  return TAB_KEYS.filter((t) => t !== "proposal" || isChallenge);
}

/** The tab named by ?tab=, or Overview when it is missing, unknown, or not
 *  available for this project (Proposal on an ordinary project). */
export function parseTab(raw: string | string[] | undefined, isChallenge: boolean): TabKey {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const hit = visibleTabs(isChallenge).find((t) => t === v);
  return hit ?? "overview";
}

/** The link to a tab. Overview is the plain project URL. */
export function tabHref(projectId: string, tab: TabKey): string {
  return tab === "overview" ? `/projects/${projectId}` : `/projects/${projectId}?tab=${tab}`;
}

const CHALLENGE_LABEL: Record<string, string> = {
  colabofest_2026: "ColaboFest 2026",
};

/** The small label under the project name: the challenge it is entered in
 *  (e.g. "ColaboFest 2026"), or null for an ordinary project. */
export function projectLabel(challengeKey: string | null | undefined): string | null {
  const k = (challengeKey ?? "").trim();
  if (!k) return null;
  if (CHALLENGE_LABEL[k]) return CHALLENGE_LABEL[k];
  return k
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function teamSizeLabel(n: number): string {
  return `${n} ${n === 1 ? "member" : "members"}`;
}

// ── checklist ────────────────────────────────────────────────────────────────

type Item = { label: string; status: string; position: number };

export function checklistProgress(items: Pick<Item, "status">[]): { ready: number; total: number; percent: number } {
  const total = items.length;
  const ready = items.filter((i) => i.status === "ready").length;
  return { ready, total, percent: total === 0 ? 0 : Math.round((ready / total) * 100) };
}

/** The next items to work on: not ready yet, "in progress" first, then by
 *  position. */
export function nextItems<T extends Item>(items: T[], n = 4): T[] {
  const rank = (s: string) => (s === "in_progress" ? 0 : 1);
  return items
    .filter((i) => i.status !== "ready")
    .slice()
    .sort((a, b) => rank(a.status) - rank(b.status) || a.position - b.position)
    .slice(0, n);
}

// ── wiki pages ───────────────────────────────────────────────────────────────

export type ProjectPageRow = {
  id: string;
  slug: string;
  title: string;
  parent_page_id: string | null;
  created_at?: string | null;
};

export type PageNode<T extends ProjectPageRow = ProjectPageRow> = { page: T; children: PageNode<T>[]; depth: number };

/** Pages as a tree: sub-pages sit under their parent (oldest first). A page
 *  whose parent is not in the list (deleted, or not visible) is shown at the top
 *  level. A cycle in the data cannot loop. */
export function nestPages<T extends ProjectPageRow>(pages: T[]): PageNode<T>[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const sorted = pages.slice().sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.title.localeCompare(b.title));
  const kids = new Map<string, T[]>();
  const roots: T[] = [];
  for (const p of sorted) {
    if (p.parent_page_id && p.parent_page_id !== p.id && byId.has(p.parent_page_id)) {
      const list = kids.get(p.parent_page_id) ?? [];
      list.push(p);
      kids.set(p.parent_page_id, list);
    } else {
      roots.push(p);
    }
  }
  const seen = new Set<string>();
  const build = (p: T, depth: number): PageNode<T> => {
    seen.add(p.id);
    return {
      page: p,
      depth,
      children: (kids.get(p.id) ?? []).filter((c) => !seen.has(c.id)).map((c) => build(c, depth + 1)),
    };
  };
  const tree = roots.map((r) => build(r, 0));
  // Pages caught in a parent cycle have no root; show them at the top level too.
  for (const p of sorted) if (!seen.has(p.id)) tree.push(build(p, 0));
  return tree;
}

/** The tree as a flat list in reading order, with each page's depth. */
export function flattenPages<T extends ProjectPageRow>(tree: PageNode<T>[]): { page: T; depth: number }[] {
  const out: { page: T; depth: number }[] = [];
  const walk = (nodes: PageNode<T>[]) => {
    for (const n of nodes) {
      out.push({ page: n.page, depth: n.depth });
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

export const WIKI_TITLE_MIN = 3;
export const WIKI_TITLE_MAX = 120;

/** The title typed for "New wiki page" (it is also the topic the page is
 *  researched from), cleaned, or an error to show. */
export function parseWikiTitle(raw: unknown): { ok: true; title: string } | { ok: false; error: string } {
  const t = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (t.length < WIKI_TITLE_MIN) return { ok: false, error: "Give the page a title of at least 3 characters." };
  if (t.length > WIKI_TITLE_MAX) return { ok: false, error: `Keep the title under ${WIKI_TITLE_MAX} characters.` };
  return { ok: true, title: t };
}
