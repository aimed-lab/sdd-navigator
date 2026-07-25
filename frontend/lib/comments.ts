// lib/comments.ts — reads/writes the `comments` table from the browser client.
//
// RLS does the enforcement (see database/schema.sql):
//   • "Comments: public read" — anyone, signed in or not, can SELECT.
//   • "Comments: own insert"  — INSERT only with auth.uid() = user_id.
// So this module never needs a service-role key; the anon client plus the user's
// session is enough, and a spoofed user_id is rejected by the database itself.
//
// `comments` stores no author name/affiliation — those come from a join on
// `users` at query time (matching how the topic page's comments already work).

import { supabase } from "@/lib/supabase";

export type Comment = {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
  author_name: string | null;
  author_affiliation: string | null;
};

// Supabase returns the joined `users` relation as either an object or a
// single-element array depending on how it infers the relationship.
type JoinedUser = { name: string | null; affiliation: string | null };
type CommentRow = {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
  users: JoinedUser | JoinedUser[] | null;
};

function firstUser(users: CommentRow["users"]): JoinedUser | null {
  if (!users) return null;
  return Array.isArray(users) ? users[0] ?? null : users;
}

/** All comments on a wiki page, oldest first. Returns [] on any read error so a
 *  broken comments read never takes the episode page down. */
export async function listComments(wikiId: string): Promise<Comment[]> {
  const { data, error } = await supabase
    .from("comments")
    .select("id, content, created_at, user_id, users(name, affiliation)")
    .eq("wiki_id", wikiId)
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  return (data as unknown as CommentRow[]).map((row) => {
    const author = firstUser(row.users);
    return {
      id: row.id,
      content: row.content,
      created_at: row.created_at,
      user_id: row.user_id,
      author_name: author?.name ?? null,
      author_affiliation: author?.affiliation ?? null,
    };
  });
}

/** Post a comment as the signed-in user. `userId` must be the caller's own
 *  auth.uid() — RLS rejects anything else. Returns an error string, or null. */
export async function postComment(
  wikiId: string,
  userId: string,
  content: string
): Promise<string | null> {
  const body = content.trim();
  if (!body) return "Comment can't be empty.";

  const { error } = await supabase
    .from("comments")
    .insert({ wiki_id: wikiId, user_id: userId, content: body });

  return error ? error.message : null;
}
