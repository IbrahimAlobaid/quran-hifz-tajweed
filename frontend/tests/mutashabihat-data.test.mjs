// Run (in frontend/): node --test tests/*.test.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { blockWords, compare, gaps, norm, question } from "../js/mutashabihat-data.js";

const dir = new URL("../data/mutashabihat/", import.meta.url);
const load = (f) => JSON.parse(readFileSync(new URL(f, dir), "utf8"));
const daw = load("dawabit.json");
const T = daw.text;
const marked = (words, marks, kind) => words.filter((_, i) => marks[i] === kind).map(norm);

test("context-only marks don't make two words different", () => {
  assert.equal(norm("لَّا"), norm("لَا"));                  // idgham shadda from the word before
  assert.equal(norm("أَوۡلَـٰدَكُم"), norm("أَوۡلَـٰدَكُمۡ"));    // sukun hidden before ikhfa
  assert.equal(norm("إِبۡرٰهِــۧمَ"), norm("إِبۡرٰهِيمَ"));      // البقرة's spelling, read the same
  assert.equal(norm("حُسۡنًا‌ۖ"), norm("حُسۡنًا"));             // waqf sign
  assert.notEqual(norm("يُنزَفُونَ"), norm("يُنزِفُونَ"));       // a real vowel difference stays
});

test("a one-word substitution is marked as nearly the same word", () => {
  const c = compare(T["29:8"], T["46:15"]);
  assert.deepEqual(marked(T["29:8"], c.a, "near"), [norm("حُسۡنًا")]);
  assert.deepEqual(marked(T["46:15"], c.b, "near"), [norm("إِحۡسَـٰنًا")]);
  assert.ok(c.a.includes("out") && c.b.includes("out")); // the long rest is folded into «…»
});

test("an addition is marked on the longer side only", () => {
  const c = compare(T["2:136"], T["3:84"]);
  // قولوا/قل differ; «وما أوتي» is extra in البقرة; إلينا/علينا and النبيون/والنبيون nearly the same
  assert.deepEqual(marked(T["2:136"], c.a, "diff"), [0, 18, 19].map((i) => norm(T["2:136"][i])));
  assert.deepEqual(marked(T["3:84"], c.b, "diff"), [norm(T["3:84"][0])]);
  assert.deepEqual(marked(T["3:84"], c.b, "near"), [5, 8, 18].map((i) => norm(T["3:84"][i])));
  assert.ok(!c.a.includes("out") && !c.b.includes("out"));
});

test("practice questions hide the real difference", () => {
  const q = question(T["37:47"], T["56:19"]);
  assert.deepEqual([norm(q.answer), norm(q.other)], [norm("يُنزَفُونَ"), norm("يُنزِفُونَ")]);
  const q2 = question(T["6:151"], T["17:31"]);
  assert.deepEqual([norm(q2.answer), norm(q2.other)], [norm("نَرۡزُقُكُمۡ"), norm("نَرۡزُقُهُمۡ")]);
  const g = gaps(compare(T["2:12"], T["2:13"]));
  assert.ok(g.length >= 2);
});

test("imported groups: 0-based source numbers map to the right ayahs", () => {
  const s2 = load("002.json");
  const g = s2.groups.find((x) => x.src[0] === "2:3");
  assert.ok(g.muts.some((m) => m[0] === "8:3")); // الذين ... ويقيمون الصلاة ومما رزقناهم ينفقون
  const c = compare(blockWords(s2.text, ["2:3"]).words, blockWords(s2.text, ["8:3"]).words);
  assert.ok(c.shared >= 5);
});

test("every surah file has the text of every ayah it mentions", () => {
  const index = load("index.json");
  let groups = 0;
  for (const f of readdirSync(dir).filter((x) => /^\d{3}\.json$/.test(x))) {
    const d = load(f);
    assert.equal(index.surahs[String(d.s)], d.groups.length, f);
    for (const g of d.groups) {
      groups++;
      for (const k of [...g.src, ...g.muts.flat()]) assert.ok(d.text[k]?.length, `${f} ${k}`);
      for (const [i, n] of Object.entries(g.notes || {})) assert.ok(g.muts[+i] && n.dabit, f);
    }
  }
  assert.equal(groups, index.total);
});

test("every rule example is a real, similar pair", () => {
  const ids = daw.rules.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of daw.rules) for (const ex of r.examples) {
    assert.ok(compare(T[ex.a], T[ex.b]).shared >= 1, `${ex.a} ${ex.b}`);
  }
});
