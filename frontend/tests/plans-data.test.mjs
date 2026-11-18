// Run (in frontend/): node --test tests/*.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AMOUNTS, cutPage, juzProgress, knownPages, portions, today, toRanges, toSegs } from "../js/plans-data.js";

const index = JSON.parse(readFileSync(new URL("../data/plans/mushaf.json", import.meta.url), "utf8"));
const ayahCount = (list) => list.flatMap((p) => p.segs).reduce((n, s) => n + s.to - s.from + 1, 0);

test("the index covers the whole mushaf", () => {
  assert.equal(index.pages.length, 604);
  assert.equal(index.juz.length, 30);
  assert.equal(index.juz[29], 582); // جزء عمّ
  assert.equal(index.pages.flat().length, 6236);
});

test("every amount and direction memorizes each ayah exactly once", () => {
  for (const a of AMOUNTS) {
    for (const dir of ["back", "fwd"]) {
      const list = portions(index, { dir, known: 0, amount: a.id });
      assert.equal(ayahCount(list), 6236, `${a.id} ${dir}`);
    }
  }
  assert.equal(portions(index, { dir: "fwd", known: 0, amount: "page" }).length, 604);
  assert.equal(portions(index, { dir: "fwd", known: 0, amount: "2pages" }).length, 302);
});

test("direction and prior memorization set the starting page", () => {
  const back = portions(index, { dir: "back", known: 0, amount: "page" });
  assert.deepEqual(back[0].pages, [604]);
  assert.deepEqual(back[0].segs.map((s) => s.s), [112, 113, 114]);
  const afterAmma = portions(index, { dir: "back", known: 1, amount: "page" });
  assert.deepEqual(afterAmma[0].pages, [581]);
  assert.equal(knownPages(index, 1).length, 23);
  const fwd = portions(index, { dir: "fwd", known: 1, amount: "2pages" });
  assert.deepEqual(fwd[0].pages, [1, 2]);
  assert.deepEqual(fwd.at(-1).pages, [581]); // odd page left alone at the end
});

test("a page is cut by the line each ayah starts on", () => {
  const p604 = cutPage(index.pages[603], 2);
  // the half cut (line 8) moves to the start of الفلق, so no surah is split
  assert.deepEqual(toSegs(p604[0]), [{ s: 112, from: 1, to: 4 }]);
  assert.deepEqual(toSegs(p604[1]), [{ s: 113, from: 1, to: 5 }, { s: 114, from: 1, to: 6 }]);
  assert.equal(cutPage(index.pages[1], 2).length, 1); // page 2 is a short opening page (lines 3–7)
  const p3 = cutPage(index.pages[2], 2); // البقرة ٦–١٦, no surah start to snap to; ١٢ starts on line 8
  assert.deepEqual(p3.map((g) => toSegs(g)), [[{ s: 2, from: 6, to: 12 }], [{ s: 2, from: 13, to: 16 }]]);
  assert.equal(cutPage(index.pages[47], 3).length, 1); // page 48: one long ayah (آية الدين)
});

test("review: near keeps the last 20 pages, far rotates through the rest weekly", () => {
  const plan = { dir: "fwd", known: 1, amount: "page", days: 5 };
  const list = portions(index, plan);
  const t0 = today(index, plan, list, { done: 0, day: 0 });
  assert.equal(t0.nearCount, 0);
  assert.equal(t0.farTotal, 23); // جزء عمّ, already known
  assert.equal(t0.cycle, 6);     // 23 pages, 4 a day

  const t = today(index, plan, list, { done: 30, day: 0 });
  assert.deepEqual(t.near, [[11, 30]]);
  assert.equal(t.farTotal, 10 + 23);
  const seen = new Set();
  for (let d = 0; d < t.cycle; d++) {
    for (const [a, b] of today(index, plan, list, { done: 30, day: d }).far) for (let p = a; p <= b; p++) seen.add(p);
  }
  assert.equal(seen.size, 33);
});

test("review with cut pages: a page joins far review only once all its parts are old", () => {
  const plan = { dir: "fwd", known: 0, amount: "third", days: 7 };
  const list = portions(index, plan);
  const t = today(index, plan, list, { done: 25, day: 0 });
  assert.ok(t.nearCount <= 20 && t.nearCount >= 6);
  const near = new Set(t.near.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i)));
  for (const [a, b] of t.far) for (let p = a; p <= b; p++) assert.ok(!near.has(p));
});

test("helpers", () => {
  assert.deepEqual(toRanges([5, 3, 4, 9, 10, 4]), [[3, 5], [9, 10]]);
  const plan = { dir: "back", known: 1, amount: "page" };
  const prog = juzProgress(index, plan, portions(index, plan), 0);
  assert.equal(prog[29], 1);
  assert.equal(prog[0], 0);
});

test("every page is named by its first three words, in the mushaf's spelling", () => {
  assert.equal(index.names.length, 604);
  assert.ok(index.names.every((n) => n.split(" ").length === 3));
  const letters = (t) => t.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "");
  assert.equal(letters(index.names[498 - 1]), "\u0625\u0646 \u064A\u0648\u0645 \u0671\u0644\u0641\u0635\u0644"); // إن يوم الفصل
  assert.equal(letters(index.names[604 - 1]), "\u0642\u0644 \u0647\u0648 \u0671\u0644\u0644\u0647"); // قل هو الله
});

test("the 60 hizbs start in order, each on the page of its first ayah", () => {
  assert.equal(index.hizb.length, 60);
  assert.deepEqual(index.hizb[0], [1, 1, 1]);
  index.hizb.forEach(([p, s, a], i) => {
    assert.ok(index.pages[p - 1].some(([ps, pa]) => ps === s && pa === a), `hizb ${i + 1}`);
    if (i) assert.ok(p >= index.hizb[i - 1][0]);
  });
  assert.equal(index.hizb[39][0], 392); // الحزب ٤٠: القصص ٥١
});
