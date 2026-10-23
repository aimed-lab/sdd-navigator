// lib/server/promote/followTopic.ts — "Follow the topic" for a Promote article:
// the best matching public wiki page and the best matching community, using
// the pure matchers in topicMatch.ts. Both are optional: nothing found means the
// box is hidden (the article page always shows the community the author attached
// to the item, whatever this returns).
//
// Every lookup logs what it searched and what it got, so an empty box can be
// explained from the server log: "promote follow-topic".

import { getAnonServerClient } from "@/lib/server/supabaseServer";
import { listCommunities } from "@/lib/server/communities";
import { bestCommunity, bestTopicPage, topicWords } from "@/lib/server/promote/topicMatch";

export type FollowTopic = {
  page: { slug: string; title: string } | null;
  community: { slug: string; name: string } | null;
};

export async function findFollowTopic(
  headline: string,
  tags: string[],
  standfirst: string,
  slug = ""
): Promise<FollowTopic> {
  const text = [headline, ...tags, standfirst].join(" ");
  const result: FollowTopic = { page: null, community: null };
  const log: Record<string, unknown> = { slug, words: topicWords(text) };

  try {
    const anon = getAnonServerClient();
    if (!anon) {
      log.pagesError = "no anon client";
    } else {
      // Every public page (a small table), scored in code: narrowing the query
      // to the item's longest words used to drop short terms such as "PHGDH".
      const { data, error } = await anon
        .from("pages")
        .select("slug, title, seed_input")
        .eq("visibility", "public")
        .limit(500);
      if (error) log.pagesError = error.message;
      const pages = ((data ?? []) as { slug: string; title: string; seed_input: string | null }[]).map((p) => ({
        slug: p.slug,
        title: p.title,
        seed: p.seed_input,
      }));
      log.pagesFetched = pages.length;
      const match = bestTopicPage(text, pages);
      if (match) result.page = { slug: match.slug, title: match.title };
      log.page = match?.slug ?? null;
    }
  } catch (e) {
    log.pagesError = e instanceof Error ? e.message : String(e);
  }

  try {
    const communities = await listCommunities();
    log.communitiesFetched = communities.length;
    const choice = bestCommunity([headline, ...tags].join(" "), communities);
    if (choice) result.community = { slug: choice.community.slug, name: choice.community.name };
    log.community = choice ? { slug: choice.community.slug, score: choice.score, matched: choice.matched } : null;
  } catch (e) {
    log.communitiesError = e instanceof Error ? e.message : String(e);
  }

  console.info("promote follow-topic", JSON.stringify(log));
  return result;
}
