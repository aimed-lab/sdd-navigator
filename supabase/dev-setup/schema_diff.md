# Schema diff: live vs dev

Comparing `supabase/dev-setup/live_schema.csv` (production) against
`supabase/dev-setup/dev_schema.csv` (new dev project built from
`01_schema.sql` + `02_storage.sql`).

## 1. Tables in live but missing from dev

None. All 29 tables in `live_schema.csv` are present in `dev_schema.csv`.

## 2. Tables in dev but not in live

- **`projects_v1`** — present in dev only. See section 4.

## 3. Column diff for tables in both

For every table below, the column **set** matches exactly between live and
dev. Differences are order-only except where noted.

| Table | Missing in dev | Extra in dev | Order difference |
|---|---|---|---|
| checklist_items | none | none | no |
| collab_posts | none | none | no |
| comments | none | none | yes (`user_id`/`wiki_id` swapped) |
| communities | none | none | no |
| community_announcements | none | none | no |
| community_feed_items | none | none | yes (`fetched_at` moved earlier) |
| community_members | none | none | no |
| community_resource_files | none | none | no |
| community_resources | none | none | no |
| connection_requests | none | none | no |
| edges | none | none | no |
| feedback | none | none | no |
| lab_resources | none | none | no |
| nodes | none | none | no |
| project_digests | none | none | no |
| project_evidence_items | none | none | no |
| project_members | none | none | no |
| project_proposals | none | none | no |
| projects | none | none | no |
| promote_captures | none | none | no |
| promote_showcase | none | none | yes (several columns reordered) |
| promote_showcase_media | none | none | no |
| providers | none | none | yes (several columns reordered) |
| researcher_works | none | none | no |
| saved_items | none | none | no |
| users | none | none | yes (several columns reordered) |
| wiki_note_evidence | none | none | no |
| wiki_notes | none | none | no |
| wiki_pages | none | none | yes (several columns reordered) |

No missing or extra columns anywhere. Column-order differences are cosmetic
(Postgres/PostgREST don't care about physical column order) — noted per the
task's instructions, not treated as errors.

## 4. `projects_v1`

- **Exists in dev**: yes, with columns `id, user_id, title, input_data,
  output_data, created_at, updated_at` — this is the *old* Navigator
  "saved proposal" shape from `database/schema.sql`'s original `projects`
  definition.
- **Does NOT exist in live** at all, under either name.
- **Not created by `01_schema.sql`**: grepped the file — it defines
  `public.projects` once, with the new team-workspace shape only, per its
  own header comment (lines 28-40) which explicitly calls the old
  input_data/output_data shape "retired/superseded." There is no
  `projects_v1` anywhere in `01_schema.sql` or `02_storage.sql`.
- **Code references**: grepped the entire repo (frontend, backend, scripts,
  database) for `projects_v1` — the only hit in the whole tree is
  `dev_schema.csv` itself. Nothing in `app/`, `lib/`, `components/`,
  `backend/explore-mcp/`, or `backend/podcast-agent/` reads or writes it.

**Conclusion**: `projects_v1` is dead, dev-only cruft, not something the
consolidated schema files produce. Its presence means whichever script/order
was actually run against the dev project created the old-shape `projects`
table first (likely `database/schema.sql` itself, run before
`01_schema.sql`), and it got renamed to `projects_v1` — manually or by
whatever tooling avoided a name collision — before or during the
`01_schema.sql` run. It carries no data risk (it's a throwaway dev project)
but it is evidence the dev project was **not** built purely by running
`01_schema.sql` + `02_storage.sql` against a truly empty project as intended.

## 5. Verdict

**Yes, dev is a faithful copy of live for local development**, with one
caveat:

- Every live table exists in dev with the identical column set. No columns
  are missing, and no unexpected extra columns exist on any shared table.
  Order differences are harmless.
- The only discrepancy (`projects_v1`) is not a defect in `01_schema.sql` —
  it's leftover from how the dev project was actually provisioned, not
  something the consolidated schema file would create on a genuinely empty
  project.

**No fixes needed in `01_schema.sql` itself.** The one recommended action is
operational, not a SQL-file change: drop `projects_v1` from the dev project
(`DROP TABLE IF EXISTS public.projects_v1;`) once confirmed unused, or note
it as expected cruft if it's being kept around intentionally as a reference.
If this dev project is ever rebuilt from scratch, run `01_schema.sql`
against a truly empty project (not one that has already had
`database/schema.sql` applied) to avoid recreating this artifact.
