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

## Docker build

`docker build .` here does NOT hit pypi.org — every PyPI dependency installs
from a local wheelhouse (`./docker-wheels/`, gitignored, not committed)
instead. That's not a style choice: on this project's Docker setup, `pypi.org`
is specifically unreachable from inside any container (confirmed — DNS
resolves identically to the host, other domains including
`files.pythonhosted.org` and `github.com` ARE reachable from the same
containers, only `pypi.org` itself is not; looks like a deliberate network
policy rather than a flaky connection). `github.com` being reachable is why
`winner-net` — a git dependency with no PyPI release — still installs
straight from GitHub in the Dockerfile; every OTHER package needs the
wheelhouse.

**If you change `requirements.txt` (or bump `winner-net`'s pinned commit),
regenerate both `docker-wheels/` and `requirements.lock.txt`:**

1. From the HOST (not a container — pypi.org must be reachable), download
   every PyPI dependency as a wheel targeting the CONTAINER's platform
   (Linux/manylinux/cp312/x86_64), not the host's:
   ```bash
   pip download \
     --only-binary=:all: \
     --python-version 312 --implementation cp --abi cp312 \
     --platform manylinux_2_17_x86_64 --platform manylinux2014_x86_64 \
     --platform manylinux_2_24_x86_64 --platform manylinux_2_28_x86_64 \
     -d docker-wheels \
     -r <(grep -v '^winner-net' requirements.txt) \
     numpy scipy joblib statsmodels \
     "setuptools>=68" wheel
   ```
   If you're running this from a Windows Python (not Linux/WSL), also
   download `mcp` separately with `--no-deps` and add its real runtime deps
   by name instead of letting the bulk command resolve them: `mcp` has a
   `pywin32; sys_platform == "win32" and python_version >= "3.14"` marker,
   and pip evaluates environment markers using the *running* interpreter, not
   the `--platform`/`--python-version` target flags (those only affect wheel
   TAG selection) — so from a Windows host, bulk-resolving `mcp` normally
   pulls in a Windows-only `pywin32` requirement that has no Linux wheel and
   makes the whole command fail. Only `mcp` has this problem in this
   dependency set (checked its full `Requires-Dist` list — it's the only
   `sys_platform`-conditional entry anywhere in the tree); everything else
   resolves fine from Windows.
   ```bash
   pip download --no-deps --only-binary=:all: --python-version 312 \
     --implementation cp --abi cp312 \
     --platform manylinux_2_17_x86_64 --platform manylinux2014_x86_64 \
     --platform manylinux_2_24_x86_64 --platform manylinux_2_28_x86_64 \
     -d docker-wheels mcp==1.28.1
   pip download --only-binary=:all: --python-version 312 \
     --implementation cp --abi cp312 \
     --platform manylinux_2_17_x86_64 --platform manylinux2014_x86_64 \
     --platform manylinux_2_24_x86_64 --platform manylinux_2_28_x86_64 \
     -d docker-wheels \
     "anyio>=4.5" "httpx-sse>=0.4" "jsonschema>=4.20.0" "pydantic-settings>=2.5.2" \
     "pyjwt[crypto]>=2.10.1" "python-multipart>=0.0.9" "sse-starlette>=1.6.1" \
     "typing-extensions>=4.9.0" "typing-inspection>=0.4.1"
   ```
2. Confirm every file in `docker-wheels/` ends in `.whl` (no `.zip`/`.tar.gz`
   sdists) — that means every dependency resolved as a prebuilt wheel and
   nothing needs a compiler in the container. `winner-net` itself is the one
   deliberate exception: it's pure Python with no wheel on PyPI at all
   (it's not on PyPI — it's git-only), so it's never in this directory; the
   Dockerfile clones and installs it separately.
3. `docker build --target builder -t explore-mcp:builder-bootstrap .`, then
   `docker run --rm explore-mcp:builder-bootstrap /opt/venv/bin/pip freeze`
   and copy the output into `requirements.lock.txt` — except the `winner-net`
   line, which `pip freeze` prints as a throwaway build-time local path
   (`winner-net @ file:///tmp/winner/python`); replace it by hand with the
   git+commit form already in `requirements.txt`. See
   `requirements.lock.txt`'s own header comment for the exact steps.
4. `docker rmi explore-mcp:builder-bootstrap` (throwaway), then
   `docker build -t explore-mcp .` for the real image, which installs from
   `requirements.lock.txt` (full transitive pins) rather than
   `requirements.txt` (direct deps only) — that's what makes the build
   reproducible down to indirect dependencies like `numpy`/`scipy`.

`requirements.txt` stays the human-readable source of intent (direct
dependencies only); `requirements.lock.txt` is the generated, fully-pinned
set the image actually installs from; `docker-wheels/` is the offline input
that makes installing either possible without pypi.org.
