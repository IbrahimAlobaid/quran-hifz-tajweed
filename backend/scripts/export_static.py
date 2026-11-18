"""Export the whole site as static files for free hosting (Cloudflare Pages,
GitHub Pages, Netlify…). No server is needed afterwards:

  dist/
    index.html               (hifz-mode switched to "static")
    css/ js/ fonts/ data/learn/ data/plans/
    data/static/surahs.json, reciters.json, tajweed-rules.json
    data/static/surah/NNN.json           text + tajweed + rule reasons
    data/static/timings/RID/NNN.json     word timings + CDN audio URL
    _headers                             cache rules for Cloudflare Pages

Audio is not copied: the browser streams it from the Quran.com CDNs.

    python scripts/export_static.py                 # all reciters, all surahs
    python scripts/export_static.py --reciters 7,12 # fewer reciters (smaller build)
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.config import get_settings  # noqa: E402
from app.services import audio_service, quran_api  # noqa: E402
from app.services.cache import close_client  # noqa: E402
from app.services.tajweed_rules import catalog  # noqa: E402

HEADERS = """/data/static/*
  Cache-Control: public, max-age=86400
/data/learn/*
  Cache-Control: public, max-age=86400
/data/plans/*
  Cache-Control: public, max-age=86400
/fonts/*
  Cache-Control: public, max-age=31536000, immutable
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
"""


def write(path: Path, data) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    path.write_bytes(raw)
    return len(raw)


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=ROOT.parent / "dist")
    ap.add_argument("--reciters", default="all", help='comma-separated ids, or "all"')
    ap.add_argument("--concurrency", type=int, default=6)
    args = ap.parse_args()
    out: Path = args.out.resolve()

    # 1) the UI
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(get_settings().frontend_dir, out, ignore=shutil.ignore_patterns("tests", "package.json"))
    index = out / "index.html"
    html = index.read_text(encoding="utf-8")
    html, n = re.subn(r'(<meta name="hifz-mode" content=")server(")', r"\1static\2", html)
    if n != 1:
        sys.exit("index.html: hifz-mode meta tag not found")
    index.write_text(html, encoding="utf-8")
    (out / "_headers").write_text(HEADERS, encoding="utf-8")

    static = out / "data" / "static"
    sem = asyncio.Semaphore(args.concurrency)
    sizes = {"surah": 0, "timings": 0}
    failures: list[str] = []

    try:
        # 2) metadata
        surahs = await quran_api.chapters()
        reciters = await audio_service.reciters()
        if args.reciters != "all":
            keep = {int(x) for x in args.reciters.split(",")}
            reciters = [r for r in reciters if r["id"] in keep]
        write(static / "surahs.json", surahs)
        write(static / "reciters.json", reciters)
        write(static / "tajweed-rules.json", catalog())

        # 3) text + tajweed for every surah
        async def surah(n: int) -> None:
            async with sem:
                sizes["surah"] += write(static / "surah" / f"{n:03d}.json", await quran_api.surah(n))

        await asyncio.gather(*(surah(s["id"]) for s in surahs))
        print(f"✓ text: {len(surahs)} surahs")

        # 4) word timings for every reciter × surah
        async def timing(rid: int, n: int) -> None:
            async with sem:
                try:
                    t = await audio_service.timings(rid, n)
                except Exception as e:  # keep going; report at the end
                    failures.append(f"reciter {rid} surah {n}: {e}")
                    return
                sizes["timings"] += write(static / "timings" / str(rid) / f"{n:03d}.json", t)

        for r in reciters:
            await asyncio.gather(*(timing(r["id"], s["id"]) for s in surahs))
            print(f"✓ timings: {r['label']}", flush=True)
    finally:
        await close_client()

    files = sum(1 for p in out.rglob("*") if p.is_file())
    total = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"\n{out}\n  files: {files}  total: {total / 1e6:.1f} MB "
          f"(text {sizes['surah'] / 1e6:.1f} MB, timings {sizes['timings'] / 1e6:.1f} MB)")
    if failures:
        print(f"  ✗ {len(failures)} timing files missing:")
        for f in failures[:20]:
            print("   ", f)
        sys.exit(1)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main())
