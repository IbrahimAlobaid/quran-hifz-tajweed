/**
 * «المتشابهات» — word-level comparison of similar verses, with no DOM (tested in Node).
 *
 * The text is never changed: words are compared on a normalised copy, and the
 * result only says which displayed words are shared and which differ.
 */

// Marks that depend on the next word or on stopping, not on the word itself:
// waqf signs, the end-of-ayah sign, iqlab/idgham meem, the silah waw/ya after
// هـ, joiners and tatweel.
const DROP = /[ـۖ-۝۞۟ۢۥۦ۩ۭ‌‍]/g;
const OPEN_TANWEEN = { "ࣰ": "ً", "ࣱ": "ٌ", "ࣲ": "ٍ" };

/**
 * A word reduced to what tells it apart from another word, ignoring what the
 * neighbouring word decides: sukun shown or not (ikhfa/idgham), a shadda on
 * the first letter (idgham from the word before), open or plain tanween.
 * The small high ya (إبرٰهِــۧم) reads as ي.
 */
export function norm(w) {
  return w.replace(DROP, "").replace(/ۧ/g, "ي")
    .replace(/[ࣰ-ࣲ]/g, (c) => OPEN_TANWEEN[c])
    .replace(/[ْۡ]/g, "")
    .replace(/^(\S)([ً-ّٰ]*)/, (_, c, marks) => c + marks.replace(/ّ/g, ""))
    .trim();
}

/** The letters only: no vowels, one alef for all its forms, ى→ي, ة→ه. */
export function skeleton(w) {
  return norm(w).replace(/[ً-ٰٟ۠-ۭٕٔ]/g, "")
    .replace(/[أإآٱءٲٳ]/g, "ا").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/ة/g, "ه");
}

function oneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * 2 = the same word; 1 = nearly the same (a vowel, a letter, or a leading
 * و/ف apart: يُنزَفون/يُنزِفون، ءاتية/لأتية، فكلوا/وكلوا); 0 = different.
 */
export function likeness(a, b) {
  if (a.n === b.n) return 2;
  if (a.k === b.k) return 1;
  const ka = a.k.replace(/^[وف]/, ""), kb = b.k.replace(/^[وف]/, "");
  if (ka === kb && ka.length >= 2) return 1;
  return Math.min(a.k.length, b.k.length) >= 3 && oneEdit(a.k, b.k) ? 1 : 0;
}

/** Best alignment of two word lists (same words count double) → [[i, j, likeness], ...]. */
export function align(A, B) {
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  const eq = Array.from({ length: n }, (_, i) => Uint8Array.from(B, (b) => likeness(A[i], b)));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const e = eq[i][j];
      dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1], e ? dp[i + 1][j + 1] + e : 0);
    }
  }
  const pairs = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    const e = eq[i][j];
    if (e && dp[i][j] === dp[i + 1][j + 1] + e) { pairs.push([i, j, e]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

const prep = (w) => ({ n: norm(w), k: skeleton(w) });

/**
 * Compare two passages (lists of words).
 * In long passages a lone shared word far from the rest (like «الله») is not
 * a real match, so only runs of two or more words count there, plus single
 * words between two such runs. Short passages (≤ 10 words) keep every match.
 * Returns {a: marks, b: marks, shared, windowA, windowB, pairs} with
 * marks[i] = "same" | "near" (the same word with a small change) | "diff" |
 * "out" (far from the shared part, shown as «…»).
 */
export function compare(aWords, bWords, { pad = 2 } = {}) {
  const A = aWords.map(prep), B = bWords.map(prep);
  const short = Math.min(A.length, B.length) <= 10;
  const runs = [];
  for (const p of align(A, B)) {
    const r = runs.at(-1);
    if (r && p[0] === r.at(-1)[0] + 1 && p[1] === r.at(-1)[1] + 1) r.push(p);
    else runs.push([p]);
  }
  const strong = runs.filter((r) => r.length >= 2 || short);
  const kept = strong.length ? runs.filter((r) => r[0][0] >= strong[0][0][0] && r.at(-1)[0] <= strong.at(-1).at(-1)[0]) : [];
  const pairs = kept.flat();
  const ma = new Map(pairs.map((p) => [p[0], p[2]])), mb = new Map(pairs.map((p) => [p[1], p[2]]));
  const window = (len, set) => {
    if (!set.size) return [0, len - 1];
    let lo = Math.max(0, Math.min(...set.keys()) - pad), hi = Math.min(len - 1, Math.max(...set.keys()) + pad);
    if (lo <= 3) lo = 0;            // don't hide two or three words behind «…»
    if (len - 1 - hi <= 3) hi = len - 1;
    return [lo, hi];
  };
  const wa = window(A.length, ma), wb = window(B.length, mb);
  const marks = (len, map, [lo, hi]) => Array.from({ length: len }, (_, i) =>
    (i < lo || i > hi ? "out" : map.get(i) === 2 ? "same" : map.get(i) === 1 ? "near" : "diff"));
  return {
    a: marks(A.length, ma, wa), b: marks(B.length, mb, wb),
    shared: pairs.length, exact: pairs.filter((p) => p[2] === 2).length,
    windowA: wa, windowB: wb, pairs,
  };
}

/**
 * Where two passages part, best first: nearly-same word pairs, the gaps
 * between shared words, the first words after the shared part ends, and a
 * different opening word.
 * [{a: [i...], b: [j...], near?: true}]
 */
export function gaps(cmp) {
  const ps = cmp.pairs;
  const out = ps.filter((p) => p[2] === 1).map(([i, j]) => ({ a: [i], b: [j], near: true }));
  if (!ps.length) return out;
  const [fi, fj] = ps[0], [li, lj] = ps.at(-1);
  for (let k = 0; k + 1 < ps.length; k++) {
    const [i0, j0] = ps[k], [i1, j1] = ps[k + 1];
    if (i1 - i0 > 1 || j1 - j0 > 1) out.push({ a: range(i0 + 1, i1), b: range(j0 + 1, j1) });
  }
  if (li < cmp.a.length - 1 && lj < cmp.b.length - 1) out.push({ a: [li + 1], b: [lj + 1] });
  // a different first word only when both passages open with it (قل/قال)
  if (fi === 1 && fj === 1) out.push({ a: [0], b: [0] });
  return out;
}

/**
 * A fill-in question from one similar pair: passage A with one differing span
 * hidden, and the two wordings to choose from. Nearly-same words make the best
 * questions (a vowel or a letter apart); then short substitutions (1–3 words
 * a side). Returns null when there is no clean question.
 */
export function question(aWords, bWords) {
  const cmp = compare(aWords, bWords);
  const g = gaps(cmp).find((x) => x.a.length && x.b.length && x.a.length <= 3 && x.b.length <= 3);
  if (!g) return null;
  const strip = (ws) => ws.map((w) => w.replace(DROP, "")).join(" ");
  const answer = strip(g.a.map((i) => aWords[i])), other = strip(g.b.map((j) => bWords[j]));
  if (norm(answer) === norm(other)) return null;
  const lo = Math.min(cmp.windowA[0], g.a[0]), hi = Math.max(cmp.windowA[1], g.a.at(-1));
  return {
    before: aWords.slice(lo, g.a[0]), after: aWords.slice(g.a.at(-1) + 1, hi + 1),
    cutStart: lo > 0, cutEnd: hi < aWords.length - 1,
    answer, other,
  };
}

/** "2:3" → [2, 3] */
export const parseKey = (k) => k.split(":").map(Number);

/** Words of a block of ayahs (plus the next ayah when the group asks for context). */
export function blockWords(text, keys, ctxKey = null) {
  const words = [], from = [];
  for (const k of keys) for (const w of text[k] || []) { words.push(w); from.push(k); }
  if (ctxKey && text[ctxKey]) for (const w of text[ctxKey]) { words.push(w); from.push(ctxKey); }
  return { words, from };
}

/** Per-surah data, fetched once: createMutStore(fetchJson).surah(n) → {groups, text, bySrc}. */
export function createMutStore(fetchJson) {
  const memo = new Map();
  let index = null;
  return {
    async index() { return (index ||= fetchJson("data/mutashabihat/index.json")); },
    async dawabit() { return fetchJson("data/mutashabihat/dawabit.json"); },
    async surah(n) {
      const idx = await this.index();
      if (!idx.surahs[String(n)]) return { s: n, groups: [], text: {}, bySrc: new Map() };
      if (!memo.has(n)) {
        const p = fetchJson(`data/mutashabihat/${String(n).padStart(3, "0")}.json`).then((d) => {
          const bySrc = new Map();
          for (const g of d.groups) for (const k of g.src) {
            if (!bySrc.has(k)) bySrc.set(k, []);
            bySrc.get(k).push(g);
          }
          return { ...d, bySrc };
        });
        p.catch(() => memo.delete(n));
        memo.set(n, p);
      }
      return memo.get(n);
    },
  };
}

function range(a, b) {
  const out = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
}
