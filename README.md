# SDD Navigator

A research discovery platform for drug-discovery researchers, built at UAB's
Systems Pharmacology AI Research Center under Prof. Jake Chen. It has three
surfaces, each usable on its own: Explore (find papers, tools, trials, grants,
podcasts, people), Collaborate (a haves/needs board where Connect requests
land in an inbox), and Promote (showcase your work, or turn a DOI into
LinkedIn posts).

Browsing needs no account. An account is only required to post, connect,
submit, or comment.

## Architecture

There are two runtime pieces, plus one offline pipeline. They are not fully
independent: the frontend depends on the Python service for Explore's live
search, but the rest of the app (Collaborate, Promote, auth, profiles) works
without it.

```
                     ┌─────────────────────────────────────┐
  Browser  ───────▶  │  Next.js frontend (frontend/)        │
                     │  App Router, Server Actions, RLS-    │
                     │  scoped Supabase client per request  │
                     └───────────────┬───────────────────────┘
                                     │
                        POST /api/explore, GET /api/papers
                                     │  (plain HTTP bridge)
                                     ▼
                     ┌─────────────────────────────────────┐
                     │  explore-mcp (backend/explore-mcp/)  │
                     │  Python, FastMCP over streamable-    │
                     │  HTTP, 9 tools, in-process cache      │
                     └───────────────┬───────────────────────┘
                                     │
                    PubMed, OpenAlex, Crossref, ClinicalTrials.gov,
                    Grants.gov, GitHub, plus Supabase (read-only)
```

Both the frontend and `explore-mcp` read and write the same Supabase project.
There is one database, not one per service. `explore-mcp` only ever reads
from it (lab resources, people, the podcast wiki). Every write goes through
the frontend, gated by Postgres RLS.

Why a backend that speaks MCP instead of a plain REST API: the tools are
meant to be called by agents, not just this one frontend. Pleaser and future
agents read the tool descriptions below and decide for themselves what to
call and when. The Next.js app is one client among possibly several, not the
only reason the service exists. `explore-mcp` also exposes a couple of plain
HTTP routes (`/api/explore`, `/api/papers`) as a bridge so the frontend
doesn't need an MCP client. That bridge is additive, not the primary
interface.

Where the boundary sits, concretely:
- Explore's search and the "Live Literature" rail on episode pages go through
  `explore-mcp`.
- Promote's DOI/PMID lookup (`lib/server/promote/fetchPaper.ts`) and its
  LinkedIn-post generator call PubMed, Crossref, bioRxiv and Groq directly
  from the Next.js server. This is a deliberate second, independent path,
  not a shortcut around the backend: a single-paper lookup doesn't need
  `explore-mcp`'s aggregation or ranking.
- The podcast pipeline (`backend/podcast-agent/`) is a standalone offline
  script, run by hand or on a schedule, that transcribes episodes and writes
  straight to Supabase. It has no runtime relationship to `explore-mcp` or
  the frontend process. It just populates a table (`wiki_pages`) that both
  of them later read.

Data rule: persist only what doesn't exist elsewhere. Lab resources, wiki
pages, profiles, posts and showcase entries live in the database because
they're user-generated. Results from PubMed, OpenAlex, Crossref and the
other sources are never stored as a copy. They're fetched live and cached
briefly in memory, not written to a table.

## The nine MCP tools

Exposed by `explore-mcp` (`backend/explore-mcp/server.py`):

| Tool | What it does |
|---|---|
| `search_papers` | Live literature search across PubMed, OpenAlex and Crossref, de-duplicated and ranked (WINNER network centrality when the result set forms a real citation graph, otherwise a plain sort). |
| `search_news` | The most recent OpenAlex works for a field/topic, newest first, for "what's new" rather than a targeted search. |
| `search_trials` | Clinical studies from ClinicalTrials.gov for a disease or intervention. |
| `search_grants` | Federal funding opportunities from Grants.gov. |
| `search_tools` | Open-source software repositories from GitHub, ranked by stars. |
| `search_lab_resources` | The internal lab-resource registry (people, techniques, equipment, models, reagents, software), read-only, contact info never returned. |
| `search_people` | Researchers, merging public platform profiles with internal-registry collaborators. Email is never returned. |
| `search_wiki` | The internal podcast-derived episode wiki (title, description, concepts, tags, not the transcript). |
| `explore` | Orchestration: reasons over free text, decides which of the above tools apply, runs them in parallel, and returns results grouped by kind. |

Why WINNER: Prof. Chen published WINNER (Weighted In-Network Node Expansion
and Ranking) for ranking proteins within molecular interaction networks.
`search_papers` applies the same idea to a set of papers, treating citations
between them as a graph and ranking by centrality in that graph rather than
by raw citation count. It exists to surface work that a citation-count sort
buries.

## Running locally

### Frontend

```bash
cd frontend
npm install
npm run dev      # http://localhost:3000
```

Required env vars (`frontend/.env.local`, copy from `.env.example`):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `EXPLORE_API_URL`, base URL of `explore-mcp`'s HTTP bridge (defaults to
  `http://localhost:8000` if unset)
- `GROQ_API_KEY`, used server-side by Promote's post generator
- `SUPABASE_SERVICE_ROLE_KEY`, used server-side, only by account deletion

### Backend (explore-mcp)

```bash
cd backend/explore-mcp
python -m venv venv
venv\Scripts\activate        # Windows; source venv/bin/activate elsewhere
pip install -r requirements.txt
cp .env.example .env         # fill in, see below
python server.py             # MCP at /mcp, health at /health, port 8000 by default
```

Required env vars (`backend/explore-mcp/.env`):

- `GROQ_API_KEY` (or `LLM_API_KEY` with a matching `LLM_PROVIDER`/`LLM_MODEL`)
- `SUPABASE_URL`
- `SUPABASE_KEY`, service-role key, read-only usage (`search_lab_resources`,
  `search_people`, `search_wiki`)

Optional env vars. Each source degrades to a lower unauthenticated rate
limit if unset rather than failing:

- `NCBI_API_KEY` (PubMed)
- `OPENALEX_EMAIL` (OpenAlex polite pool)
- `GITHUB_TOKEN` (`search_tools`)
- `PREWARM_ENABLED`, `PREWARM_INTERVAL_SEC`, pre-warms the blank landing feed
  on startup so the first real visitor doesn't pay for a cold cache
- `MCP_HOST`, `MCP_PORT`

### Podcast pipeline (offline, optional)

```bash
cd backend/podcast-agent
pip install -r ../requirements.txt   # requires ffmpeg on PATH
python pipeline.py                   # latest unprocessed episode
```

Required env vars (`backend/.env`): `SUPABASE_URL`, `SUPABASE_KEY`,
`GROQ_API_KEY`, and optionally `RSS_URL`.

## Docker

Only `explore-mcp` has a Dockerfile today. The frontend is deployed some
other way, not part of this repo.

```bash
cd backend/explore-mcp
docker build -t explore-mcp .
docker run --rm -p 8000:8000 --env-file .env explore-mcp
```

The build is offline: every PyPI dependency installs from a pre-downloaded
wheelhouse (`docker-wheels/`), because `pypi.org` is unreachable from inside
a container on this project's network, while `github.com` is. That's also
why `winner-net` (a git-only dependency, no PyPI release) still installs
directly from GitHub. See `backend/explore-mcp/README.md` for the exact
steps to regenerate the wheelhouse if `requirements.txt` changes.

The image always runs a single worker. `explore-mcp`'s cache and its
single-flight request coalescing are in-process (an `asyncio.Lock` and a
plain dict), so a second worker would be a second process with its own,
unsynchronized copy of both. Every unique query would silently get
computed, and hit upstream, twice. Scale this service with more containers
behind a load balancer, not more workers inside one, unless the cache is
first moved to something shared like Redis.

## Known limitations

- The Explore "Live Literature" rail and `/explore/[topic]` search both
  require `explore-mcp` to be reachable. If it's down, the frontend shows an
  honest "couldn't search" state rather than pretending nothing matched, but
  it does not degrade to any kind of local fallback.
- `explore-mcp`'s cache and single-flight coalescing are per-process, which
  is why the container (and any other deployment of it) has to stay
  single-worker until that cache moves to a shared backend like Redis.
- Search over podcast episodes (`search_wiki`, and the equivalent in the
  frontend) is a simple client-side/in-memory match over the wiki table.
  That's fine at the current scale, about 64 episodes, and would need a
  real search index well before it reached thousands.
