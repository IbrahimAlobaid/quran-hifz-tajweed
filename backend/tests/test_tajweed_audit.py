from app.services.quran_api import build_surah
from app.services.tajweed_audit import annotate_word, parse_markup


def test_parse_simple_and_merge():
    segs = parse_markup("يُ<rule class=ikhafa>نف</rule>ِق<rule class=madda_permissible>ُو</rule>نَ")
    assert segs == [
        {"t": "يُ"},
        {"t": "نف", "r": "ikhafa"},
        {"t": "ِق"},
        {"t": "ُو", "r": "madda_permissible"},
        {"t": "نَ"},
    ]


def test_parse_nested_ignored_class_inherits_outer_rule():
    segs = parse_markup("دّ<rule class=madda_normal><rule class=custom-alef-maksora>ٰ</rule></rule>ر")
    assert segs == [{"t": "دّ"}, {"t": "ٰ", "r": "madda_normal"}, {"t": "ر"}]


def test_parse_drops_unknown_classes_and_tags():
    segs = parse_markup('a<rule class=evil onload=x>b</rule><script>c</script>')
    assert "".join(s["t"] for s in segs) == "abc"
    assert all("r" not in s for s in segs)


def test_ikhfa_inside_word_names_trigger_letter():
    segs = parse_markup("يُ<rule class=ikhafa>نف</rule>ِقُونَ")
    [r] = annotate_word(segs, {"ayah": 3, "is_last": False, "prev_word": None, "next_word": None})
    assert r["role"] == "source" and "«ف»" in r["note"] and "نون ساكنة" in r["note"]


def test_tanween_source_and_target_across_words():
    src = annotate_word(parse_markup("هُ<rule class=idgham_ghunnah>دًى</rule>"),
                        {"ayah": 5, "is_last": False, "prev_word": None, "next_word": "مِّن"})
    assert src[0]["role"] == "source" and "تنوين" in src[0]["note"] and "«م»" in src[0]["note"]
    tgt = annotate_word(parse_markup("<rule class=idgham_ghunnah>م</rule>ّ"),
                        {"ayah": 5, "is_last": False, "prev_word": "هُدًى", "next_word": None})
    assert tgt[0]["role"] == "target" and "هُدًى" in tgt[0]["note"]


def test_qalqalah_kubra_at_ayah_end():
    [r] = annotate_word(parse_markup("ٱلۡفَلَ<rule class=qalaqah>ق</rule>ِ"),
                        {"ayah": 1, "is_last": True, "prev_word": None, "next_word": None})
    assert "كبرى" in r["note"]


def test_muqattaat_is_harfi_madd():
    segs = parse_markup("ا<rule class=madda_necessary>لٓ</rule><rule class=madda_necessary>مٓ</rule>")
    rules = annotate_word(segs, {"ayah": 1, "is_last": True, "prev_word": None, "next_word": None})
    assert len(rules) == 2 and all("حرفي" in r["note"] for r in rules)


def test_build_surah_structure_and_cross_ayah_context():
    def w(pos, tj, kind="word"):
        return {"position": pos, "char_type_name": kind, "text_uthmani": tj, "text_uthmani_tajweed": tj, "audio_url": None}

    verses = [
        {"verse_number": 1, "verse_key": "9:1", "words": [w(1, "مِ<rule class=ikhafa>ن</rule>"), w(2, "١", "end")]},
        {"verse_number": 2, "verse_key": "9:2", "words": [w(1, "<rule class=ikhafa>ق</rule>َبۡلِ")]},
    ]
    s = build_surah({"id": 9}, verses)
    a1, a2 = s["verses"]
    assert a1["end"] == "١" and len(a1["words"]) == 1
    assert "«ق»" in a1["words"][0]["rules"][0]["note"]
    assert a2["words"][0]["rules"][0]["role"] == "target"
