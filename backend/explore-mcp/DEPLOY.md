# Deploying explore-mcp

This is written for someone standing this service up for the first time,
with no prior context on this project. If something here is unclear or
wrong, that's a bug in this document — fix it or ask.

**Questions or something looks wrong:** ask Karthik (this repo's
maintainer — GitHub: `Karthikeya2302`) or open an issue on the repo
(https://github.com/aimed-lab/sdd-navigator).

## 1. What this is

`explore-mcp` is the search backend behind smartdrugdiscovery.org — it's
what runs when someone types a gene, disease, or topic into the site's
Explore page. The frontend is a Next.js app hosted on Vercel; it calls this
service over HTTPS for every search. There is no browser-facing UI here —
this is a backend HTTP service only.

## 2. Reachability comes first — read this before anything else

**This service must be reachable over HTTPS from the public internet.**
The frontend runs on Vercel, which is outside UAB's network entirely. A
deployment that's only reachable from inside UAB (campus network, VPN-only,
firewalled to on-campus IPs) will not work — every search on the live site
will fail, and it can be non-obvious why, because the container itself will
look perfectly healthy the whole time. This is the single most likely thing
to go wrong in a first deployment. Confirm public HTTPS reachability before
moving on to anything else in this document.

One detail that trips people up: **the container itself only speaks plain
HTTP** on its own port (see §10, "Verifying it's working") — it does not
terminate TLS. Something in front of it (a reverse proxy, load balancer, or
ingress — whatever UAB normally uses for public-facing services) has to
provide the HTTPS endpoint and forward to this container's HTTP port. This
document doesn't prescribe which — use whatever's standard at UAB — but
that piece has to exist and has to be internet-facing, not just
campus-facing.

Also: **don't firewall this endpoint to a single source IP or IP range**
(e.g. "just allow Vercel's IPs"). Vercel is the main caller, but it is not
the only one — other internal tools and agents at the lab call this same
service directly too, over the same HTTP API. It needs to be generally
reachable, not allowlisted to one specific caller.

**Verify the container locally before spending any time on DNS, TLS, or a
proxy.** Once it's running (§4 below), from the *same host* running the
container:

```bash
curl http://localhost:8000/health
```

Expect immediately:

```json
{"service":"explore-mcp","status":"ok","transport":"streamable-http"}
```

If that doesn't work, nothing downstream — DNS, TLS, the proxy — will
either, so this is the cheapest possible first check. Only once it passes
locally is it worth investing time in making the HTTPS-facing piece
described above actually reachable from the public internet (and then
re-verifying externally, per §10).

## 3. Host requirements

- Linux with Docker installed.
- 2 vCPU, 2 GB RAM, 5 GB disk. That's comfortable, not a hard minimum —
  this is a lightweight Python HTTP service, not a compute-heavy job.
- **Stateless — no persistent volume needed.** Nothing this service writes
  needs to survive a restart. All state (an in-memory search-result cache)
  is disposable and rebuilds itself from live upstream sources.
- Outbound internet access (see §7) and, per §2, inbound HTTPS reachability
  from the public internet.

## 4. PRIMARY: run the prebuilt image

This is the tested path — the exact image referenced below has been built,
run, and verified end to end (health checks, a real search, TLS to every
upstream, log output, graceful shutdown). Prefer this over building from
source. You do **not** need to clone the repo for this path — everything
below is self-contained.

```bash
# 1. Log in to ghcr.io. Use --password-stdin — the interactive password
#    prompt does not work with a GitHub token. <your-github-username> is
#    YOUR GitHub username; the token needs the read:packages scope.
echo "<your-github-token>" | docker login ghcr.io -u <your-github-username> --password-stdin

# 2. Pull the exact verified image, by digest (not just the ":latest" tag,
#    which can move — the digest can't).
docker pull ghcr.io/aimed-lab/explore-mcp@sha256:5acf4b3cae4c89911033f81233e09d9eac53457a11ead66f2bac95028e3ae9eb

# 3. Create your env file — every variable this service reads, with empty
#    values. See the "Environment variables" table at the end of this
#    document for what each one does and which are required; fill those in
#    below before running the container.
cat > .env <<'EOF'
GROQ_API_KEY=
SUPABASE_URL=
SUPABASE_KEY=
LLM_PROVIDER=
LLM_MODEL=
LLM_API_KEY=
NCBI_API_KEY=
OPENALEX_API_KEY=
GITHUB_TOKEN=
PREWARM_ENABLED=
PREWARM_INTERVAL_SEC=
PREWARM_TIMEOUT_SEC=
MCP_HOST=
MCP_PORT=
LOG_LEVEL=
EOF
# ... now edit .env and fill in real values ...

# 4. Run it.
docker run -d \
  --name explore-mcp \
  --restart unless-stopped \
  --memory=2g \
  -p 8000:8000 \
  --env-file .env \
  ghcr.io/aimed-lab/explore-mcp@sha256:5acf4b3cae4c89911033f81233e09d9eac53457a11ead66f2bac95028e3ae9eb
```

`--memory=2g` matters: this service's cache has no eviction (see §8) —
bounding the container's memory means a pathological cache growth is a
contained, restartable failure instead of something that can take down the
whole host.

That's it — no volumes, no separate database, no init step. Point your
reverse proxy / load balancer (§2) at port 8000 on this container and you're
running.

## 5. Updating to a new version

```bash
# 1. Pull the new image, by its new digest (get this from whoever verified
#    the new build — see the contact line at the top of this document).
docker pull ghcr.io/aimed-lab/explore-mcp@sha256:<new-digest>

# 2. Stop and remove the old container.
docker stop explore-mcp
docker rm explore-mcp

# 3. Run the new one — same command as §4, step 4, with the new digest.
docker run -d \
  --name explore-mcp \
  --restart unless-stopped \
  --memory=2g \
  -p 8000:8000 \
  --env-file .env \
  ghcr.io/aimed-lab/explore-mcp@sha256:<new-digest>
```

**Get a new digest each time — don't just re-pull `:latest` and assume it's
fine.** `:latest` is a moving tag; the whole point of pinning by digest
throughout this document is that the digest you're running is the exact
one that was actually verified end to end (§4). Re-pulling `:latest` blind
means running whatever happens to be newest, untested by you. Ask whoever
built the new image for its digest, the same way you got the one in §4.

## 6. FALLBACK: build from source

Only do this if you specifically need to build (e.g. you're changing code).
Otherwise use §4.

```bash
git clone https://github.com/aimed-lab/sdd-navigator.git
cd sdd-navigator/backend/explore-mcp
docker build -t explore-mcp .
```

This installs everything from pypi.org normally — that's the default.

**One flag you should know about but probably won't need:**
`docker build --build-arg PIP_SOURCE=offline -t explore-mcp .` switches to
installing from a local pre-downloaded wheel cache instead of pypi.org. This
exists because of a network restriction on one specific development
machine (pypi.org itself was blocked there, nothing else was) — it should
not be relevant to your deployment. Leave `PIP_SOURCE` unset.

**Important caveat on this fallback path**: the normal (`PIP_SOURCE=online`,
default) build has been checked for logical correctness — every command in
the Dockerfile was run successfully against a real package index — but it
has never actually been run against pypi.org itself, because pypi.org
happens to be unreachable from the machine this was developed on. If your
first build from source fails, **report it rather than trying to work
around it** — don't add flags or change the Dockerfile to make an error go
away; the failure itself is useful information. The prebuilt image in §4
has no such caveat — it's the one that's actually been fully verified.

## 7. Outbound network access this service needs

The container makes outbound HTTPS calls to these hosts. All must be
reachable from wherever the container runs:

- `eutils.ncbi.nlm.nih.gov` — PubMed and GEO (gene-expression datasets)
- `api.openalex.org` — paper search
- `api.crossref.org` — paper search
- `api.github.com` — open-source tool search
- `clinicaltrials.gov` — clinical trial search
- `api.grants.gov` — funding/grant search
- `api.groq.com` — the LLM calls that power query understanding
- `discovery.informatics.uab.edu` — PAGER (gene sets / pathways)
- your Supabase project's host (from `SUPABASE_URL`)

**If searches return empty results with no errors, the first thing to check
is whether one of these hosts is blocked.** This service is built to
degrade gracefully — one upstream failing never crashes a request, it just
quietly produces fewer results for that one category — which is exactly
why a blocked host doesn't look like a loud failure. It looks like
"search works, but this one section is always empty." See §11
(Troubleshooting) for how to find out *which* host, directly from the logs,
rather than testing each one by hand.

## 8. Running instance shape: one container, one process, no replicas

Run exactly **one** instance of this container, and do not scale it
horizontally (no multiple replicas behind a load balancer, no
auto-scaling group). The container itself also always runs a single
worker process internally — this isn't configurable and shouldn't be
changed.

Why: this service caches upstream results and coalesces duplicate
in-flight requests (so if two people search "PHGDH" at the same moment,
the upstream APIs only get hit once) — but that cache and that
coalescing live in the process's own memory, not in a shared store. A
second replica is a second process with its own separate, empty cache. Run
two replicas and every unique search silently gets computed — and sent to
every upstream API — twice, with no error and no obvious symptom, just
quietly doubled outbound API traffic against services (like NCBI, GitHub,
PAGER) that already rate-limit. If this service ever needs to scale beyond
one instance, the cache needs to move to something shared (Redis or
similar) first — that's a real code change, not a deployment setting.

## 9. Health checks

Two different endpoints, two different meanings — point the right kind of
probe at each:

- **`/health` — liveness.** "Is the process up." Always returns `200`
  within milliseconds of the process starting; has no dependency on
  anything else being ready. **Point your liveness/restart probe at this
  one.**
- **`/ready` — readiness.** "Has the service finished its startup warm-up."
  Returns `503` for roughly the first second after the process starts
  (while it pre-fetches the default search results), then flips to `200`
  and stays there. If your platform has a separate readiness concept
  (traffic shouldn't route here until warm), point that at `/ready`.

**Do not point a liveness/restart probe at `/ready`.** Every normal cold
start is briefly `503` on `/ready` — a liveness probe checking that path
will see the container as unhealthy and restart it, which just restarts it
again into the same brief `503` window, forever. See §11 (Troubleshooting)
for what this looks like when it happens.

## 10. Verifying it's working

This checks the full public path — DNS, TLS, and the proxy in front of the
container, on top of the container itself. If you haven't already done the
local-only check in §2 (`curl http://localhost:8000/health` on the host),
do that first — it isolates the container from everything in front of it.

Once the container is running and (per §2) reachable over HTTPS:

```bash
curl -s https://<your-domain>/health
```

Expect exactly this, immediately:

```json
{"service":"explore-mcp","status":"ok","transport":"streamable-http"}
```

Then a real functional check — a search that should return actual results:

```bash
curl -s -X POST https://<your-domain>/api/explore \
  -H "Content-Type: application/json" \
  -d '{"input":"PHGDH"}'
```

A healthy response is a JSON object with a `"sections"` array, where at
least the `"paper"`-kind section has non-empty `"items"`. If you have the
optional keys in §6/§7 configured, you should also see non-empty
`"dataset"` and `"geneset"` sections. An empty `"sections"` array, or every
section's `"items"` empty, with no `"error"` field set anywhere — go to
§11 (Troubleshooting).

## 11. Troubleshooting

**Start here for anything unexpected: `docker logs explore-mcp`.**
This service logs every upstream failure — a rate limit or any non-2xx
response — with the exact host name, so the logs answer "which upstream is
blocked" directly, instead of you having to test each host in §7 by hand.
A blocked or rate-limited upstream shows up as a line like this:

```
2026-08-04 21:39:39,270 WARNING sources.base: upstream 429 (rate limited): https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi
2026-08-04 21:39:39,270 WARNING sources.base: upstream non-2xx (status=403): https://api.github.com/search/repositories
```

Whatever host name appears there is the one to check connectivity to —
that's the whole point of checking logs first instead of testing every
host in §7 individually.

**Search results are empty, but nothing looks like an error.**
One (or more) of the outbound hosts in §7 is blocked or unreachable. This
service isolates failures per-upstream on purpose, so a blocked host
produces quiet, empty results instead of a loud crash. Check
`docker logs explore-mcp` first (above) — it names the blocked host
directly.

**Container keeps restarting in a loop.**
Almost always: the liveness/restart probe is pointed at `/ready` instead
of `/health` (§9). `/ready` is briefly `503` on every normal startup —
if your restart policy treats that as a failed health check, it restarts
the container right back into the same brief window, repeatedly. Point
liveness at `/health`.

**Everything works — papers, datasets, trials, grants — except gene
sets/pathways from PAGER are always empty.**
This is very likely `discovery.informatics.uab.edu`'s TLS certificate
chain issue — see §12 below. This service ships a workaround for it, so
if it's still failing, either the workaround itself broke somehow, or
outbound access to `discovery.informatics.uab.edu` is blocked separately
from every other host in §7 (check that specifically — it's a different
host than the well-known public APIs, and some network policies allowlist
by destination).

**Building from source fails during the winner-net step (a `git clone`
from GitHub).**
The build host doesn't have outbound access to `github.com`. This is a
separate dependency to `pypi.org` — one of this project's ranking
components is only distributed via GitHub, not a package index, so the
build always needs GitHub reachability regardless of `PIP_SOURCE` (§6).

## 12. For UAB IT: a TLS issue on discovery.informatics.uab.edu

`discovery.informatics.uab.edu` (used for PAGER gene-set/pathway search)
sends an incomplete certificate chain in its TLS handshake — it presents
its own certificate but omits the intermediate certificate ("InCommon RSA
Server CA 2") that a standard TLS client needs to verify it. Any normal
HTTPS client (not just this service) doing real certificate verification
against this host will fail with an "unable to verify the first
certificate" style error.

This service ships a narrow, scoped workaround internally (it supplies the
missing intermediate certificate itself, for calls to this one host only)
so it isn't blocked by this — but the correct fix is on the server side:
add the missing intermediate certificate to the web server's certificate
chain file (e.g. Apache's `SSLCertificateChainFile`, or the equivalent for
whatever serves this host).

The missing certificate is publicly available here:
**http://crt.sectigo.com/InCommonRSAServerCA2.crt**

Once that's added to the server's chain, this service's internal
workaround becomes unnecessary (though it can safely stay in place either
way — it doesn't change behavior once the real fix lands).

---

## Environment variables

Every variable this service reads, by name. See `.env.example` for a
ready-to-fill template (also inlined directly in §4, step 3, so you don't
need to clone the repo just to get it). **No values are given here or
anywhere in this document** — get real values from whoever manages this
project's credentials, never invent or reuse a value from another project.

| Variable | Required? | What it's for |
|---|---|---|
| `GROQ_API_KEY` | **Required** | The LLM calls that power query understanding (turning a free-text search into a structured query, and deciding which search categories to run). Without it, most searches fail. |
| `SUPABASE_URL` | **Required** | Backing database for internal lab-resource, people, and wiki search. The process starts without it, but those three search categories fail when used. |
| `SUPABASE_KEY` | **Required** | Paired with `SUPABASE_URL` above (a service-role key). |
| `LLM_PROVIDER` | Optional | Which LLM provider to use. Defaults to `groq`. |
| `LLM_MODEL` | Optional | Which model to use for the chosen provider. Has a built-in default. |
| `LLM_API_KEY` | Optional | Overrides `GROQ_API_KEY` if you want a separate key just for LLM calls. Falls back to `GROQ_API_KEY` if unset. |
| `NCBI_API_KEY` | Optional | Raises the PubMed/GEO rate limit. Works fine without it, just slower under load. |
| `OPENALEX_API_KEY` | Strongly recommended | OpenAlex retired its unauthenticated "polite pool" on 2026-02-13; unset means the throttled common pool, and 429s under fan-out load are swallowed silently per-source. |
| `GITHUB_TOKEN` | Optional | Raises the GitHub search rate limit. A read-only, no-scopes token is enough. |
| `PREWARM_ENABLED` | Optional | Whether to pre-fetch the default landing-page results on startup. Defaults on. |
| `PREWARM_INTERVAL_SEC` | Optional | How often the pre-fetch refreshes. Has a built-in default. |
| `PREWARM_TIMEOUT_SEC` | Optional | Max time one pre-fetch attempt may run before being treated as failed. Has a built-in default. |
| `MCP_HOST` | Optional | Which network interface to bind to. Defaults to all interfaces — leave unset in a container. |
| `MCP_PORT` | Optional | Which port to listen on. Defaults to `8000`. |
| `LOG_LEVEL` | Optional | Log verbosity (`DEBUG`/`INFO`/`WARNING`/`ERROR`). Defaults to `INFO`. |
