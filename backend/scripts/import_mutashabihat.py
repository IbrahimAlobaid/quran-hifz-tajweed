"""Import the mutashabihat (verbally similar verses) data into
frontend/data/mutashabihat/.

Source: Waqar Akram, «Quran Mutashabihat Data», CC0 1.0, pinned commit below.
It lists the similar places that most often confuse huffaz, from the work of
Qari Idrees al-Asim and the author's own experience. It is not meant to be an
exhaustive list. Ayahs there are 0-based absolute numbers (0 = 1:1, 9 = 2:3).

Teaching rules (ways to tell two places apart, with worked pairs) come from
backend/data/mutashabihat_dawabit.json. A group whose pair is one of those
examples carries the rule in "notes", so the ayah panel can show it.

Output:
  dawabit.json    the rules, with the Uthmani words of every example ayah
  index.json      {"surahs": {s: number of groups}, "total": n}
  NNN.json        {"s": n,
                   "groups": [{"src": ["2:3"], "muts": [["8:3"], ...], "ctx": true?,
                               "notes": {mut index: {"rule": id, "dabit": text}}?}],
                   "text": {"2:3": ["word", ...], ...}}      Uthmani words
                   for every ayah a group in this surah mentions (and the
                   ayah after it when the group asks for context)

    python scripts/import_mutashabihat.py
"""
from __future__ import annotations

import asyncio
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.config import get_settings  # noqa: E402
from app.services import quran_api  # noqa: E402
from app.services.cache import close_client  # noqa: E402

DAWABIT = ROOT / "data" / "mutashabihat_dawabit.json"
COMMIT = "7b259fc73669701695df1e9902215972255a18ee"
URL = f"https://raw.githubusercontent.com/Waqar144/Quran_Mutashabihat_Data/{COMMIT}/mutashabiha_data.json"


def ayah_keys(counts: list[int]):
    starts, acc = [], 0
    for c in counts:
        starts.append(acc)
        acc += c

    def key(i: int) -> str:
        for s in range(len(counts) - 1, -1, -1):
            if i >= starts[s]:
                return f"{s + 1}:{i - starts[s] + 1}"
        raise ValueError(i)

    return key, acc


def as_list(x) -> list[int]:
    return x if isinstance(x, list) else [x]


def convert(raw: dict, counts: list[int]) -> list[dict]:
    """Waqar's per-juz lists → [{"src": [keys], "muts": [[keys]], "ctx": bool}] in mushaf order."""
    key, total = ayah_keys(counts)
    seen, out = set(), []
    for juz in sorted(raw, key=int):
        for e in raw[juz]:
            src = as_list(e["src"]["ayah"])
            muts = [as_list(m["ayah"]) for m in e["muts"]]
            assert all(0 <= i < total for i in src + [i for m in muts for i in m])
            sig = (tuple(src), tuple(map(tuple, muts)))
            if sig in seen:
                continue
            seen.add(sig)
            g = {"src": [key(i) for i in src], "muts": [[key(i) for i in m] for m in muts]}
            if e.get("ctx"):
                g["ctx"] = True
            out.append((src[0], g))
    return [g for _, g in sorted(out, key=lambda t: t[0])]


def next_key(k: str, counts: list[int]) -> str | None:
    s, a = map(int, k.split(":"))
    if a < counts[s - 1]:
        return f"{s}:{a + 1}"
    return f"{s + 1}:1" if s < len(counts) else None


async def main() -> None:
    with urllib.request.urlopen(URL, timeout=60) as r:
        raw = json.load(r)
    try:
        metas = await quran_api.chapters()
        surahs = {m["id"]: await quran_api.surah(m["id"]) for m in metas}
    finally:
        await close_client()
    counts = [m["ayahs"] for m in metas]
    words = {f"{s}:{v['n']}": [w["text"] for w in v["words"]] for s, d in surahs.items() for v in d["verses"]}

    groups = convert(raw, counts)
    rules = json.loads(DAWABIT.read_text(encoding="utf-8"))["rules"]
    notes = {}
    for r in rules:
        for ex in r["examples"]:
            assert ex["a"] in words and ex["b"] in words, ex
            note = {"rule": r["id"], "dabit": ex["dabit"]}
            notes[(ex["a"], ex["b"])] = notes[(ex["b"], ex["a"])] = note
    attached = 0
    for g in groups:
        for i, m in enumerate(g["muts"]):
            note = notes.get((g["src"][0], m[0])) if len(g["src"]) == 1 and len(m) == 1 else None
            if note:
                g.setdefault("notes", {})[str(i)] = note
                attached += 1
    out_dir = Path(get_settings().frontend_dir) / "data" / "mutashabihat"
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("[0-9]*.json"):
        old.unlink()

    by_surah: dict[int, list[dict]] = {}
    for g in groups:
        by_surah.setdefault(int(g["src"][0].split(":")[0]), []).append(g)

    size = 0
    for s, gs in sorted(by_surah.items()):
        need = set()
        for g in gs:
            for block in [g["src"], *g["muts"]]:
                need.update(block)
                if g.get("ctx") and (nk := next_key(block[-1], counts)):
                    need.add(nk)
        text = {k: words[k] for k in sorted(need, key=lambda k: tuple(map(int, k.split(":"))))}
        raw_json = json.dumps({"s": s, "groups": gs, "text": text}, ensure_ascii=False, separators=(",", ":"))
        (out_dir / f"{s:03d}.json").write_text(raw_json, encoding="utf-8")
        size += len(raw_json.encode())

    ex_keys = sorted({k for r in rules for ex in r["examples"] for k in (ex["a"], ex["b"])}, key=lambda k: tuple(map(int, k.split(":"))))
    (out_dir / "dawabit.json").write_text(json.dumps({"rules": rules, "text": {k: words[k] for k in ex_keys}},
                                                     ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    index = {"total": len(groups), "surahs": {str(s): len(gs) for s, gs in sorted(by_surah.items())},
             "source": {"name": "Quran Mutashabihat Data (Waqar Akram)", "license": "CC0 1.0",
                        "url": "https://github.com/Waqar144/Quran_Mutashabihat_Data", "commit": COMMIT}}
    (out_dir / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"✓ {len(rules)} rules, {attached} group pairs carry a rule")
    print(f"✓ {len(groups)} groups in {len(by_surah)} surahs → {out_dir} ({size / 1e3:.0f} KB)")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main())
