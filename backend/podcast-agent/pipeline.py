"""
pipeline.py
───────────
Main entry point for the SDD Navigator knowledge extraction pipeline.

Usage:
    python pipeline.py                # process latest unprocessed episode
    python pipeline.py --episode N    # process a specific episode number
    python pipeline.py --all          # process every unprocessed episode
    python pipeline.py --retry-failed # retry all previously failed episodes

Flow (per episode):
    transcribe → extract → validate → save to Supabase → graph_agent

State:
    backend/output/progress.json tracks {processed, failed, remaining}
    so the pipeline can resume safely after interruption.

Raw requests only — no supabase-py (incompatible with Python 3.14).
"""

import argparse
import json
import os

from dotenv import load_dotenv

# ── Load .env before local imports ────────────────────────────────────────────
_ENV_PATH = os.path.join(os.path.dirname(__file__), "..", ".env")
load_dotenv(_ENV_PATH)

from transcribe import (         # noqa: E402
    get_processed_numbers,
    parse_rss,
    load_whisper_model,
    transcribe_episode,
)
from extract    import extract_knowledge   # noqa: E402
from validator  import validate_episode    # noqa: E402
from graph_agent import run_graph_agent    # noqa: E402
from supabase_client import sb_post        # noqa: E402


# ── Paths ──────────────────────────────────────────────────────────────────────

RSS_URL    = os.environ.get("RSS_URL", "https://anchor.fm/s/103fb6090/podcast/rss")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "output")
PROGRESS_F = os.path.join(OUTPUT_DIR, "progress.json")


# ── Progress tracking ──────────────────────────────────────────────────────────

def _load_progress() -> dict:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    if os.path.isfile(PROGRESS_F):
        try:
            with open(PROGRESS_F, encoding="utf-8") as f:
                data = json.load(f)
            # Ensure all keys exist (backwards-compat with older files)
            data.setdefault("processed", [])
            data.setdefault("failed",    [])
            data.setdefault("remaining", [])
            return data
        except Exception:
            pass
    return {"processed": [], "failed": [], "remaining": []}


def _save_progress(prog: dict) -> None:
    with open(PROGRESS_F, "w", encoding="utf-8") as f:
        json.dump(prog, f, indent=2)


def _mark_processed(prog: dict, ep_num: int) -> None:
    if ep_num not in prog["processed"]:
        prog["processed"].append(ep_num)
    prog["failed"]    = [n for n in prog["failed"]    if n != ep_num]
    prog["remaining"] = [n for n in prog["remaining"] if n != ep_num]
    _save_progress(prog)


def _mark_failed(prog: dict, ep_num: int) -> None:
    if ep_num not in prog["failed"]:
        prog["failed"].append(ep_num)
    prog["remaining"] = [n for n in prog["remaining"] if n != ep_num]
    _save_progress(prog)


# ── Supabase save helpers ──────────────────────────────────────────────────────

def _save_wiki_page(metadata: dict, transcript: str, extracted: dict, image_url: str = "") -> str:
    """Insert one episode into wiki_pages. Returns the new UUID."""
    ep_num = metadata["episode_number"]
    slug   = extracted.get("slug") or f"episode-{ep_num}"

    concepts_jsonb = [
        c for c in extracted.get("concepts", [])
        if isinstance(c, dict) and c.get("title")
    ]

    row = {
        "slug":           slug,
        "title":          extracted.get("title") or metadata.get("title", f"Episode {ep_num}"),
        "episode_number": ep_num,
        "transcript":     transcript,
        "episode_url":    metadata.get("episode_url", ""),
        "description":    extracted.get("description") or metadata.get("description", ""),
        "summary":        extracted.get("summary", []),
        "concepts":       concepts_jsonb,
        "tags":           extracted.get("tags", []),
        # entities stored as JSONB for graph_agent to read later.
        # Run this SQL once in Supabase if the column is missing:
        #   ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS entities JSONB DEFAULT '{}';
        "entities":       extracted.get("entities", {}),
        "image_url":      image_url or metadata.get("image_url", ""),
    }

    result = sb_post("wiki_pages", row)
    if not result:
        raise RuntimeError("wiki_pages insert returned no data")
    return result[0]["id"]


# ── Per-episode orchestration ──────────────────────────────────────────────────

def _process_one(episode: dict, prog: dict, whisper_model) -> bool:
    """
    Full pipeline for a single episode.
    Returns True on success, False on any non-recoverable error.
    On failure the episode is marked as failed in progress.json.
    """
    ep_num = episode["episode_number"]
    title  = episode["title"]

    print()
    print(f"{'─' * 62}")
    print(f"  🎯 Episode {ep_num}: {title}")
    print(f"{'─' * 62}")

    # ── Step 1: Transcribe ────────────────────────────────────────────────
    print(f"\n  📡 STEP 1 / 4 — Transcribe")
    try:
        json_path = transcribe_episode(episode, OUTPUT_DIR, whisper_model)
        with open(json_path, encoding="utf-8") as f:
            raw_data   = json.load(f)
        metadata   = raw_data["metadata"]
        transcript = raw_data["transcript"]
        print(f"   ✅ Transcript ready ({len(transcript.split()):,} words)")
    except Exception as exc:
        print(f"   ❌ Transcription failed: {exc}")
        _mark_failed(prog, ep_num)
        return False

    # ── Step 2: Extract ───────────────────────────────────────────────────
    print(f"\n  🤖 STEP 2 / 4 — Extract Knowledge")
    try:
        extracted = extract_knowledge(transcript, metadata)
    except Exception as exc:
        print(f"   ❌ Extraction failed: {exc}")
        _mark_failed(prog, ep_num)
        return False

    # ── Step 3: Validate ──────────────────────────────────────────────────
    print(f"\n  🔍 STEP 3 / 4 — Validate")
    validate_episode(extracted, transcript)   # logs PASS/FAIL, never blocks

    # ── Step 4: Save to Supabase ──────────────────────────────────────────
    print(f"\n  💾 STEP 4 / 4 — Save to Supabase")
    try:
        wiki_id = _save_wiki_page(metadata, transcript, extracted, image_url=episode.get("image_url", ""))
        print(f"   ✅ wiki_page saved  id={wiki_id}  slug={extracted.get('slug')}")
    except Exception as exc:
        print(f"   ❌ Supabase save failed: {exc}")
        _mark_failed(prog, ep_num)
        return False

    _mark_processed(prog, ep_num)
    print(f"\n  🎉 Episode {ep_num} complete!\n")
    return True


# ── Pipeline entry point ───────────────────────────────────────────────────────

def run_pipeline(
    mode: str = "latest",
    episode_num: int | None = None,
) -> None:
    print()
    print("═" * 70)
    print("  🚀  SDD Navigator — Knowledge Extraction Pipeline")
    print("═" * 70)
    print(f"  🎯  Mode      : {mode}")
    print(f"  🔌  Supabase  : {os.environ.get('SUPABASE_URL', '(not set)')}")
    print(f"  📡  RSS       : {RSS_URL}")
    print(f"  📁  Output    : {os.path.abspath(OUTPUT_DIR)}")
    print()

    prog = _load_progress()

    # ── Parse RSS ─────────────────────────────────────────────────────────
    try:
        all_episodes = parse_rss(RSS_URL)
    except Exception as exc:
        print(f"❌ RSS parse failed: {exc}")
        return
    if not all_episodes:
        print("❌ No episodes found in RSS feed.")
        return

    ep_by_num = {ep["episode_number"]: ep for ep in all_episodes}

    # ── Check Supabase for already-processed episodes ─────────────────────
    print("🔍 Checking Supabase for processed episodes…")
    in_db = get_processed_numbers(
        os.environ.get("SUPABASE_URL", ""),
        os.environ.get("SUPABASE_KEY", ""),
    )
    print(f"   {len(in_db)} episode(s) already in DB: {sorted(in_db) or 'none'}")

    # Sync progress with DB truth
    for n in in_db:
        if n not in prog["processed"]:
            prog["processed"].append(n)
    _save_progress(prog)

    # ── Determine targets ─────────────────────────────────────────────────
    targets: list[dict] = []

    if mode == "retry-failed":
        failed_nums = [n for n in prog["failed"] if n in ep_by_num]
        targets = [ep_by_num[n] for n in failed_nums]
        if not targets:
            print("\n✅ No failed episodes to retry.")
        else:
            print(f"\n🔄 Retrying {len(targets)} failed episode(s): "
                  f"{[ep['episode_number'] for ep in targets]}")

    elif mode == "episode" and episode_num is not None:
        if episode_num in ep_by_num:
            targets = [ep_by_num[episode_num]]
            print(f"\n▶  Processing episode {episode_num}.")
        else:
            print(f"\n❌ Episode {episode_num} not found in RSS feed.")
            return

    elif mode == "all":
        targets = [ep for ep in all_episodes if ep["episode_number"] not in in_db]
        print(f"\n📋 {len(targets)} episode(s) not yet in Supabase.")

    else:  # latest
        unprocessed = [ep for ep in all_episodes if ep["episode_number"] not in in_db]
        if unprocessed:
            targets = [max(unprocessed, key=lambda e: e["episode_number"])]
            print(f"\n▶  Latest unprocessed: episode {targets[0]['episode_number']}.")
        else:
            print("\n✅ All episodes already in Supabase — nothing to do.")

    if not targets:
        print("\n🏁 Nothing to process.")
        _finalize(prog)
        return

    # Update remaining list
    prog["remaining"] = [ep["episode_number"] for ep in targets]
    _save_progress(prog)

    # ── Load Whisper once for all targets ─────────────────────────────────
    try:
        whisper_model = load_whisper_model()
    except Exception as exc:
        print(f"❌ Whisper failed to load: {exc}")
        return

    # ── Process each target ───────────────────────────────────────────────
    success = 0
    for ep in targets:
        ok = _process_one(ep, prog, whisper_model)
        if ok:
            success += 1

    print(f"\n{'═' * 70}")
    print(f"  ✅ Processed {success} / {len(targets)} episode(s) successfully.")
    print(f"{'═' * 70}\n")

    # ── Rebuild knowledge graph ───────────────────────────────────────────
    if success > 0:
        print(f"{'─' * 70}")
        print("  🕸️  GRAPH STEP — Rebuild Knowledge Graph")
        print(f"{'─' * 70}")
        try:
            run_graph_agent()
        except Exception as exc:
            print(f"  ⚠️  Graph agent failed (non-fatal): {exc}\n")

    _finalize(prog)


def _finalize(prog: dict) -> None:
    print("\n🏁 Pipeline complete.")
    print(f"   Processed : {sorted(prog['processed'])}")
    print(f"   Failed    : {sorted(prog['failed'])}")
    print(f"   Remaining : {sorted(prog['remaining'])}")
    print()


# ── CLI ────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="SDD Navigator — Podcast → Knowledge Graph Pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python pipeline.py                # latest unprocessed episode
  python pipeline.py --episode 42  # specific episode
  python pipeline.py --all         # all unprocessed episodes
  python pipeline.py --retry-failed
        """,
    )

    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--episode", type=int, metavar="N",
        help="Process a specific episode number",
    )
    group.add_argument(
        "--all", action="store_true",
        help="Process every episode not yet in Supabase",
    )
    group.add_argument(
        "--retry-failed", action="store_true",
        help="Retry all previously failed episodes",
    )

    args = parser.parse_args()

    if args.episode is not None:
        run_pipeline(mode="episode", episode_num=args.episode)
    elif args.all:
        run_pipeline(mode="all")
    elif args.retry_failed:
        run_pipeline(mode="retry-failed")
    else:
        run_pipeline(mode="latest")
