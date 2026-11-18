"""Reciters, word-level timings (Quran.com QDC) and chapter audio caching."""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

from app.config import get_settings
from app.services.cache import cache_path, cached_json, client, get_json, write_atomic
from app.services.quran_api import chapters

logger = logging.getLogger(__name__)

STYLE_AR = {
    "murattal": "مرتّل",
    "mujawwad": "مجوّد",
    "muallim": "معلّم",
    "kids repeat": "معلّم مع ترديد الأطفال",
}
_downloads: dict[str, asyncio.Task] = {}

# Reciters Quran.com has no recording of. EveryAyah.com has them as one mp3 per ayah, with
# no word timings, so the player plays each ayah's file and highlights the ayah, not the word.
EVERYAYAH = "https://everyayah.com/data"
AYAH_RECITERS = {
    9001: {"name": "أيمن رشدي سويد", "name_en": "Ayman Sowaid", "folder": "Ayman_Sowaid_64kbps"},
}


def is_per_ayah(rid: int) -> bool:
    return rid in AYAH_RECITERS


def ayah_reciters() -> list[dict]:
    return [
        {"id": rid, "name": r["name"], "name_en": r["name_en"], "style": "",
         "label": f"{r['name']} — دون تتبّع الكلمات", "per_ayah": True}
        for rid, r in AYAH_RECITERS.items()
    ]


def ayah_timings(rid: int, n: int, ayahs: int) -> dict:
    """One file per ayah; `to` stays 0 until the browser reads each file's length."""
    folder = AYAH_RECITERS[rid]["folder"]
    return {
        "audio_url": None,
        "duration": 0,
        "per_ayah": True,
        "verses": [
            {"key": f"{n}:{a}", "n": a, "from": 0, "to": 0, "segs": [],
             "url": f"{EVERYAYAH}/{folder}/{n:03d}{a:03d}.mp3"}
            for a in range(1, ayahs + 1)
        ],
    }


async def reciters() -> list[dict]:
    return [*await _qdc_reciters(), *ayah_reciters()]


async def _qdc_reciters() -> list[dict]:
    async def build():
        d = await get_json(f"{get_settings().qdc_api_base}/audio/reciters", params={"locale": "ar"})
        out, seen = [], set()
        for r in d["reciters"]:
            style_en = ((r.get("style") or {}).get("name") or "").strip()
            name = (r.get("translated_name") or {}).get("name") or r["name"]
            style = STYLE_AR.get(style_en.lower(), style_en)
            label = f"{name} — {style}" if style else name
            if label in seen:
                label += " (تسجيل آخر)"
            seen.add(label)
            out.append({"id": r["id"], "name": name, "name_en": r["name"], "style": style, "label": label})
        return out

    return await cached_json(("audio", "reciters.json"), build)


def sanitize_timings(raw: dict) -> dict:
    """QDC data occasionally contains malformed segments such as [1] or
    start>end; keep only well-formed [pos, start, end] triplets (ms, ints)."""
    verses = []
    for vt in raw.get("verse_timings") or []:
        segs = []
        for s in vt.get("segments") or []:
            if not isinstance(s, (list, tuple)) or len(s) < 3:
                continue
            try:
                pos, a, b = int(s[0]), int(round(float(s[1]))), int(round(float(s[2])))
            except (TypeError, ValueError):
                continue
            if pos < 1 or b <= a:
                continue
            segs.append([pos, a, b])
        segs.sort(key=lambda x: x[1])
        key = vt["verse_key"]
        start, end = vt.get("timestamp_from"), vt.get("timestamp_to")
        # Some upstream verses lack bounds (e.g. 168/101:3); derive them from the words.
        if start is None and segs:
            start = segs[0][1]
        if end is None and segs:
            end = max(s[2] for s in segs)
        if start is None or end is None:
            continue
        verses.append({
            "key": key,
            "n": int(key.split(":")[1]),
            "from": int(round(float(start))),
            "to": int(round(float(end))),
            "segs": segs,
        })
    verses.sort(key=lambda v: v["n"])
    return {
        "audio_url": raw["audio_url"],
        "duration": int(round(float(raw.get("duration") or 0))),
        "verses": verses,
    }


async def timings(rid: int, n: int) -> dict:
    if is_per_ayah(rid):
        meta = next(c for c in await chapters() if c["id"] == n)
        return ayah_timings(rid, n, meta["ayahs"])

    async def build():
        d = await get_json(
            f"{get_settings().qdc_api_base}/audio/reciters/{rid}/audio_files",
            params={"chapter": n, "segments": "true"},
        )
        files = d.get("audio_files") or []
        if not files:
            raise LookupError(f"No audio for reciter {rid}, surah {n}")
        return sanitize_timings(files[0])

    return await cached_json(("audio", str(rid), f"timings_{n:03d}.json"), build)


def audio_file(rid: int, n: int) -> Path:
    return cache_path("audio", str(rid), f"{n:03d}.mp3")


async def _download(url: str, dest: Path) -> None:
    tmp = dest.with_suffix(".mp3.part")
    try:
        async with client().stream("GET", url) as r:
            r.raise_for_status()
            with open(tmp, "wb") as f:
                async for chunk in r.aiter_bytes(1 << 16):
                    f.write(chunk)
        os.replace(tmp, dest)
        logger.info("Cached audio %s", dest)
    except Exception:
        logger.exception("Audio download failed: %s", url)
        tmp.unlink(missing_ok=True)


def ensure_download(url: str, dest: Path) -> bool:
    """Start a background download if needed. Returns True while one is running."""
    key = str(dest)
    task = _downloads.get(key)
    if task and not task.done():
        return True
    if dest.exists() or not get_settings().cache_audio:
        return False
    _downloads[key] = asyncio.create_task(_download(url, dest))
    return True


def download_state(dest: Path) -> str:
    if dest.exists():
        return "cached"
    task = _downloads.get(str(dest))
    return "downloading" if task and not task.done() else "remote"


async def wbw_audio(path: str) -> Path:
    """Word-by-word clip (small) — fetched synchronously then served from disk."""
    dest = cache_path("wbw", *path.split("/"))
    if not dest.exists():
        r = await client().get(f"{get_settings().wbw_audio_base}/{path}")
        r.raise_for_status()
        write_atomic(dest, r.content)
    return dest
