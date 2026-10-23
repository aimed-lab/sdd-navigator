// lib/server/pages/pageInsert.ts — inserts the `pages` row for createLivingPage.
//
// WHY THE ID IS MADE HERE AND THE INSERT ASKS FOR NOTHING BACK
// `.insert(row).select(...)` sends INSERT ... RETURNING, and Postgres then also
// checks the new row against the table's SELECT policy. "Pages: read" is
// can_read_page(id, auth.uid()), a STABLE SECURITY DEFINER function that looks
// the page up in `pages`; a STABLE function sees the snapshot from the start of
// the statement, so it cannot see the row this very statement is inserting and
// says "no". The insert then fails with 'new row violates row-level security
// policy for table "pages"' even though "Pages: insert own" passed. That only
// shows with a session (RLS-enforcing) client, which is what a project page
// uses; the website's normal path uses the service-role client, which skips
// RLS, and never hit it.
//
// So the row gets its id (and slug) from code and is inserted with no
// RETURNING. No policy is loosened. Pure: the database client, the id maker and
// the slug maker are passed in, so `npm test` covers it.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type PageRowInput = {
  title: string;
  seed_input: string;
  owner_id: string | null;
  visibility: string;
  project_id?: string;
  parent_page_id?: string;
};

export type InsertPageResult =
  | { ok: true; id: string; slug: string }
  | { ok: false; error: string };

const UNIQUE_VIOLATION = "23505";

export async function insertPageRow(
  db: Db,
  input: PageRowInput,
  makeSlug: () => string,
  makeId: () => string = () => globalThis.crypto.randomUUID(),
  attempts = 3
): Promise<InsertPageResult> {
  const id = makeId();
  let lastError = "unknown error creating page";
  for (let attempt = 0; attempt < attempts; attempt++) {
    const slug = makeSlug();
    const { error } = await db.from("pages").insert({
      id,
      slug,
      title: input.title,
      seed_type: "topic",
      seed_input: input.seed_input,
      owner_id: input.owner_id,
      visibility: input.visibility,
      ...(input.project_id ? { project_id: input.project_id } : {}),
      ...(input.parent_page_id ? { parent_page_id: input.parent_page_id } : {}),
    });
    if (!error) return { ok: true, id, slug };
    lastError = (error as { message?: string }).message ?? lastError;
    // Two requests seeding the same topic at once can pick the same slug: retry.
    if ((error as { code?: string }).code !== UNIQUE_VIOLATION) break;
  }
  return { ok: false, error: lastError };
}
