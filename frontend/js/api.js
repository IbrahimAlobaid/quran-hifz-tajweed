/**
 * Data access in two modes, chosen by <meta name="hifz-mode"> in index.html:
 *   server — the local FastAPI backend (/api/*): fetches, caches, serves audio.
 *   static — a pre-exported build (backend/scripts/export_static.py) hosted on
 *            any static host; JSON comes from data/static/, audio and word
 *            clips stream straight from the Quran.com CDNs.
 */
const MODE = document.querySelector('meta[name="hifz-mode"]')?.content === "static" ? "static" : "server";
const WBW_CDN = "https://audio.qurancdn.com";
const SURAH_SCHEMA = 2;
const memo = new Map();
const pad = (n) => String(n).padStart(3, "0");

async function get(path) {
  if (memo.has(path)) return memo.get(path);
  const p = fetch(path).then(async (r) => {
    if (!r.ok) {
      let msg = `خطأ ${r.status}`;
      try { msg = (await r.json()).detail || msg; } catch {}
      throw new Error(msg);
    }
    return r.json();
  });
  memo.set(path, p);
  p.catch(() => memo.delete(path)); // allow retry after a failure
  return p;
}

/** Timings carry two audio URLs: `audio` for the player (cached locally in
 *  server mode) and `stream` for short lesson clips (never triggers caching). */
async function timings(rid, n) {
  if (MODE === "static") {
    const t = await get(`data/static/timings/${rid}/${pad(n)}.json`);
    return { ...t, audio: t.audio_url, stream: t.audio_url };
  }
  const t = await get(`/api/timings/${rid}/${n}`);
  return { ...t, stream: `${t.audio}?cache=0` };
}

export const api = {
  mode: MODE,
  surahs: () => get(MODE === "static" ? "data/static/surahs.json" : "/api/surahs"),
  // ?v= busts the day-long CDN cache whenever the surah schema changes (v2: page/line per word).
  surah: (n) => get(MODE === "static" ? `data/static/surah/${pad(n)}.json?v=${SURAH_SCHEMA}` : `/api/surah/${n}`),
  reciters: () => get(MODE === "static" ? "data/static/reciters.json" : "/api/reciters"),
  rules: () => get(MODE === "static" ? "data/static/tajweed-rules.json" : "/api/tajweed/rules"),
  timings,
  /** Local audio cache state (server mode only). */
  cacheState: async (rid, n) => {
    if (MODE === "static") return null;
    return (await fetch(`/api/timings/${rid}/${n}`).then((r) => r.json())).cache;
  },
  wbwUrl: (path) => (MODE === "static" ? `${WBW_CDN}/${path}` : `/api/wbw/${path}`),
};
