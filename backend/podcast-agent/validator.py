"""
validator.py
────────────
Quality gate for extracted episode data.
Prints PASS / FAIL for each check and returns True only when all pass.

Exposes:
    validate_episode(extracted, transcript) -> bool
"""

import re


def validate_episode(extracted: dict, transcript: str) -> bool:
    """
    Run quality checks on extracted episode data.

    Args:
        extracted:  Dict returned by extract_knowledge().
        transcript: Raw transcript string (for word count).

    Returns:
        True if every check passes, False otherwise.
        Always prints a PASS/FAIL line per check — never raises.
    """
    print("   🔍 Validating extracted data…")

    results: list[tuple[str, bool, str]] = []

    # ── Check 1: Transcript word count ────────────────────────────────────
    words = len(transcript.split())
    results.append((
        "Transcript > 500 words",
        words >= 500,
        f"{words:,} words",
    ))

    # ── Check 2: Concepts array ≥ 3 items ─────────────────────────────────
    concepts = extracted.get("concepts", [])
    results.append((
        "Concepts array has 3+ items",
        len(concepts) >= 3,
        f"{len(concepts)} concept(s)",
    ))

    # ── Check 3: Each concept has ≥ 2 bullets ─────────────────────────────
    short = [
        c.get("title", "?") for c in concepts
        if len(c.get("bullets", [])) < 2
    ]
    results.append((
        "Each concept has 2+ bullets",
        len(short) == 0,
        "OK" if not short else f"{len(short)} thin: {short[:3]}",
    ))

    # ── Check 4: Summary has ≥ 4 bullets ──────────────────────────────────
    summary = extracted.get("summary", [])
    results.append((
        "Summary has 4+ bullets",
        len(summary) >= 4,
        f"{len(summary)} bullet(s)",
    ))

    # ── Check 5: Entities dict has some data ──────────────────────────────
    ents = extracted.get("entities", {})
    total_ents = sum(
        len(ents.get(k, [])) for k in ("drugs", "proteins", "targets", "tools")
    )
    results.append((
        "Entities has some data",
        total_ents > 0,
        f"{total_ents} entity/entities total",
    ))

    # ── Check 6: Slug is URL-friendly ─────────────────────────────────────
    slug = extracted.get("slug", "")
    slug_ok = bool(slug) and bool(re.match(r"^[a-z0-9][a-z0-9\-]*$", slug))
    results.append((
        "Slug is URL-friendly",
        slug_ok,
        f"'{slug}'",
    ))

    # ── Print results ──────────────────────────────────────────────────────
    all_pass = True
    for name, passed, detail in results:
        icon = "✅" if passed else "❌"
        print(f"      {icon} {name}  ({detail})")
        if not passed:
            all_pass = False

    if all_pass:
        print("   ✅ All checks passed.")
    else:
        failed = sum(1 for _, p, _ in results if not p)
        print(f"   ⚠️  {failed} check(s) failed — episode will still be saved.")

    return all_pass
