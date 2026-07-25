// Shape of one podcast episode as served by /api/podcast.
//
// The Python backend returns its generic Item envelope with the wiki_pages row
// under `raw`; the proxy route flattens that to this shape so pages never have
// to dig through `raw`. `transcript` is never selected by search_wiki and so is
// never present here.

export type Concept = {
  title: string;
  bullets: string[];
};

export type Episode = {
  id: string;
  slug: string;
  title: string;
  episode_number: number | null;
  description: string | null;
  summary: string[];
  concepts: Concept[];
  tags: string[];
  episode_url: string | null;
  image_url: string | null;
};

// One episode's FULL record, as served by /api/podcast/<slug>. Same shape as
// Episode plus the transcript, which the grid never carries.
export type EpisodeDetail = Episode & {
  transcript: string | null;
};

export type PodcastResponse = {
  query: string;
  count: number;
  episodes: Episode[];
  error?: boolean;
};
