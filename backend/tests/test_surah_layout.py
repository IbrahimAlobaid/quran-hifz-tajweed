from app.services.quran_api import build_surah


def _w(pos, text, line, kind="word"):
    return {"position": pos, "char_type_name": kind, "text_uthmani": text,
            "page_number": 604, "line_number": line, "audio_url": f"wbw/112_001_{pos:03d}.mp3"}


def test_words_carry_mushaf_page_and_line():
    verses = [{
        "verse_number": 1, "verse_key": "112:1", "page_number": 604, "juz_number": 30,
        "words": [_w(1, "قُلۡ", 3), _w(2, "هُوَ", 3), _w(3, "ٱللَّهُ", 3), _w(4, "أَحَدٌ", 3), _w(5, "١", 4, "end")],
    }]
    s = build_surah({"id": 112, "name": "الإخلاص"}, verses)
    a = s["verses"][0]
    assert [(w["pg"], w["ln"]) for w in a["words"]] == [(604, 3)] * 4
    assert a["end"] == "١" and a["end_ln"] == 4  # the ayah marker may sit on the next line
