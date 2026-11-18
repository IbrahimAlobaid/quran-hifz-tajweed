# مُعين الحفظ — Spec

A local web app to help memorize the Holy Quran by **listening and following**:
select ayahs, pick a reciter, loop them, watch the reciter's current word highlighted
live, and study the tajweed rules of every word.

**Out of scope (by request):** recitation error detection / recording the user.

## 1. Goals & acceptance criteria

| # | Feature | Done when |
|---|---------|-----------|
| F1 | Pick surah + ayah range (from → to) | Any of 114 surahs; range validated against ayah count |
| F2 | Pick reciter | 14 reciters that have word-level timings (Quran.com QDC) |
| F3 | Repetition engine | Repeat each ayah N× (or ∞), repeat whole range M× (or ∞), optional pause between repeats (fixed seconds or ×ayah length, for "repeat after the reciter"), speed 0.5–1.5× |
| F4 | Live word tracking | The word being recited is highlighted in sync; click a word to seek there; current ayah auto-scrolls |
| F5 | Tajweed display | Letters coloured per rule (Quran.com markup), legend, toggle on/off, focus a single rule |
| F6 | Tajweed audit (التدقيق) | Click a word → panel with each rule: name, category, harakat count, the triggering letters and *why* the rule applies (e.g. «نون ساكنة بعدها ت ← إخفاء»). Per-ayah rule summary |
| F7 | Memorization aids | Hide-text modes: hidden / first letter / reveal as recited; word-by-word audio on demand |
| F8 | Offline-friendly | Text, timings and audio cached to disk after first use; `prefetch.py` to warm everything |
| F9 | Persistence | Last selection + settings restored from localStorage |
| F10| Keyboard | Space play/pause, ←/→ next/prev ayah, R toggle repeat, T toggle tajweed |

## 2. Data sources (verified 2026-11-18)

| Need | Source |
|------|--------|
| Uthmani words + tajweed markup per word | `api.quran.com/api/v4/verses/by_chapter/{n}?words=true&word_fields=text_uthmani,text_uthmani_tajweed` |
| Reciters with word timings | `api.qurancdn.com/api/qdc/audio/reciters` |
| Chapter audio + `verse_timings[].segments=[[word_pos,start_ms,end_ms]]` | `api.qurancdn.com/api/qdc/audio/reciters/{id}/audio_files?chapter={n}&segments=true` |
| Word-by-word audio | `audio.qurancdn.com/{word.audio_url}` |
| Surah names | reference repo `quran_data.json` metadata pattern (rebuilt from API) |

The reference repo's bundled dataset ships with **empty** tajweed arrays (its raw
cpfair file is not committed), so tajweed comes from Quran.com's markup instead.

### Why timings instead of running the alignment model live
The reference repo's `obadx/muaalem` forced-alignment pipeline needs ~5 GB of models and a
GPU per request. The QDC segments are themselves the output of forced alignment over
professional recordings, reviewed, and available for 14 reciters. We consume them, sanitise
malformed entries (e.g. `[1]`), and fill gaps by interpolation. An optional local aligner
(reusing the repo's `forced_alignment.py`) is Phase 2 — it would add letter-level tracking
and reciters without published timings.

## 3. Architecture

```
frontend (vanilla ES modules, no build)        backend (FastAPI)
 ├─ api.js      ── fetch ──▶  /api/surahs, /api/surah/{n}, /api/reciters,
 ├─ player.js   (loop engine,  /api/timings/{rid}/{n}, /api/audio/{rid}/{n},
 │              rAF tracking)   /api/wbw/{path}, /api/tajweed/rules
 ├─ view.js     (render words from structured segments — never raw remote HTML)
 ├─ tajweed.js  (legend, audit panel)          services/
 └─ store.js    (settings, localStorage)        ├─ quran_api.py    fetch+parse+disk cache
                                                ├─ audio_service.py reciters, timings, mp3 cache
                                                ├─ tajweed_rules.py rule catalog (single source)
                                                └─ tajweed_audit.py markup parser + reason engine
```

* Remote tajweed HTML is parsed **server-side** into `segments: [{t, r}]` with rule classes
  allow-listed; the UI builds DOM with `textContent` only (no XSS surface).
* Audio: served from disk cache with HTTP Range (needed for seeking); on cache miss the
  backend redirects to the CDN and downloads in the background.

## 4. Phases
1. **MVP (this delivery):** F1–F10.
2. Optional local aligner (GPU) for letter-level tracking + more reciters (everyayah).
3. Memorization tracker (spaced-repetition of reviewed ranges).
