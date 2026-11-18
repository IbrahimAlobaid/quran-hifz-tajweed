"""Tiny JSON disk cache + shared async HTTP client."""
from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

_client: httpx.AsyncClient | None = None
_locks: dict[str, asyncio.Lock] = {}


def client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        s = get_settings()
        _client = httpx.AsyncClient(
            timeout=s.http_timeout_s,
            follow_redirects=True,
            headers={"User-Agent": "quran-hifz-local/1.0"},
        )
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


async def get_json(url: str, params: dict | None = None, retries: int = 3) -> Any:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            r = await client().get(url, params=params)
            r.raise_for_status()
            return r.json()
        except (httpx.HTTPError, ValueError) as e:  # network or bad JSON
            last = e
            logger.warning("GET %s failed (attempt %d): %s", url, attempt + 1, e)
            await asyncio.sleep(0.6 * (attempt + 1))
    raise RuntimeError(f"Upstream request failed: {url}") from last


def cache_path(*parts: str) -> Path:
    p = get_settings().cache_dir.joinpath(*parts)
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def write_atomic(path: Path, data: bytes) -> None:
    tmp = path.with_suffix(path.suffix + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, path)


async def cached_json(key: tuple[str, ...], build: Callable[[], Awaitable[Any]]) -> Any:
    """Return JSON from disk if present, else build it, store it and return it.
    A per-key lock prevents duplicate upstream fetches under concurrent requests."""
    path = cache_path(*key)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    lock = _locks.setdefault(str(path), asyncio.Lock())
    async with lock:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
        data = await build()
        write_atomic(path, json.dumps(data, ensure_ascii=False).encode("utf-8"))
        return data
