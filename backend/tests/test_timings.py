from app.services.audio_service import ayah_reciters, ayah_timings, is_per_ayah, sanitize_timings


def test_ayah_by_ayah_reciter_gets_one_file_per_ayah():
    rid = ayah_reciters()[0]["id"]
    assert is_per_ayah(rid) and not is_per_ayah(7)
    t = ayah_timings(rid, 2, 286)
    assert t["per_ayah"] and len(t["verses"]) == 286
    last = t["verses"][-1]
    assert (last["n"], last["segs"]) == (286, [])
    assert last["url"].endswith("/Ayman_Sowaid_64kbps/002286.mp3")


def test_sanitize_drops_malformed_and_sorts():
    raw = {
        "audio_url": "https://x/1.mp3",
        "duration": 46000.0,
        "verse_timings": [
            {"verse_key": "1:3", "timestamp_from": 11680, "timestamp_to": 16300,
             "segments": [[2, 12855.0, 16180.0], [1], [1, 11615, 12855], [2], [3, 500, 400]]},
            {"verse_key": "1:1", "timestamp_from": 0, "timestamp_to": 6090, "segments": [[1, 0, 580]]},
        ],
    }
    t = sanitize_timings(raw)
    assert [v["n"] for v in t["verses"]] == [1, 3]
    assert t["verses"][1]["segs"] == [[1, 11615, 12855], [2, 12855, 16180]]
    assert t["duration"] == 46000


def test_missing_verse_bounds_are_derived_from_words():
    raw = {"audio_url": "x", "duration": 1, "verse_timings": [
        {"verse_key": "101:3", "timestamp_from": None, "timestamp_to": None,
         "segments": [[2, 10205, 11629], [1, 8117, 10205]]},
        {"verse_key": "101:4", "timestamp_from": None, "timestamp_to": None, "segments": []},
    ]}
    t = sanitize_timings(raw)
    assert [(v["n"], v["from"], v["to"]) for v in t["verses"]] == [(3, 8117, 11629)]
