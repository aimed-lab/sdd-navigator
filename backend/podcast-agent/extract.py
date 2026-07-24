"""
extract.py
──────────
Send transcript to Groq (llama-3.3-70b-versatile) and return structured JSON.
Retries once automatically if required fields are missing.

Exposes:
    extract_knowledge(transcript, metadata) -> dict
"""

import json
import os
import re

from groq import Groq


# ── System prompt ──────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are a research knowledge extractor.
Given a podcast transcript extract ONLY a JSON object with this exact structure:

{
  "title": "string",
  "episode_number": 0,
  "slug": "url-friendly-title",
  "description": "2-3 sentence overview of the episode for display on the wiki card.",
  "summary": [
    "First key point discussed in the episode.",
    "Second key point.",
    "...add as many bullets as needed — cover EVERY significant point completely."
  ],
  "concepts": [
    {
      "title": "Concept Name",
      "bullets": ["point one", "point two", "at least two per concept"]
    }
  ],
  "tags": ["tag1", "tag2"],
  "entities": {
    "drugs":    ["string"],
    "proteins": ["string"],
    "targets":  ["string"],
    "tools":    ["string"]
  }
}

Rules:
- Return ONLY the raw JSON object — no markdown fences, no explanation.
- Every field must be present even if its value is an empty array/string.
- "slug" must be lowercase, hyphen-separated, no special chars (e.g. "digital-twins-in-oncology").
- "description" is 2-3 sentences max — a human-readable card teaser.
- "summary" has NO limit — include every significant finding or discussion point.
- "concepts" must have at least 5 items when the transcript is long enough.
- Each concept must have at least 2 bullets.
- "entities" lists proper nouns only — drug names, gene/protein names, biological targets, software tools.
"""

_MAX_CHARS = 24_000


# ── Helpers ────────────────────────────────────────────────────────────────────

def _trim(transcript: str) -> str:
    if len(transcript) <= _MAX_CHARS:
        return transcript
    trimmed = transcript[:_MAX_CHARS]
    dot = trimmed.rfind(".")
    if dot > _MAX_CHARS * 0.8:
        trimmed = trimmed[: dot + 1]
    return trimmed + "\n\n[transcript trimmed for length]"


def _parse_json(raw: str) -> dict:
    """Extract JSON from raw LLM response, tolerating markdown fences."""
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
    if m:
        return json.loads(m.group(1))
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if m:
        return json.loads(m.group(0))
    raise ValueError("No JSON object found in Groq response")


def _apply_defaults(data: dict, metadata: dict) -> dict:
    """Fill missing keys with safe defaults so callers never hit KeyError."""
    ep_num = metadata.get("episode_number", 0)
    title  = metadata.get("title", f"Episode {ep_num}")
    defaults = {
        "title":          title,
        "episode_number": ep_num,
        "slug":           re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-"),
        "description":    "",
        "summary":        [],
        "concepts":       [],
        "tags":           [],
        "entities":       {"drugs": [], "proteins": [], "targets": [], "tools": []},
    }
    for k, v in defaults.items():
        data.setdefault(k, v)
    try:
        data["episode_number"] = int(data["episode_number"])
    except (ValueError, TypeError):
        data["episode_number"] = ep_num
    return data


def _check_fields(data: dict) -> list[str]:
    """Return list of field names that are missing or empty."""
    missing = []
    if not data.get("concepts"):
        missing.append("concepts")
    if not data.get("summary"):
        missing.append("summary")
    if not data.get("slug"):
        missing.append("slug")
    if not data.get("description"):
        missing.append("description")
    return missing


# ── Public API ─────────────────────────────────────────────────────────────────

def extract_knowledge(transcript: str, metadata: dict, _retry: bool = True) -> dict:
    """
    Send transcript to Groq and return validated extraction dict.
    Retries once automatically if required fields are empty.

    Args:
        transcript: Full plain-text transcript.
        metadata:   Dict with episode_number and title at minimum.

    Returns:
        Validated extraction dict with all required keys.

    Raises:
        groq.APIError, ValueError, json.JSONDecodeError on unrecoverable failure.
    """
    client   = Groq(api_key=os.environ["GROQ_API_KEY"])
    trimmed  = _trim(transcript)
    was_trimmed = len(transcript) > _MAX_CHARS

    ep_num = metadata.get("episode_number", "?")
    title  = metadata.get("title", "")

    if was_trimmed:
        print(f"   ✂️  Transcript trimmed: {len(transcript):,} → {len(trimmed):,} chars")

    user_msg = (
        f"Episode Title: {title}\n"
        f"Episode Number: {ep_num}\n\n"
        f"TRANSCRIPT:\n{trimmed}"
    )

    print(f"   🤖 Sending to Groq (llama-3.3-70b-versatile)…")
    print(f"   📤 Prompt size: {len(user_msg):,} chars")

    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": user_msg},
        ],
        temperature=0.1,
        max_tokens=4_096,
    )

    raw   = response.choices[0].message.content.strip()
    usage = response.usage
    print(f"   📊 Tokens: in={usage.prompt_tokens:,}  out={usage.completion_tokens:,}")

    try:
        data = _parse_json(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        if _retry:
            print(f"   ⚠️  JSON parse error: {exc} — retrying once…")
            return extract_knowledge(transcript, metadata, _retry=False)
        raise

    data = _apply_defaults(data, metadata)

    missing = _check_fields(data)
    if missing and _retry:
        print(f"   ⚠️  Missing/empty fields: {missing} — retrying once…")
        return extract_knowledge(transcript, metadata, _retry=False)

    print(
        f"   ✅ Extracted: {len(data['concepts'])} concepts · "
        f"{len(data['summary'])} summary bullets · "
        f"{len(data['tags'])} tags"
    )
    return data
