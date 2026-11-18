const KEY = "hifz.v1";

const DEFAULTS = {
  unit: "ayahs",     // "ayahs" (surah + range) | "page" (a full mushaf page)
  surah: 78, from: 1, to: 5,
  page: 582,
  rid: 7,
  ayahRepeat: 3,     // 0 = ∞
  rangeRepeat: 1,    // 0 = ∞
  gap: "0",          // "0" | seconds | "x<ratio>"
  rate: 1,
  tajweed: true,
  palette: "maarifa",
  hideMode: "show",
  dim: true,
  qSize: null,
  theme: null,
  sideTab: "tajweed", // "tajweed" | "tafsir"
  tafsir: "muyassar",
  tafsirScope: "ayah", // "ayah" | "all"
};

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch { return { ...DEFAULTS }; }
}

export const settings = load();

export function save(patch) {
  Object.assign(settings, patch);
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
}
