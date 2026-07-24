# Explore Agent — scaffold

A minimal, standalone FastAPI service that proves the core agentic loop for Explore's
literature search: read free-text input → let the LLM decide whether to call a tool →
if so, call the one real tool and return the real result.

**Completely separate from `backend/podcast-agent/`** (the podcast pipeline). No shared files.

## What it does
- One tool: `search_papers(query)` — a thin proxy to the existing Next.js
  `/api/discover` endpoint. No PubMed/Crossref logic is reimplemented.
- One endpoint: `POST /explore` with `{ "input": "<free text>" }`.
- Uses Groq (`llama-3.3-70b-versatile`) tool-calling to decide whether to search.
- Returns the tool-call decision (tool + argument) **and** the real result.

## Run locally

1. **Start the Next.js app** (owns `/api/discover`) in one terminal:
   ```bash
   cd frontend
   npm run dev            # http://localhost:3000
   ```

2. **Start this service** in another terminal:
   ```bash
   cd backend/explore-agent
   python -m venv venv && venv\Scripts\activate      # Windows (use source venv/bin/activate on macOS/Linux)
   pip install -r requirements.txt
   cp .env.example .env    # then paste GROQ_API_KEY (same value as frontend/.env.local)
   uvicorn main:app --reload --port 8100
   ```

3. **Call it:**
   ```bash
   curl -s -X POST http://localhost:8100/explore \
     -H "Content-Type: application/json" \
     -d '{"input":"What are recent EGFR inhibitors for glioblastoma?"}'
   ```

Out of scope for this scaffold: the other 5 source tools, persistence, auth,
Docker/deploy config.
