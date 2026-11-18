"""Build frontend/data/plans/mushaf.json: the Madinah-mushaf index the «خطط الحفظ»
page needs to cut the Quran into daily portions without loading every surah.

  {"juz": [1, 22, 42, ...],                     start page of each juz (30)
   "hizb": [[page, s, a], ...],                 first ayah of each hizb (60)
   "names": ["بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ", ...],   each page's first three words in the
                                                mushaf's spelling: how huffaz name
                                                a page (604)
   "pages": [[[s, a, ln], ...], ...]}           per page (604): every ayah that
                                                starts on it, with the line of
                                                its first word (1-15)

No ayah in the Madinah mushaf runs from one page into the next, so a page is
always a run of whole ayahs.

    python scripts/build_plan_index.py
"""
from __future__ import annotations

import asyncio
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.config import get_settings  # noqa: E402
from app.services import quran_api  # noqa: E402
from app.services.cache import close_client  # noqa: E402

PAGES = 604
# pause signs, the hizb-quarter sign and joiners are not part of the words that name a page
PAUSES = re.compile("[\u06D6-\u06DC\u06DE\u200C\u200D]")


def page_names(pages: list[list[list[int]]], words: dict[str, list[str]]) -> list[str]:
    """First three words of each page in the mushaf's (Uthmani) spelling, from the ayahs that start on it."""
    names = []
    for p in pages:
        out: list[str] = []
        for s, a, _ in p:
            out += [PAUSES.sub("", w).strip() for w in words[f"{s}:{a}"]]
            if len(out) >= 3:
                break
        names.append(" ".join(out[:3]))
    return names


def build(surahs: list[dict]) -> dict:
    pages: list[list[list[int]]] = [[] for _ in range(PAGES)]
    juz = [0] * 30
    hizb: list[list[int]] = [[] for _ in range(60)]
    texts: dict[str, list[str]] = {}
    for s in surahs:
        for v in s["verses"]:
            if v.get("hizb") and not hizb[v["hizb"] - 1]:
                hizb[v["hizb"] - 1] = [v["page"], s["id"], v["n"]]
            texts[f"{s['id']}:{v['n']}"] = [w["text"] for w in v["words"]]
            words = [w for w in v["words"] if w.get("ln")]
            first = words[0] if words else None
            line = first["ln"] if first else v.get("end_ln") or 1
            pages[v["page"] - 1].append([s["id"], v["n"], line])
            if not juz[v["juz"] - 1]:
                juz[v["juz"] - 1] = v["page"]
    for p in pages:
        p.sort()
    assert all(pages), "every page has at least one ayah"
    assert all(juz) and juz == sorted(juz), juz
    assert all(hizb) and hizb == sorted(hizb), hizb
    return {"juz": juz, "hizb": hizb, "names": page_names(pages, texts), "pages": pages}


async def main() -> None:
    try:
        metas = await quran_api.chapters()
        surahs = [await quran_api.surah(m["id"]) for m in metas]
    finally:
        await close_client()
    data = build(surahs)
    out = Path(get_settings().frontend_dir) / "data" / "plans" / "mushaf.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(data, separators=(",", ":"))
    out.write_text(raw, encoding="utf-8")
    print(f"✓ {out} ({len(raw) / 1e3:.0f} KB, {sum(map(len, data['pages']))} ayahs)")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main())
