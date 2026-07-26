"""
tests/conftest.py — shared test fixtures.

The cache is a module-level singleton (so every caller shares one instance in
the running server). That means it also persists BETWEEN tests: without this,
two tests that search the same query at the same limit collide on one cache key
and the second silently receives the first's result. Reset it before each test.
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from cache import cache  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_cache():
    """Empty the shared cache (and its stats) around every test."""
    asyncio.run(cache.clear())
    yield
    asyncio.run(cache.clear())
