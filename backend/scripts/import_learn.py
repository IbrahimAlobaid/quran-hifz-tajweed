"""Import the tajweed curriculum into the site.

Sources (clone them anywhere, pass the paths):
  * learn-tajweed (edriso, 0BSD)  — 34 Arabic lessons in 11 units, quizzes, videos
  * ghunna (mwiederrecht, MIT)    — the texts of تحفة الأطفال and المقدمة الجزرية
                                    (from Arabic Wikisource) with line numbers

    python scripts/import_learn.py --lessons <learn-tajweed dir> --ghunna <ghunna dir>

Lessons reference verses by number plus a phrase written without tashkeel
(`ref: 2:19`, `highlight: من الصواعق`). Each phrase is resolved here against the
same Quran.com word data the player uses, so every example is rendered with our
tajweed colouring and can be played word-exactly from the reciter's timings.
Output: frontend/data/learn/*.json (static files, no runtime dependency).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import unicodedata
from pathlib import Path

import mistune
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services import quran_api  # noqa: E402
from app.services.cache import close_client  # noqa: E402

OUT = ROOT.parent / "frontend" / "data" / "learn"

# ── Arabic skeleton (ported from learn-tajweed/scripts/build-quran.mjs) ────────
SUPERSCRIPT_ALEF = "ٰ"
MARKS = re.compile(r"[ؐ-ًؚ-ٟـۖ-ۭ࣓-ࣿ‌-‏]")


def fold_letter(ch: str) -> str:
    if ch in "ٱأإآا":
        return "ا"
    # ٮ (dotless ya, used in «مَجۡر۪ىٰهَا» by Quran.com) folds like ى
    return {"ى": "ي", "ٮ": "ي", "ة": "ه", "ؤ": "و", "ئ": "ي"}.get(ch, ch)


def skeleton(text: str, alef_mode: str) -> tuple[str, list[int]]:
    out: list[str] = []
    pos: list[int] = []
    for i, ch in enumerate(text):
        if ch == SUPERSCRIPT_ALEF:
            if alef_mode == "drop":
                continue
            if alef_mode == "merge" and out and out[-1] in "وي":
                out[-1] = "ا"
                continue
            out.append("ا"); pos.append(i)
            continue
        if MARKS.match(ch):
            continue
        if ch.isspace():
            if out and out[-1] == " ":
                continue
            out.append(" "); pos.append(i)
            continue
        out.append(fold_letter(ch)); pos.append(i)
    return "".join(out), pos


def query_forms(phrase: str, alef_mode: str) -> list[str]:
    composed = unicodedata.normalize("NFC", phrase)
    readings = [composed.replace("آ", "ءا"), unicodedata.normalize("NFD", composed)]
    forms = [re.sub(r"\s+", " ", skeleton(f, alef_mode)[0].strip()) for f in readings]
    return [f for f in dict.fromkeys(forms) if f]


def find_all(hay: str, needle: str) -> list[int]:
    hits, at = [], hay.find(needle)
    while at != -1:
        end = at + len(needle)
        if (at == 0 or hay[at - 1] == " ") and (end == len(hay) or hay[end] == " "):
            hits.append(at)
        at = hay.find(needle, at + 1)
    return hits


def locate_words(words: list[str], phrase: str) -> tuple[int, int] | str:
    """Resolve a phrase to an inclusive word-index range inside `words`."""
    text = " ".join(words)
    owner = []  # char index -> word index
    for wi, w in enumerate(words):
        owner.extend([wi] * len(w))
        owner.append(wi)  # the joining space
    for mode in ("keep", "merge", "drop"):
        hay, pos = skeleton(text, mode)
        needles = query_forms(phrase, mode)
        if not needles:
            return "empty phrase"
        needle = next((n for n in needles if find_all(hay, n)), needles[0])
        hits = find_all(hay, needle)
        if len(hits) > 1:
            return f"«{phrase}» occurs {len(hits)} times"
        if len(hits) == 1:
            a = hits[0]
            return owner[pos[a]], owner[pos[a + len(needle) - 1]]
    return f"«{phrase}» not found in: {skeleton(text, 'keep')[0]}"


# ── Markdown ───────────────────────────────────────────────────────────────────
_md = mistune.create_markdown(escape=True, plugins=["table", "strikethrough"])
QUOTE = re.compile(r"«([^«»]{1,200})»")


def md(text: str | None, inline: bool = False) -> str:
    if not text:
        return ""
    html = _md(str(text)).strip()
    if inline and html.startswith("<p>") and html.endswith("</p>") and html.count("<p>") == 1:
        html = html[3:-4]
    html = QUOTE.sub(r'<span class="q-inline">«\1»</span>', html)
    # only same-site or https links survive
    html = re.sub(r'href="(?!https://|#)[^"]*"', 'href="#"', html)
    return html.replace("<a href=\"https://", '<a target="_blank" rel="noopener" href="https://')


# ── Lesson parsing ─────────────────────────────────────────────────────────────
FRONT = re.compile(r"^---\r?\n(.*?)\r?\n---\r?\n", re.S)
FENCE = re.compile(r"```(\w+)\r?\n(.*?)```", re.S)
CALLOUTS = {"rule", "tip", "note", "warning"}


class Resolver:
    def __init__(self) -> None:
        self.surahs: dict[int, dict] = {}
        self.errors: list[str] = []

    async def load(self, n: int) -> dict:
        if n not in self.surahs:
            self.surahs[n] = await quran_api.surah(n)
        return self.surahs[n]

    async def ayah(self, ref: str) -> dict:
        s, a = (int(x) for x in str(ref).split(":"))
        surah = await self.load(s)
        verse = next(v for v in surah["verses"] if v["n"] == a)
        return {"surah": s, "ayah": a, "name": surah["name"], "verse": verse}

    def span(self, verse: dict, phrase: str | None, where: str, within: tuple[int, int] | None = None):
        words = verse["words"]
        lo, hi = within or (0, len(words) - 1)
        if not phrase:
            return lo, hi
        r = locate_words([w["text"] for w in words[lo:hi + 1]], phrase)
        if isinstance(r, str):
            self.errors.append(f"{where}: {r}")
            return None
        return lo + r[0], lo + r[1]


def pack_words(verse: dict, lo: int, hi: int) -> list[dict]:
    return [{"p": w["p"], "segs": w["segs"], "text": w["text"]} for w in verse["words"][lo:hi + 1]]


async def build_block(kind: str, body: str, res: Resolver, where: str, slug: str, qcount: list[int]) -> dict | None:
    if kind in CALLOUTS:
        return {"t": "callout", "kind": kind, "html": md(body)}
    # YAML 1.1 reads «2:23» as a base-60 integer; keep verse refs as strings.
    data = yaml.safe_load(re.sub(r"(ref:\s*)(\d+:\d+)", r'\1"\2"', body)) or {}

    if kind == "ayah":
        a = await res.ayah(data["ref"])
        v = a["verse"]
        show = res.span(v, data.get("show"), where) or (0, len(v["words"]) - 1)
        marks = data.get("marks") or ([{"text": data["highlight"], "rule": data.get("rule")}] if data.get("highlight") else [])
        out_marks = []
        for m in marks:
            sp = res.span(v, m["text"], where, show)
            if sp:
                out_marks.append({"from": v["words"][sp[0]]["p"], "to": v["words"][sp[1]]["p"], "rule": m.get("rule")})
        return {"t": "ayah", "surah": a["surah"], "ayah": a["ayah"], "name": a["name"],
                "words": pack_words(v, *show), "whole": show == (0, len(v["words"]) - 1),
                "marks": out_marks, "note": md(data.get("note"), True)}

    if kind == "examples":
        items = []
        for it in data.get("items") or []:
            a = await res.ayah(it["ref"])
            v = a["verse"]
            sp = res.span(v, it.get("word"), f"{where} {it['ref']}")
            if not sp:
                continue
            hl = res.span(v, it.get("highlight"), f"{where} {it['ref']}", sp) if it.get("highlight") else sp
            items.append({"surah": a["surah"], "ayah": a["ayah"], "words": pack_words(v, *sp),
                          "hl": [v["words"][hl[0]]["p"], v["words"][hl[1]]["p"]] if hl else None,
                          "note": it.get("note"), "rule": it.get("rule") or data.get("rule")})
        return {"t": "examples", "rule": data.get("rule"), "title": data.get("title"), "items": items}

    if kind == "letters":
        return {"t": "letters", "title": data.get("title"), "items": [str(x) for x in data.get("items") or []],
                "rule": data.get("rule"), "mnemonic": data.get("mnemonic"), "note": md(data.get("note"), True)}

    if kind == "mistake":
        return {"t": "mistake", **{k: md(data.get(k), True) for k in ("wrong", "right", "why")}}

    if kind == "compare":
        return {"t": "compare", "columns": [
            {"title": c.get("title"), "rule": c.get("rule"), "points": [md(p, True) for p in c.get("points") or []]}
            for c in data.get("columns") or []]}

    if kind == "quiz":
        qs = []
        for q in data.get("questions") or []:
            qcount[0] += 1
            item = {"id": f"{slug}-{qcount[0]}", "q": md(q["q"], True), "options": [md(o, True) for o in q["options"]],
                    "answer": int(q.get("answer", 0)), "why": md(q.get("why"), True), "lesson": slug}
            if q.get("ref"):
                a = await res.ayah(q["ref"])
                sp = res.span(a["verse"], q.get("word"), f"{where} quiz {q['ref']}")
                if sp:
                    item.update(surah=a["surah"], ayah=a["ayah"], words=pack_words(a["verse"], *sp))
            qs.append(item)
        return {"t": "quiz", "title": data.get("title"), "questions": qs}

    res.errors.append(f"{where}: unknown block {kind}")
    return None


async def parse_lesson(path: Path, res: Resolver) -> dict:
    raw = path.read_text(encoding="utf-8")
    m = FRONT.match(raw)
    meta = yaml.safe_load(m.group(1))
    body = raw[m.end():]
    slug = path.stem
    blocks, last, qcount = [], 0, [0]
    for f in FENCE.finditer(body):
        prose = body[last:f.start()].strip()
        if prose:
            blocks.append({"t": "md", "html": md(prose)})
        b = await build_block(f.group(1), f.group(2), res, f"{slug}:{f.group(1)}", slug, qcount)
        if b:
            blocks.append(b)
        last = f.end()
    tail = body[last:].strip()
    if tail:
        blocks.append({"t": "md", "html": md(tail)})
    return {
        "slug": slug, "title": meta["title"], "description": meta.get("description", ""),
        "unit": meta["unit"], "order": int(meta["order"]), "minutes": meta.get("minutes"),
        "tags": meta.get("tags") or [],
        "videos": [{"title": v["title"], "id": v["youtubeId"], "start": v.get("start")} for v in meta.get("videos") or []],
        "resources": [{"title": r["title"], "url": r["url"], "note": r.get("note")} for r in meta.get("resources") or []
                      if str(r.get("url", "")).startswith("https://")],
        "blocks": blocks,
    }


# ── Registries ─────────────────────────────────────────────────────────────────
def parse_units(src: str) -> list[dict]:
    pat = re.compile(r"id: '([^']+)',\s*title: '([^']+)',\s*description:\s*'([^']*)'", re.S)
    return [{"id": a, "title": b, "description": c} for a, b, c in pat.findall(src)]


def parse_rules(src: str) -> dict:
    pat = re.compile(r"id: '([^']+)',\s*name: '([^']+)',\s*color: '([^']+)',\s*short:\s*'([^']*)',\s*lesson: '([^']+)'", re.S)
    return {a: {"name": b, "color": c, "short": d, "lesson": e} for a, b, c, d, e in pat.findall(src)}


def parse_matn(path: Path, key: str, title: str, author: str) -> dict:
    sections, cur = [], None
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            if "روابط" in line:
                break
            cur = {"title": line[3:].strip(), "lines": []}
            sections.append(cur)
            continue
        m = re.match(r"^(\d+)\.\s+(.*?)\s+\*\*\*\s+(.*)$", line)
        if m and cur is not None:
            cur["lines"].append({"n": int(m.group(1)), "a": m.group(2).strip(), "b": m.group(3).strip()})
    return {"key": key, "title": title, "author": author, "source": "ويكي مصدر (ar.wikisource.org)", "sections": sections}


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lessons", required=True, type=Path, help="learn-tajweed checkout")
    ap.add_argument("--ghunna", required=True, type=Path, help="ghunna checkout")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "lessons").mkdir(exist_ok=True)

    res = Resolver()
    units = parse_units((args.lessons / "src/lib/units.ts").read_text(encoding="utf-8"))
    rules = parse_rules((args.lessons / "src/lib/rules.ts").read_text(encoding="utf-8"))
    lessons = []
    try:
        for p in sorted((args.lessons / "src/content/lessons").glob("*.md")):
            lesson = await parse_lesson(p, res)
            (OUT / "lessons" / f"{lesson['slug']}.json").write_text(json.dumps(lesson, ensure_ascii=False), encoding="utf-8")
            lessons.append(lesson)
        sheet_raw = (args.lessons / "src/content/pages/cheatsheet.md").read_text(encoding="utf-8")
        sheet_body = sheet_raw[FRONT.match(sheet_raw).end():]
    finally:
        await close_client()

    lessons.sort(key=lambda x: x["order"])
    index = {
        "units": units,
        "rules": rules,
        "lessons": [{k: l[k] for k in ("slug", "title", "description", "unit", "order", "minutes", "tags")}
                    | {"videos": len(l["videos"]), "quiz": sum(len(b["questions"]) for b in l["blocks"] if b["t"] == "quiz")}
                    for l in lessons],
        "credits": {
            "lessons": {"name": "دليل «تعلَّم التجويد» — محمد إدريس", "url": "https://github.com/edriso/learn-tajweed", "license": "0BSD"},
            "mutun": {"name": "مشروع غُنّة (Ghunna)", "url": "https://github.com/mwiederrecht/ghunna", "license": "MIT"},
        },
    }
    practice = [q for l in lessons for b in l["blocks"] if b["t"] == "quiz" for q in b["questions"]]
    mutun = [
        parse_matn(args.ghunna / "docs/sources/tuhfah.md", "tuhfah", "تحفة الأطفال والغلمان في تجويد القرآن", "سليمان الجمزوري"),
        parse_matn(args.ghunna / "docs/sources/jazariyyah.md", "jazariyyah", "المقدمة فيما يجب على قارئ القرآن أن يعلمه (الجزرية)", "محمد بن الجزري"),
    ]
    files = {"index.json": index, "practice.json": practice, "mutun.json": mutun,
             "cheatsheet.json": {"title": "خلاصة الأحكام", "html": md(sheet_body)}}
    for name, data in files.items():
        (OUT / name).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    print(f"lessons: {len(lessons)}  units: {len(units)}  rules: {len(rules)}  quiz questions: {len(practice)}")
    print(f"videos: {sum(len(l['videos']) for l in lessons)}  mutun lines: {sum(len(s['lines']) for m in mutun for s in m['sections'])}")
    print(f"unresolved references: {len(res.errors)}")
    for e in res.errors:
        print("  ✗", e)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main())
