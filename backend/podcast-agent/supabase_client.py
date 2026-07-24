"""
supabase_client.py
──────────────────
Shared Supabase PostgREST helpers used by pipeline.py, graph_agent.py, and
transcribe.py. Single source for URL/header construction — previously
copy-pasted (with slight variants) in all three.

Raw requests only — no supabase-py (incompatible with Python 3.14).

Exposes:
    sb_url(table, *, supabase_url=None)                         -> str
    sb_headers(*, represent=False, content_type=True,
               supabase_key=None)                                -> dict
    sb_get(table, params=None, *, content_type=True,
           supabase_url=None, supabase_key=None)                 -> list
    sb_post(table, payload, *, supabase_url=None,
            supabase_key=None)                                   -> list
"""

import os

import requests


# ── URL / header builders ───────────────────────────────────────────────────────

def sb_url(table: str, *, supabase_url: str | None = None) -> str:
    base = supabase_url if supabase_url is not None else os.environ["SUPABASE_URL"]
    return base.rstrip("/") + f"/rest/v1/{table}"


def sb_headers(
    *,
    represent: bool = False,
    content_type: bool = True,
    supabase_key: str | None = None,
) -> dict:
    key = supabase_key if supabase_key is not None else os.environ["SUPABASE_KEY"]
    h = {
        "apikey":        key,
        "Authorization": f"Bearer {key}",
    }
    if content_type:
        h["Content-Type"] = "application/json"
    if represent:
        h["Prefer"] = "return=representation"
    return h


# ── Request helpers ─────────────────────────────────────────────────────────────

def sb_get(
    table: str,
    params: dict | None = None,
    *,
    content_type: bool = True,
    supabase_url: str | None = None,
    supabase_key: str | None = None,
) -> list:
    r = requests.get(
        sb_url(table, supabase_url=supabase_url),
        headers=sb_headers(content_type=content_type, supabase_key=supabase_key),
        params={**(params or {}), "limit": "10000"},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def sb_post(
    table: str,
    payload: dict | list,
    *,
    supabase_url: str | None = None,
    supabase_key: str | None = None,
) -> list:
    r = requests.post(
        sb_url(table, supabase_url=supabase_url),
        headers=sb_headers(represent=True, supabase_key=supabase_key),
        json=payload,
        timeout=30,
    )
    r.raise_for_status()
    return r.json() if r.text.strip() else []
