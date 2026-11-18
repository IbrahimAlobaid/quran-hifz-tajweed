/** Names and lookups for the Madinah mushaf (604 pages, 30 juz). */
export const JUZ_NAMES = [
  "الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر",
  "الحادي عشر", "الثاني عشر", "الثالث عشر", "الرابع عشر", "الخامس عشر", "السادس عشر", "السابع عشر",
  "الثامن عشر", "التاسع عشر", "العشرون", "الحادي والعشرون", "الثاني والعشرون", "الثالث والعشرون",
  "الرابع والعشرون", "الخامس والعشرون", "السادس والعشرون", "السابع والعشرون", "الثامن والعشرون",
  "التاسع والعشرون", "الثلاثون",
];
export const juzName = (n) => `الجزء ${JUZ_NAMES[n - 1] || n}`;

let index = null;
/** data/plans/mushaf.json: {juz: [start page], pages: [[[s, a, line]]]} — loaded once. */
export async function mushafIndex() {
  return (index ||= fetch("data/plans/mushaf.json").then((r) => {
    if (!r.ok) throw new Error("تعذّر تحميل فهرس صفحات المصحف.");
    return r.json();
  }).catch((e) => { index = null; throw e; }));
}

/** Juz of a page (1–30) and the surah its first ayah belongs to. */
export function pageInfo(idx, p) {
  let juz = 1;
  for (let j = 0; j < 30; j++) if (idx.juz[j] <= p) juz = j + 1;
  return { juz, surah: idx.pages[p - 1][0][0] };
}
