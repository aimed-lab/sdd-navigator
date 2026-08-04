# syntax=docker/dockerfile:1

# ── Builder ──────────────────────────────────────────────────────────────────
# Python 3.12 on slim Debian — NOT 3.14 (the local dev venv's version). 3.12 is
# the safer target for numpy/scipy/pandas wheels pulled in transitively by
# winner-net. git + build tooling live ONLY in this stage — the final image
# ships neither.
FROM python:3.12-slim-bookworm AS builder

# PIP_SOURCE=online (DEFAULT) — installs every PyPI dependency the normal
# way, straight from pypi.org. This is what a plain `docker build .` gets
# for anyone who just cloned the repo (Zhandos's server, CI, a fresh
# machine) — no wheelhouse required, nothing gitignored to regenerate first.
#
# PIP_SOURCE=offline (--build-arg PIP_SOURCE=offline) — installs from the
# local ./docker-wheels wheelhouse instead. This exists ONLY because
# pypi.org is specifically unreachable from inside any container on ONE
# machine's Docker network (confirmed there: DNS resolves identically to
# the host, --dns 8.8.8.8 makes no difference, files.pythonhosted.org/
# github.com/every other tested domain IS reachable — pypi.org specifically
# is not, likely a deliberate network policy rather than a flaky
# connection). Nobody else building this image should need it. See
# README.md's "Docker build" section for how to regenerate docker-wheels/
# before using this path — it's gitignored (a tracked docker-wheels/
# .gitkeep keeps the directory itself present so the unconditional COPY
# below never fails on a fresh clone; PIP_SOURCE=online never reads from it).
#
# Either way, github.com IS reachable everywhere this has been tested, so
# winner-net (a git-only dependency, no PyPI release) always installs from
# GitHub regardless of PIP_SOURCE.
ARG PIP_SOURCE=online

# git only — winner-net installs from GitHub (aimed-lab/WINNER, public,
# pinned to a commit). No compilers needed: every PyPI dependency is a
# genuine prebuilt wheel either way (verified for the offline wheelhouse
# when it was generated — see README), and winner-net itself is pure Python
# (no C extension; its pyproject.toml build-system is plain
# setuptools.build_meta).
RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /build

# The local wheelhouse — every PyPI package this image needs when
# PIP_SOURCE=offline, as a wheel matching cp312/manylinux/x86_64. COPYing it
# unconditionally (even though PIP_SOURCE=online never reads it) is what
# lets `docker-wheels/` be empty-but-present on a fresh clone without
# breaking the build — see the .gitkeep note above.
COPY docker-wheels /wheels
COPY requirements.lock.txt .

# setuptools + wheel FIRST, and as an explicit step: winner-net's build
# (below) uses --no-build-isolation, which means "use whatever's already
# installed" rather than fetching its own build-system requires into an
# isolated env — so setuptools/wheel must be genuinely installed before that
# step runs, from PyPI or from /wheels depending on PIP_SOURCE.
RUN if [ "$PIP_SOURCE" = "offline" ]; then \
        pip install --no-index --find-links=/wheels "setuptools>=68" wheel; \
    else \
        pip install "setuptools>=68" wheel; \
    fi

# winner-net, from git (github.com is reachable), installed from a LOCAL
# clone rather than `pip install git+https://...` directly. Chosen over the
# git URL form for one reason: pip's build-isolation inheritance of
# --no-index/--find-links into its OWN isolated env is version-dependent and
# not something to rely on implicitly for a package with no test coverage
# once it's inside a container. `--no-build-isolation` on a literal local
# path is unambiguous — pip does no isolation at all, uses exactly the venv
# we just populated (setuptools/wheel) regardless of PIP_SOURCE, and needs
# no network beyond the git clone itself. Its own runtime deps (numpy/scipy/
# pandas/statsmodels/joblib) resolve from /wheels (offline) or pypi.org
# (online, the default) via the same --no-build-isolation install below.
RUN git clone --quiet https://github.com/aimed-lab/WINNER.git /tmp/winner \
    && git -C /tmp/winner checkout -q 8365f7192e190c378199adf3ec7a49caf66bd37c \
    && if [ "$PIP_SOURCE" = "offline" ]; then \
           pip install --no-build-isolation --no-index --find-links=/wheels /tmp/winner/python; \
       else \
           pip install --no-build-isolation /tmp/winner/python; \
       fi \
    && rm -rf /tmp/winner

# Everything else — the FULL fully-resolved set (requirements.lock.txt, see
# that file's own header for how it was generated), filtered to drop the
# winner-net line: it's already installed above, from a local git clone with
# --no-build-isolation. Re-processing that same line here through a plain
# `-r` install would either no-op or risk pip attempting a second, redundant
# build of it, so it's excluded rather than relied on to skip cleanly.
# Installing from the LOCK (not requirements.txt) here, not just for
# winner-net's own transitive deps but for every package, is what makes this
# build fully reproducible — exact versions of indirect dependencies too,
# not just the ones requirements.txt names directly — in EITHER mode.
RUN grep -v '^winner-net' requirements.lock.txt > /tmp/requirements-pypi.txt \
    && if [ "$PIP_SOURCE" = "offline" ]; then \
           pip install --no-index --find-links=/wheels -r /tmp/requirements-pypi.txt; \
       else \
           pip install -r /tmp/requirements-pypi.txt; \
       fi \
    && rm /tmp/requirements-pypi.txt

# ── Final ────────────────────────────────────────────────────────────────────
FROM python:3.12-slim-bookworm AS final

ENV PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    MCP_HOST=0.0.0.0 \
    MCP_PORT=8000

COPY --from=builder /opt/venv /opt/venv

RUN groupadd --gid 1000 app && useradd --uid 1000 --gid app --no-create-home app

WORKDIR /app

# Explicit file/dir list, NOT `COPY . .`. docker-wheels/ (the build-only
# wheelhouse — tens/hundreds of MB) is NOT in .dockerignore, because the
# BUILDER stage still needs it in the build context. `COPY . .` here would
# therefore pull it into this stage too — and unlike the builder stage
# (whose layers are discarded entirely once the final stage stops COPYing
# FROM it), a later `RUN rm -rf` in THIS SAME stage cannot reclaim that
# space: Docker layers are additive, so the deleted files stay present (just
# hidden) in the COPY layer underneath. Naming exactly the runtime files/dirs
# below means docker-wheels/ (and tests/, README.md, requirements*.txt,
# .env*, Dockerfile itself, etc.) never enter this stage's filesystem at all.
COPY --chown=app:app cache.py dedupe.py llm.py models.py prewarm.py ranking.py response.py server.py supabase_client.py ./
COPY --chown=app:app sources/ ./sources/
COPY --chown=app:app tools/ ./tools/

USER app

EXPOSE 8000

# Liveness only. /health has zero dependencies and is always 200 the instant
# the process is up. /ready is deliberately NOT used here — it's 503 during
# the landing-feed prewarm, and Docker's HEALTHCHECK has no separate
# "readiness" concept, so pointing it at /ready would flag every normal cold
# start as unhealthy. An orchestrator with a real readiness probe should
# point THAT at /ready; this HEALTHCHECK is liveness only.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,os,sys; sys.exit(0 if urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"MCP_PORT\",\"8000\")}/health', timeout=2).status == 200 else 1)"

# Single worker, unconditionally. cache.py's single-flight coalescing and
# InProcessCache are per-PROCESS (asyncio.Lock + a plain dict — see cache.py's
# "REDIS SWAP POINT" note). A second uvicorn worker is a second OS process
# with its OWN cache and OWN locks: it wouldn't share state with the first,
# so every unique query would silently get computed — and hit upstream —
# twice, once per worker, with no error, just quietly doubled upstream call
# volume. server.py's own _serve() already runs a single embedded
# uvicorn.Server with no `workers=` argument; this CMD doesn't override that.
# Scale this service with more CONTAINERS behind a load balancer, not more
# workers inside one, until a shared (Redis) cache backend replaces
# InProcessCache.
CMD ["python", "server.py"]
