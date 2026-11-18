"""Integrity of the imported curriculum (frontend/data/learn) and its links
from the tajweed rule catalog."""
import json
from pathlib import Path

from app.services.tajweed_rules import RULES

LEARN = Path(__file__).resolve().parents[2] / "frontend" / "data" / "learn"


def load(name):
    return json.loads((LEARN / name).read_text(encoding="utf-8"))


def test_every_rule_links_to_an_existing_lesson_and_matn_lines():
    mutun = {m["key"]: {l["n"] for s in m["sections"] for l in s["lines"]} for m in load("mutun.json")}
    for key, r in RULES.items():
        if r["lesson"]:
            assert (LEARN / "lessons" / f"{r['lesson']}.json").exists(), key
        if r["cite"]:
            assert set(r["cite"]["lines"]) <= mutun[r["cite"]["text"]], key


def test_index_lessons_match_files_and_units():
    idx = load("index.json")
    units = {u["id"] for u in idx["units"]}
    assert len(idx["lessons"]) == 34
    for l in idx["lessons"]:
        assert l["unit"] in units
        assert (LEARN / "lessons" / f"{l['slug']}.json").exists()
    assert len({l["order"] for l in idx["lessons"]}) == len(idx["lessons"])


def test_examples_resolved_to_words_and_quiz_answers_valid():
    for f in (LEARN / "lessons").glob("*.json"):
        lesson = json.loads(f.read_text(encoding="utf-8"))
        for b in lesson["blocks"]:
            if b["t"] == "examples":
                assert all(i["words"] for i in b["items"]), f.name
            if b["t"] == "ayah":
                ps = {w["p"] for w in b["words"]}
                assert all(m["from"] in ps and m["to"] in ps for m in b["marks"]), f.name
            if b["t"] == "quiz":
                assert all(0 <= q["answer"] < len(q["options"]) for q in b["questions"]), f.name
