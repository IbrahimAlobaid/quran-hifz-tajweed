const memo = new Map();

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

export const api = {
  surahs: () => get("/api/surahs"),
  surah: (n) => get(`/api/surah/${n}`),
  reciters: () => get("/api/reciters"),
  rules: () => get("/api/tajweed/rules"),
  timings: (rid, n) => get(`/api/timings/${rid}/${n}`),
  cacheState: async (rid, n) => (await fetch(`/api/timings/${rid}/${n}`).then((r) => r.json())).cache,
  wbwUrl: (path) => `/api/wbw/${path}`,
};
