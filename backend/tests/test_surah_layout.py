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


def test_lines_follow_the_v2_printing():
    # Quran.com's line_number is the 1405 printing (ar-Rahman 42 split over two lines);
    # line_v2 is the KFGQPC printing whose pages and font the site uses (one line).
    def w(pos, text, v1, v2, kind="word"):
        return {**_w(pos, text, v1, kind), "page_number": 533, "v2_page": 533, "line_v2": v2}
    verses = [{
        "verse_number": 42, "verse_key": "55:42", "page_number": 533, "juz_number": 27,
        "words": [w(1, "فَبِأَيِّ", 1, 1), w(2, "ءَالَآءِ", 2, 1), w(3, "رَبِّكُمَا", 2, 1), w(4, "تُكَذِّبَانِ", 2, 1), w(5, "٤٢", 2, 1, "end")],
    }]
    a = build_surah({"id": 55, "name": "الرحمن"}, verses)["verses"][0]
    assert {wd["ln"] for wd in a["words"]} == {1} and a["end_ln"] == 1
