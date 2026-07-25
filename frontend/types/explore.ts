// Shapes returned by the Python explore backend (via /api/explore).

export type Signal = {
  metric: string; // "citations" | "stars" | "recency"
  value: number;
  as_of: string;
};

export type ExploreItem = {
  id: string;
  kind: string; // paper | news | trial | grant | tool | resource | person | episode
  title: string;
  summary: string | null;
  url: string | null;
  doi?: string | null;
  source: string;
  date_iso: string | null;
  signal: Signal | null;
  dedupe_key?: string;
  raw?: Record<string, unknown>;
};

export type ExploreSection = {
  tool: string;
  kind: string;
  query?: string;
  items: ExploreItem[];
  error?: string;
};

export type ExploreResponse = {
  input?: string;
  scope?: Record<string, unknown> & { is_default?: boolean };
  tools_called?: string[];
  reasoning?: string | null;
  sections: ExploreSection[];
  error?: boolean;
};
