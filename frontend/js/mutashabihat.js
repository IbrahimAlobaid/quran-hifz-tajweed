/**
 * «المتشابهات»: the similar places of an ayah in the memorize page (side tab
 * and a mark on the ayah number), and the #/mut page — how to tell similar
 * verses apart, finding them by surah, juz or words, and practice.
 * The Quran text is shown as it is; only colour marks the differences.
 */
import { blockWords, compare, createMutStore, parseKey, question, searchKey } from "./mutashabihat-data.js";
import { mushafIndex } from "./mushaf-meta.js";
import { ar, el } from "./util.js";

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("تعذّر تحميل بيانات المتشابهات.");
  return r.json();
}
export const mutStore = createMutStore(fetchJson);

const RULE_NAMES = new Map();
const hifzHash = (q) => `#/?${new URLSearchParams(q)}`;

/** Shared bits of both views: names, next-ayah keys, rendering a comparison. */
class MutBase {
  constructor(surahs) {
    this.meta = new Map(surahs.map((s) => [s.id, s]));
  }

  nextKey(k) {
    const [s, a] = parseKey(k);
    if (a < (this.meta.get(s)?.ayahs || 0)) return `${s}:${a + 1}`;
    return this.meta.has(s + 1) ? `${s + 1}:1` : null;
  }

  ref(keys) {
    const [s, a] = parseKey(keys[0]);
    const b = parseKey(keys.at(-1))[1];
    return `${this.meta.get(s)?.name || ar(s)} ${a === b ? ar(a) : `${ar(a)}–${ar(b)}`}`;
  }

  link(keys, label) {
    const [s, from] = parseKey(keys[0]);
    return el("a", { class: "mut-go", href: hifzHash({ s, from, to: parseKey(keys.at(-1))[1] }), title: "افتحها في صفحة الحفظ" }, label);
  }

  /** One side of a comparison: words with their marks, «…» for hidden runs, ayah numbers between ayahs. */
  passage(block, marks) {
    const p = el("p", { class: "mut-text" });
    let hidden = false;
    block.words.forEach((w, i) => {
      if (i > 0 && block.from[i] !== block.from[i - 1] && marks[i - 1] !== "out") {
        p.append(el("span", { class: "mut-end" }, ar(parseKey(block.from[i - 1])[1])), " ");
      }
      if (marks[i] === "out") {
        if (!hidden) p.append(el("span", { class: "mut-gap", "aria-label": "كلمات محذوفة من العرض" }, "…"), " ");
        hidden = true;
        return;
      }
      hidden = false;
      const ctx = block.ctx && block.from[i] === block.ctx;
      p.append(el("span", { class: `mw mw--${marks[i]}${ctx ? " mw--ctx" : ""}` }, w), " ");
    });
    return p;
  }

  /**
   * Two blocks side by side in the mushaf's order of reading.
   * srcKeys: the ayah(s) we start from; mutKeys: its similar place.
   */
  comparison(text, srcKeys, mutKeys, ctx, note, { here = true } = {}) {
    const A = blockWords(text, srcKeys, ctx ? this.nextKey(srcKeys.at(-1)) : null);
    const B = blockWords(text, mutKeys, ctx ? this.nextKey(mutKeys.at(-1)) : null);
    A.ctx = ctx ? this.nextKey(srcKeys.at(-1)) : null;
    B.ctx = ctx ? this.nextKey(mutKeys.at(-1)) : null;
    const cmp = compare(A.words, B.words);
    const loose = cmp.shared < 2;
    const side = (keys, block, marks, here) => el("div", { class: "mut-side" + (here ? " is-here" : "") },
      el("div", { class: "mut-side__head" }, el("span", { class: "mut-ref" }, this.ref(keys)), here ? el("span", { class: "muted" }, "الآية الحالية") : this.link(keys, "افتح")),
      this.passage(block, loose ? marks.map((m) => (m === "out" ? "out" : "plain")) : marks));
    return el("div", { class: "mut-pair" + (loose ? " is-loose" : "") },
      side(srcKeys, A, cmp.a, here),
      side(mutKeys, B, cmp.b, false),
      loose ? el("p", { class: "mut-loose muted" }, "يتشابه الموضعان في السياق والمعنى أكثر من اللفظ.") : null,
      ctx ? el("p", { class: "mut-ctxnote muted" }, "يظهر معها أول الآية التالية، ففيها يفترق الموضعان.") : null,
      note ? el("p", { class: "mut-dabit" }, el("b", {}, `ضابط (${RULE_NAMES.get(note.rule) || "قاعدة"}): `), note.dabit) : null);
  }
}

export function legend() {
  return el("p", { class: "mut-legend" },
    el("span", { class: "mw mw--diff" }, "كلمة مختلفة أو زائدة"), " ",
    el("span", { class: "mw mw--near" }, "الكلمة نفسها بفرق يسير"), " ",
    el("span", { class: "muted" }, "وما سواهما مشترك."));
}

// ── the side tab in the memorize page ──────────────────
export class MutPanel extends MutBase {
  constructor({ root, tab, surahs }) {
    super(surahs);
    this.root = root;
    this.tab = tab;
    this.active = false;
    this.cur = null;
    this.token = 0;
    mutStore.dawabit().then((d) => d.rules.forEach((r) => RULE_NAMES.set(r.id, r.name))).catch(() => {});
  }

  setActive(on) {
    this.active = on;
    if (on) this.render();
  }

  /** Mark the ayah numbers that have similar places, in the shown selection. */
  async mark(segs, mushaf) {
    for (const { s } of segs) {
      const d = await mutStore.surah(s.id).catch(() => null);
      if (!d) continue;
      for (const k of d.bySrc.keys()) {
        const [ks, kn] = parseKey(k);
        mushaf.querySelectorAll(`.ayah-end[data-s="${ks}"][data-n="${kn}"]`).forEach((e) => {
          e.classList.add("has-mut");
          e.title = `الآية ${ar(kn)}: لها مواضع متشابهة. اضغط للتشغيل من هنا`;
        });
      }
    }
  }

  async setCurrent(s, n) {
    this.cur = { s, n };
    const d = await mutStore.surah(s).catch(() => null);
    if (this.cur.s !== s || this.cur.n !== n) return;
    const count = d?.bySrc.get(`${s}:${n}`)?.reduce((c, g) => c + g.muts.length, 0) || 0;
    this.tab.replaceChildren("المتشابهات", count ? el("span", { class: "tab-count" }, ar(count)) : "");
    if (this.active) this.render();
  }

  async render() {
    if (!this.cur) return;
    const { s, n } = this.cur, token = ++this.token;
    const key = `${s}:${n}`;
    let d;
    try { d = await mutStore.surah(s); } catch (e) {
      this.root.replaceChildren(el("p", { class: "tf-error" }, e.message));
      return;
    }
    if (token !== this.token) return;
    const groups = d.bySrc.get(key) || [];
    const head = el("div", { class: "panel__row" },
      el("h2", { class: "panel__title" }, `متشابهات الآية ${ar(n)}`),
      el("a", { class: "mut-more", href: "#/mut" }, "كيف أضبطها؟"));
    if (!groups.length) {
      this.root.replaceChildren(head,
        el("p", { class: "hint" }, "لا مواضع مشهورة تشتبه بهذه الآية."),
        el("p", { class: "hint" }, "الآيات التي لها متشابهات رقمها مظلّل في النص."));
      return;
    }
    const items = groups.flatMap((g) => g.muts.map((m, i) => this.comparison(d.text, g.src, m, g.ctx, g.notes?.[i])));
    this.root.replaceChildren(head, legend(), ...items,
      el("p", { class: "mut-credit muted" }, "المواضع من بيانات «Quran Mutashabihat Data» (CC0)، والتلوين بمقارنة الكلمات آليًا."));
  }
}

// ── the #/mut page ─────────────────────────────────────
// One path down the page: how to use it, then find and compare, then practise.
const STEPS = [["how", "افهم الطريقة"], ["browse", "ابحث وقارن"], ["practice", "تدرّب"]];
const PAGE_SIZE = 25;

/** A count with the noun in the form Arabic gives it: one, two, three to ten, eleven and up. */
const counted = (n, [one, two, few, many]) =>
  n === 1 ? one : n === 2 ? two : n <= 10 ? `${ar(n)} ${few}` : `${ar(n)} ${many}`;
const PLACES = ["موضع واحد", "موضعان", "مواضع", "موضعًا"];
const MATES = ["نظير واحد", "نظيران", "نظائر", "نظيرًا"];

export class MutView extends MutBase {
  constructor({ root, surahs }) {
    super(surahs);
    this.root = root;
    this.surahs = surahs;
    this.filter = { surah: "2", juz: "", q: "" };
  }

  async show(anchor) {
    let index, daw;
    try { [index, daw] = await Promise.all([mutStore.index(), mutStore.dawabit()]); } catch (e) {
      this.root.replaceChildren(el("div", { class: "learn__wrap" }, el("div", { class: "state is-error" }, e.message)));
      return;
    }
    daw.rules.forEach((r) => RULE_NAMES.set(r.id, r.name));
    this.index = index;
    this.daw = daw;
    const nSurahs = Object.keys(index.surahs).length;
    this.root.replaceChildren(el("div", { class: "learn__wrap mut-page" },
      el("header", { class: "mut-head" },
        el("h1", {}, "المتشابهات اللفظية"),
        el("p", {}, "آيات تتفق في أكثر ألفاظها وتختلف في كلمة أو حرف، فيخلط الحافظ بينها. ابحث عن الموضع، وانظر الفرق ملوّنًا، ثم تدرّب عليه."),
        el("p", { class: "mut-head__stats" }, `${ar(index.total)} موضعًا في ${ar(nSurahs)} سورة`)),
      el("nav", { class: "mut-steps", "aria-label": "خطوات الصفحة" }, el("ol", {},
        STEPS.map(([id, label], i) => el("li", {}, el("a", { href: `#/mut/${id}` }, el("span", { class: "mut-steps__n" }, ar(i + 1)), label))))),
      this.howSection(), this.browseSection(), this.practiceSection(),
      el("p", { class: "mut-credit muted" }, "المواضع من بيانات «Quran Mutashabihat Data» لوقار أكرم (CC0)، والتلوين بمقارنة الكلمات آليًا.")));
    if (anchor === "rules") this.root.querySelector(".mut-rulesbox").open = true;
    const target = anchor && document.getElementById(`mut-${anchor === "rules" ? "how" : anchor}`);
    if (target) target.scrollIntoView({ block: "start" }); else window.scrollTo({ top: 0 });
  }

  section(id, n, title, intro, ...content) {
    return el("section", { class: "mut-sec", id: `mut-${id}` },
      el("h2", {}, el("span", { class: "mut-sec__n", "aria-hidden": "true" }, ar(n)), title),
      intro ? el("p", { class: "mut-sec__intro" }, intro) : null, ...content);
  }

  howSection() {
    const rules = el("details", { class: "mut-rulesbox" },
      el("summary", {}, el("b", {}, `قواعد الضبط (${ar(this.daw.rules.length)})`),
        el("span", { class: "muted" }, "وسائل يستعملها المحفّظون للتذكّر. افتح ما تحتاجه منها.")),
      el("div", { class: "mut-rules" }, this.daw.rules.map((r, i) => {
        const d = el("details", { class: "mut-rule", id: `rule-${r.id}` },
          el("summary", {}, el("span", { class: "mut-rule__n" }, ar(i + 1)), r.name));
        d.addEventListener("toggle", () => {
          if (!d.open || d.dataset.done) return;
          d.dataset.done = "1";
          d.append(el("p", {}, r.explain), ...r.examples.flatMap((ex) => [
            this.comparison(this.daw.text, [ex.a], [ex.b], false, null, { here: false }),
            el("p", { class: "mut-dabit" }, el("b", {}, "الضابط: "), ex.dabit)]));
        });
        return d;
      })),
      el("p", { class: "muted mut-note" }, "القواعد ١–١٠ وأمثلتها من «١٠ قواعد مهمة في ضبط الآيات المتشابهة» لعبد الشكور معلم عبد فارح، بتصرف في العبارة."));
    return this.section("how", 1, "افهم الطريقة", null,
      el("ol", { class: "mut-howto" },
        el("li", {}, el("b", {}, "قارن الموضعين"), " حتى ترى الفرق بعينك. الكلمات المختلفة ملوّنة."),
        el("li", {}, el("b", {}, "اجعل لكل موضع ضابطًا"), " تميّزه به، من قواعد الضبط أو من عندك."),
        el("li", {}, el("b", {}, "ركّز على الفرق"), " كلما راجعت الموضعين، ودوّن ما تخطئ فيه.")),
      legend(),
      el("p", { class: "mut-tip" }, "في صفحة القراءة: الآية التي لها متشابهات رقمها مظلّل، وتجد مواضعها في تبويب «المتشابهات»."),
      el("p", { class: "muted mut-note" }, "الخطوات من كتاب «أسهل طريقة لحفظ القرآن الكريم» للشيخ عبد المحسن القاسم، بتصرف."),
      rules);
  }

  // ── find and compare ─────────────────────────────────
  browseSection() {
    const f = this.filter;
    const surahSel = el("select", { id: "mut-surah" },
      el("option", { value: "" }, "كل السور"),
      this.surahs.filter((s) => this.index.surahs[String(s.id)]).map((s) =>
        el("option", { value: s.id, selected: String(s.id) === f.surah }, `${ar(s.id)}. ${s.name} (${ar(this.index.surahs[String(s.id)])})`)));
    const juzSel = el("select", { id: "mut-juz" },
      el("option", { value: "" }, "كل الأجزاء"),
      Array.from({ length: 30 }, (_, i) => el("option", { value: i + 1, selected: String(i + 1) === f.juz }, `الجزء ${ar(i + 1)}`)));
    const q = el("input", { id: "mut-q", type: "search", value: f.q, placeholder: "مثل: وما الله بغافل", autocomplete: "off", enterkeyhint: "search" });
    const count = el("p", { class: "mut-count", role: "status" });
    const list = el("div", { class: "mut-list" });
    const more = el("button", { type: "button", class: "btn mut-moreb", hidden: true }, "عرض المزيد");
    let results = [], shown = 0, token = 0;

    const showMore = () => {
      const next = results.slice(shown, shown + PAGE_SIZE);
      list.append(...next.map((r) => this.item(r)));
      shown += next.length;
      more.hidden = shown >= results.length;
    };
    const run = async () => {
      const t = ++token;
      Object.assign(f, { surah: surahSel.value, juz: juzSel.value, q: q.value.trim() });
      if (!f.surah && !f.juz && !f.q) {
        results = [];
        list.replaceChildren(el("p", { class: "mut-empty" }, "اختر سورة أو جزءًا، أو اكتب كلمات من الآية."));
        count.textContent = "";
        more.hidden = true;
        return;
      }
      count.textContent = f.q && !f.surah && !f.juz ? "جارٍ البحث في القرآن كله…" : "جارٍ التحميل…";
      let found;
      try { found = await this.find(f); } catch (e) { if (t === token) count.textContent = e.message; return; }
      if (t !== token) return;
      results = found;
      shown = 0;
      list.replaceChildren();
      count.textContent = found.length ? counted(found.length, PLACES) : "لا مواضع بهذا البحث. جرّب كلمات أقل.";
      showMore();
    };
    surahSel.addEventListener("change", () => { if (surahSel.value) juzSel.value = ""; run(); });
    juzSel.addEventListener("change", () => { if (juzSel.value) surahSel.value = ""; run(); });
    let typing = 0;
    q.addEventListener("input", () => { clearTimeout(typing); typing = setTimeout(run, 300); });
    more.addEventListener("click", showMore);
    run();

    return this.section("browse", 2, "ابحث وقارن", "اختر سورة أو جزءًا، أو اكتب كلمات من الآية. اضغط على أي موضع لترى الفرق.",
      el("div", { class: "mut-filter", role: "search" },
        el("label", { class: "mut-field" }, el("span", {}, "السورة"), surahSel),
        el("label", { class: "mut-field" }, el("span", {}, "الجزء"), juzSel),
        el("label", { class: "mut-field mut-field--q" }, el("span", {}, "كلمات من الآية"), q)),
      count, list, more);
  }

  /** Every group matching the filter, in the mushaf's order: [{d, g}]. */
  async find({ surah, juz, q }) {
    let ids = Object.keys(this.index.surahs).map(Number);
    let inJuz = null;
    if (surah) ids = [+surah];
    else if (juz) {
      const idx = await mushafIndex();
      const from = idx.juz[juz - 1], to = juz < 30 ? idx.juz[juz] - 1 : 604;
      ids = ids.filter((s) => { const p = this.meta.get(s)?.pages; return p && p[0] <= to && p[1] >= from; });
      const pageOf = new Map();
      idx.pages.forEach((list, i) => list.forEach(([s, a]) => pageOf.set(`${s}:${a}`, i + 1)));
      inJuz = (k) => { const p = pageOf.get(k); return p >= from && p <= to; };
    }
    const key = q ? searchKey(q) : "";
    const data = await Promise.all(ids.map((s) => mutStore.surah(s)));
    const out = [];
    for (const d of data) for (const g of d.groups) {
      if (inJuz && !inJuz(g.src[0])) continue;
      // the words may be in the ayah itself or in one of its similar places
      const hit = (keys) => searchKey(keys.flatMap((k) => d.text[k] || []).join(" ")).includes(key);
      if (key && !hit(g.src) && !g.muts.some(hit)) continue;
      out.push({ d, g });
    }
    return out;
  }

  /** One place: its reference and opening words; the comparison opens on demand. */
  item({ d, g }) {
    const words = g.src.flatMap((k) => d.text[k] || []);
    const det = el("details", { class: "mut-item" },
      el("summary", {},
        el("span", { class: "mut-item__top" },
          el("span", { class: "mut-ref" }, this.ref(g.src)),
          g.notes ? el("span", { class: "tag" }, "له ضابط") : null,
          el("span", { class: "mut-item__n muted" }, counted(g.muts.length, MATES))),
        el("span", { class: "mut-item__text" }, words.slice(0, 7).join(" ") + (words.length > 7 ? " …" : "")),
        el("span", { class: "mut-item__with muted" }, `يشبهها: ${g.muts.map((m) => this.ref(m)).join("، ")}`)));
    det.addEventListener("toggle", () => {
      if (!det.open || det.dataset.done) return;
      det.dataset.done = "1";
      det.append(el("div", { class: "mut-item__body" },
        ...g.muts.map((m, i) => this.comparison(d.text, g.src, m, g.ctx, g.notes?.[i], { here: false })),
        this.link(g.src, "افتح الموضع في صفحة القراءة")));
    });
    return det;
  }

  // ── practice ─────────────────────────────────────────
  practiceSection() {
    const scopes = [["sel", "ما اخترته في البحث"], ["juz30", "جزء عمّ وتبارك"], ["mufassal", "المفصّل (ق إلى الناس)"], ["all", "القرآن كله"]];
    const sel = el("select", { id: "mut-scope" }, scopes.map(([v, t]) => el("option", { value: v }, t)));
    const box = el("div", { class: "mut-quiz", "aria-live": "polite" });
    const start = el("button", { type: "button", class: "btn btn--primary" }, "ابدأ ١٠ أسئلة");
    start.addEventListener("click", async () => {
      box.replaceChildren(el("p", { class: "muted" }, "جارٍ التحضير…"));
      let pool;
      try {
        if (sel.value === "sel") pool = await this.find(this.filter.surah || this.filter.juz || this.filter.q ? this.filter : { surah: "2" });
        else {
          const fit = { juz30: (s) => s >= 67, mufassal: (s) => s >= 50, all: () => true }[sel.value];
          const data = await Promise.all(Object.keys(this.index.surahs).map(Number).filter(fit).map((s) => mutStore.surah(s)));
          pool = data.flatMap((d) => d.groups.map((g) => ({ d, g })));
        }
      } catch (e) { box.replaceChildren(el("p", {}, e.message)); return; }
      const pairs = shuffle(pool.flatMap(({ d, g }) => g.muts.map((m) => ({ d, g, m }))));
      const qs = [];
      for (const it of pairs) {
        if (qs.length >= 10) break;
        const A = blockWords(it.d.text, it.g.src), B = blockWords(it.d.text, it.m);
        const q = question(A.words, B.words);
        if (q && compare(A.words, B.words).shared >= 2) qs.push({ ...q, it });
      }
      if (!qs.length) { box.replaceChildren(el("p", {}, "لا أسئلة في هذا النطاق. اختر نطاقًا أوسع.")); return; }
      this.quiz(box, qs);
    });
    return this.section("practice", 3, "تدرّب", "يُخفى موضع الفرق من الآية، فتختار اللفظ الصحيح من لفظَي الموضعين، ثم ترى الموضع الآخر.",
      el("div", { class: "mut-filter mut-filter--practice" },
        el("label", { class: "mut-field" }, el("span", {}, "النطاق"), sel), start), box);
  }

  quiz(box, qs) {
    let right = 0, done = 0;
    const score = el("p", { class: "quiz__score" });
    box.replaceChildren(el("ol", { class: "quiz__list" }, qs.map((q, qi) => {
      const opts = shuffle([q.answer, q.other]);
      const why = el("div", { class: "mut-why", hidden: true });
      const buttons = opts.map((o) => {
        const b = el("button", { type: "button", class: "quiz__opt mut-opt" }, o);
        b.addEventListener("click", () => {
          if (li.dataset.done) return;
          li.dataset.done = "1";
          done++;
          const ok = o === q.answer;
          if (ok) right++;
          buttons.forEach((x) => { x.disabled = true; if (x.textContent === q.answer) x.classList.add("is-right"); });
          if (!ok) b.classList.add("is-wrong");
          why.hidden = false;
          why.append(this.comparison(q.it.d.text, q.it.g.src, q.it.m, false, q.it.g.notes?.[q.it.g.muts.indexOf(q.it.m)], { here: false }));
          score.textContent = `النتيجة: ${ar(right)} من ${ar(done)}` + (done === qs.length ? ". انتهى التدريب" : "");
        });
        return b;
      });
      const li = el("li", { class: "quiz__item" },
        el("p", { class: "quiz__q" }, el("span", { class: "quiz__n" }, `${ar(qi + 1)}.`), `في ${this.ref(q.it.g.src)}:`),
        el("p", { class: "mut-text mut-q" },
          q.cutStart ? "… " : "", q.before.join(" "), " ", el("span", { class: "mut-blank" }, "؟"), " ", q.after.join(" "), q.cutEnd ? " …" : ""),
        el("div", { class: "quiz__opts" }, buttons), why);
      return li;
    })), score);
  }
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
