from app.services.audio_service import sanitize_timings


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
