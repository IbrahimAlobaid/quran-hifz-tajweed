// Run (in frontend/): node --test tests/*.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { createTafsirStore, groupSurah, LEVELS, mergePassages, SOURCES } from "../js/tafsir-data.js";

test("every level has sources and every source a provider key", () => {
  assert.deepEqual(LEVELS.map((l) => l.name), ["مختصر", "متوسط", "موسّع"]);
  for (const s of SOURCES.values()) assert.ok(s.p === "qc" ? s.rid : s.slug, s.id);
});

test("per-surah text: repeated or empty text joins the previous passage", () => {
  const g = groupSurah([
    { ayah: 2, text: "B" }, { ayah: 1, text: "A" }, { ayah: 3, text: "B" }, { ayah: 4, text: "" }, { ayah: 5, text: "C" },
  ]);
  assert.deepEqual([g.get(1).from, g.get(1).to], [1, 1]);
  assert.equal(g.get(2), g.get(4));
  assert.deepEqual([g.get(3).from, g.get(3).to], [2, 4]);
  assert.equal(g.get(5).body, "C");
});

test("Quran.com: an ayah answering 404 belongs to the passage before it", async () => {
  const seen = [];
  const store = createTafsirStore(async (url) => {
    seen.push(url);
    const k = url.split(":").pop();
    if (k === "10") return { tafsir: { verses: { "78:10": {} }, text: "<p>ten</p>" } };
    if (k === "11") return null;
    if (k === "2") return { tafsir: { verses: { "78:2": {}, "78:3": {} }, text: "<p>two-three</p>" } };
    return null;
  });
  const e11 = await store.entry("saadi", 78, 11);
  assert.deepEqual([e11.from, e11.to, e11.body], [10, 11, "<p>ten</p>"]);
  const e3 = await store.entry("muyassar", 78, 3);
  assert.deepEqual([e3.from, e3.to], [2, 3]);
  assert.ok(seen.includes("https://api.quran.com/api/v4/tafsirs/91/by_ayah/78:10"));
});

test("merging a range keeps passages in order and collapses shared ones", () => {
  const p = { from: 10, to: 10, body: "x" };
  const q = { from: 10, to: 11, body: "x" };
  const r = { from: 12, to: 12, body: "y" };
  const r2 = { from: 13, to: 13, body: "y" }; // same text repeated under the next ayah
  const blocks = mergePassages([{ n: 10, e: p }, { n: 11, e: q }, { n: 12, e: r }, { n: 13, e: r2 }, { n: 14, e: null }]);
  assert.deepEqual(blocks.map((b) => [b.from, b.to, b.ayahs]), [[10, 11, [10, 11]], [12, 13, [12, 13]], [14, 14, [14]]]);
});
