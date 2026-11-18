"""Quran text + tajweed, fetched from Quran.com v4 and cached on disk as a
compact, UI-ready structure."""
from __future__ import annotations

from app.config import get_settings
from app.services.cache import cached_json, get_json
from app.services.tajweed_audit import annotate_word, parse_markup, waqf_in

SCHEMA_VERSION = "v1"


async def chapters() -> list[dict]:
    async def build():
        base = get_settings().quran_api_base
        d = await get_json(f"{base}/chapters", params={"language": "ar"})
        return [
            {
                "id": c["id"],
                "name": c["name_arabic"],
                "name_en": c["name_simple"],
                "ayahs": c["verses_count"],
                "place": "مكية" if c["revelation_place"] == "makkah" else "مدنية",
                "bismillah": bool(c.get("bismillah_pre")),
                "pages": c.get("pages"),
            }
            for c in d["chapters"]
        ]

    return await cached_json(("text", SCHEMA_VERSION, "chapters.json"), build)


async def _fetch_verses(n: int) -> list[dict]:
    base = get_settings().quran_api_base
    verses: list[dict] = []
    page = 1
    while page:
        d = await get_json(
            f"{base}/verses/by_chapter/{n}",
            params={
                "words": "true",
                "word_fields": "text_uthmani,text_uthmani_tajweed",
                "per_page": 50,
                "page": page,
            },
        )
        verses.extend(d["verses"])
        page = d["pagination"].get("next_page")
    return verses


def build_surah(meta: dict, verses: list[dict]) -> dict:
    """Turn raw Quran.com verses into the structure the UI renders."""
    ayahs: list[dict] = []
    for v in verses:
        words = [w for w in v["words"] if w["char_type_name"] == "word"]
        end = next((w["text_uthmani"] for w in v["words"] if w["char_type_name"] == "end"), "")
        ayahs.append({
            "n": v["verse_number"],
            "key": v["verse_key"],
            "juz": v.get("juz_number"),
            "page": v.get("page_number"),
            "hizb": v.get("hizb_number"),
            "end": end,
            "_words": words,
        })

    # Flatten for cross-word / cross-ayah context (idgham etc. spans word borders).
    flat = [(ai, wi) for ai, a in enumerate(ayahs) for wi in range(len(a["_words"]))]
    seg_cache = {}
    for ai, wi in flat:
        w = ayahs[ai]["_words"][wi]
        seg_cache[(ai, wi)] = parse_markup(w.get("text_uthmani_tajweed") or w["text_uthmani"])

    def plain(ai: int, wi: int) -> str:
        return "".join(s["t"] for s in seg_cache[(ai, wi)])

    for idx, (ai, wi) in enumerate(flat):
        a = ayahs[ai]
        w = a["_words"][wi]
        segs = seg_cache[(ai, wi)]
        prev = flat[idx - 1] if idx > 0 else None
        nxt = flat[idx + 1] if idx + 1 < len(flat) else None
        ctx = {
            "ayah": a["n"],
            "is_last": wi == len(a["_words"]) - 1,
            "prev_word": plain(*prev) if prev else None,
            "next_word": plain(*nxt) if nxt else None,
        }
        text = plain(ai, wi)
        a.setdefault("words", []).append({
            "p": w["position"],
            "segs": segs,
            "text": text,
            "wbw": w.get("audio_url"),
            "rules": annotate_word(segs, ctx),
            "waqf": waqf_in(text),
        })
    for a in ayahs:
        a.pop("_words", None)
        a.setdefault("words", [])
    return {**meta, "verses": ayahs}


async def surah(n: int) -> dict:
    metas = await chapters()
    meta = next(c for c in metas if c["id"] == n)

    async def build():
        return build_surah(meta, await _fetch_verses(n))

    return await cached_json(("text", SCHEMA_VERSION, f"surah_{n:03d}.json"), build)
