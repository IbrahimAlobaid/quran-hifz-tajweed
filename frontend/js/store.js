const KEY = "hifz.v1";

const DEFAULTS = {
  unit: "page",      // "page" (a full mushaf page) | "ayahs" (surah + range)
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
  sideTab: "tajweed", // "tajweed" | "tafsir" | "mut"
  tafsir: "muyassar",
  tafsirScope: "ayah", // "ayah" | "all"
  // the reading page: five switches, page-grid order, the side panel on wide screens
  showTafsir: true, showTajweed: true, showMut: true, withReciter: true, detailed: false,
  navBy: "juz",      // "juz" | "surah"
  panelOpen: true,
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
