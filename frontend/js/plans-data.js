/**
 * «خطط الحفظ» — the plan logic, with no DOM (tested in Node).
 *
 * A plan cuts the Madinah mushaf (604 pages × 15 lines) into daily portions of
 * new memorization, then derives each day's two review tracks:
 *  - near (مراجعة القريب): what was memorized in the last 20 days, at most 20
 *    pages — «آخر ٢٠ صفحة ملاصقة للحفظ الجديد» (الحصون الخمسة).
 *  - far (مراجعة البعيد): everything older, split so each page comes round once
 *    a week, with at most 40 pages a day (also from الحصون الخمسة).
 *
 * `index` is data/plans/mushaf.json: {juz: [start page × 30], pages: [[[s, a, line]]]}.
 */

export const PAGES = 604;
const LINES = 15;
const NEAR_DAYS = 20, NEAR_MAX_PAGES = 20, FAR_MAX = 40, FAR_CYCLE = 7;

/** Daily amounts. `parts` cuts a page by line; `pages` takes whole pages. */
export const AMOUNTS = [
  { id: "third", parts: 3, pages: 1, name: "ثلث صفحة", hint: "نحو ٥ أسطر" },
  { id: "half", parts: 2, pages: 1, name: "نصف صفحة", hint: "نحو ٧ أسطر" },
  { id: "page", parts: 1, pages: 1, name: "صفحة", hint: "١٥ سطرًا" },
  { id: "2pages", parts: 1, pages: 2, name: "صفحتان", hint: "الحد الأعلى" },
];
export const amountOf = (id) => AMOUNTS.find((a) => a.id === id) || AMOUNTS[2];

export const DEFAULT_PLAN = { dir: "back", known: 0, amount: "page", days: 5 };

/**
 * Split one page's ayahs into up to `parts` groups by the line each ayah starts
 * on. A cut within 3 lines of a surah's start moves to it, so a short surah is
 * not split across two days. A part with no ayah starting in it is dropped (a
 * page holding one long ayah stays one portion).
 */
export function cutPage(entries, parts) {
  const starts = entries.filter((e, i) => i > 0 && e[1] === 1).map((e) => e[2]);
  const cuts = [];
  for (let i = 1; i < parts; i++) {
    const c = (i * LINES) / parts + 0.5; // ayahs starting on a line > c fall after the cut
    const snap = starts.map((l) => l - 0.5).filter((l) => Math.abs(l - c) <= 3).sort((a, b) => Math.abs(a - c) - Math.abs(b - c))[0];
    cuts.push(snap ?? c);
  }
  const groups = new Map();
  for (const e of entries) {
    const i = cuts.filter((c) => e[2] > c).length;
    if (!groups.has(i)) groups.set(i, []);
    groups.get(i).push(e);
  }
  return [...groups.keys()].sort((a, b) => a - b).map((k) => groups.get(k));
}

/** [[s, a, ln], ...] (in mushaf order) → [{s, from, to}] per surah. */
export function toSegs(entries) {
  const segs = [];
  for (const [s, a] of entries) {
    const last = segs.at(-1);
    if (last && last.s === s && last.to === a - 1) last.to = a;
    else segs.push({ s, from: a, to: a });
  }
  return segs;
}

/** Pages already memorized before the plan: the last `known` juz of the mushaf. */
export function knownPages(index, known) {
  if (!known) return [];
  const start = index.juz[30 - known];
  return range(start, PAGES);
}

/** Pages the plan memorizes, in the order they are memorized. */
export function planPages(index, { dir, known }) {
  const end = known ? index.juz[30 - known] - 1 : PAGES;
  const pages = range(1, end);
  return dir === "back" ? pages.reverse() : pages;
}

/**
 * Every portion of the plan, in order:
 * {pages: [p] | [p, q], part, parts, segs}. Two-page portions list pages in
 * mushaf order; `part`/`parts` describe a cut page (1 of 1 for whole pages).
 */
export function portions(index, plan) {
  const amt = amountOf(plan.amount);
  const order = planPages(index, plan);
  const out = [];
  if (amt.pages === 2) {
    for (let i = 0; i < order.length; i += 2) {
      const ps = order.slice(i, i + 2).sort((a, b) => a - b);
      out.push({ pages: ps, part: 1, parts: 1, segs: toSegs(ps.flatMap((p) => index.pages[p - 1])) });
    }
    return out;
  }
  for (const p of order) {
    const groups = cutPage(index.pages[p - 1], amt.parts);
    groups.forEach((g, i) => out.push({ pages: [p], part: i + 1, parts: groups.length, segs: toSegs(g) }));
  }
  return out;
}

/** [3, 4, 5, 9, 10] → [[3, 5], [9, 10]] */
export function toRanges(pages) {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const out = [];
  for (const p of sorted) {
    const last = out.at(-1);
    if (last && last[1] === p - 1) last[1] = p;
    else out.push([p, p]);
  }
  return out;
}

/**
 * The day's three tracks for a plan in progress.
 * progress: {done: portions memorized, day: days logged (drives the far rotation)}.
 */
export function today(index, plan, list, { done, day }) {
  const next = list[done] || null;
  const learned = list.slice(0, done);

  // near: the most recent portions, back to 20 days or 20 pages
  const near = [];
  const nearPages = new Set();
  for (let i = learned.length - 1; i >= 0 && near.length < NEAR_DAYS; i--) {
    const ps = learned[i].pages;
    if (nearPages.size && new Set([...nearPages, ...ps]).size > NEAR_MAX_PAGES) break;
    near.unshift(learned[i]);
    ps.forEach((p) => nearPages.add(p));
  }

  // far: whole pages memorized before the near window, plus the known juz
  const nearStart = learned.length - near.length;
  const done_pages = new Set(knownPages(index, plan.known));
  const partsLeft = new Map(); // page → parts still unlearned before near window
  for (const pt of learned.slice(0, nearStart)) {
    for (const p of pt.pages) {
      const left = (partsLeft.get(p) ?? pt.parts) - 1;
      partsLeft.set(p, left);
      if (left <= 0) done_pages.add(p);
    }
  }
  for (const p of nearPages) done_pages.delete(p);
  const farAll = [...done_pages].sort((a, b) => a - b);
  let far = [], cycle = 0;
  if (farAll.length) {
    const size = Math.min(FAR_MAX, Math.ceil(farAll.length / FAR_CYCLE));
    cycle = Math.ceil(farAll.length / size);
    const k = day % cycle;
    far = farAll.slice(k * size, (k + 1) * size);
  }
  return {
    next,
    near: toRanges([...nearPages]),
    nearCount: nearPages.size,
    far: toRanges(far),
    farCount: far.length,
    farTotal: farAll.length,
    cycle,
  };
}

/** Calendar days to memorize `n` portions at `days` days a week. */
export const calendarDays = (n, days) => Math.ceil((n * 7) / days);

/** Juz-by-juz share memorized (0..1 each), for the progress map. */
export function juzProgress(index, plan, list, done) {
  const have = new Map(); // page → fraction
  for (const p of knownPages(index, plan.known)) have.set(p, 1);
  for (const pt of list.slice(0, done)) {
    for (const p of pt.pages) have.set(p, Math.min(1, (have.get(p) || 0) + 1 / pt.parts));
  }
  return index.juz.map((start, i) => {
    const end = i < 29 ? index.juz[i + 1] - 1 : PAGES;
    let sum = 0;
    for (let p = start; p <= end; p++) sum += have.get(p) || 0;
    return sum / (end - start + 1);
  });
}

function range(a, b) {
  const out = [];
  for (let p = a; p <= b; p++) out.push(p);
  return out;
}
