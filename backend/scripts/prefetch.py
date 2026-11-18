"""Warm the local cache so the app works offline.

    python scripts/prefetch.py                    # text + tajweed for all 114 surahs
    python scripts/prefetch.py --reciter 7        # + timings and audio for one reciter
    python scripts/prefetch.py --reciter 7 --surahs 78-114
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import audio_service, quran_api  # noqa: E402
from app.services.cache import close_client  # noqa: E402


def parse_range(s: str) -> list[int]:
    out: set[int] = set()
    for part in s.split(","):
        a, _, b = part.partition("-")
        out.update(range(int(a), int(b or a) + 1))
    return sorted(n for n in out if 1 <= n <= 114)


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--surahs", default="1-114")
    ap.add_argument("--reciter", type=int, help="reciter id (see /api/reciters)")
    ap.add_argument("--concurrency", type=int, default=4)
    args = ap.parse_args()
    nums = parse_range(args.surahs)
    sem = asyncio.Semaphore(args.concurrency)

    async def one(n: int) -> None:
        async with sem:
            await quran_api.surah(n)
            if args.reciter and not audio_service.is_per_ayah(args.reciter):
                t = await audio_service.timings(args.reciter, n)
                dest = audio_service.audio_file(args.reciter, n)
                if not dest.exists():
                    await audio_service._download(t["audio_url"], dest)
            print(f"✓ {n}", flush=True)

    try:
        await asyncio.gather(*(one(n) for n in nums))
    finally:
        await close_client()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main())
