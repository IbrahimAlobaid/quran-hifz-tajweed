/**
 * «المتشابهات»: the similar places of an ayah in the memorize page (side tab
 * and a mark on the ayah number), and the #/mut page — how to tell similar
 * verses apart, browsing by surah, and practice.
 * The Quran text is shown as it is; only colour marks the differences.
 */
import { blockWords, compare, createMutStore, parseKey, question } from "./mutashabihat-data.js";
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
        el("p", { class: "hint" }, "الآيات التي لها متشابهات عليها خط تحت رقمها في النص."));
      return;
    }
    const items = groups.flatMap((g) => g.muts.map((m, i) => this.comparison(d.text, g.src, m, g.ctx, g.notes?.[i])));
    this.root.replaceChildren(head, legend(), ...items,
      el("p", { class: "mut-credit muted" }, "المواضع من بيانات «Quran Mutashabihat Data» (CC0)، والتلوين بمقارنة الكلمات آليًا."));
  }
}

// ── the #/mut page ─────────────────────────────────────
const TOC = [["how", "الطريقة"], ["rules", "قواعد الضبط"], ["browse", "تصفّح السور"], ["practice", "تدرّب"], ["sources", "المصادر"]];
const CLASSIC = [
  ["درة التنزيل وغرة التأويل", "الخطيب الإسكافي (ت ٤٢٠هـ)", "من أقدم كتب توجيه المتشابه اللفظي، يبيّن سبب اختلاف اللفظ في كل موضع."],
  ["البرهان في توجيه متشابه القرآن", "محمود بن حمزة الكرماني (ت نحو ٥٠٥هـ)", "يمر على السور بالترتيب ويذكر لكل موضع نظيره وسبب الفرق."],
  ["ملاك التأويل القاطع بذوي الإلحاد والتعطيل", "ابن الزبير الغرناطي (ت ٧٠٨هـ)", "أوسع كتب التوجيه."],
  ["هداية المرتاب وغاية الحفاظ والطلاب في تبيين متشابه الكتاب", "علم الدين السخاوي (ت ٦٤٣هـ)", "منظومة لحفظ المتشابهات، رتّبها على حروف المعجم."],
];

export class MutView extends MutBase {
  constructor({ root, surahs }) {
    super(surahs);
    this.root = root;
    this.surahs = surahs;
    this.browseSurah = 2;
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
    this.root.replaceChildren(el("div", { class: "learn__wrap plans mut-page" },
      el("div", { class: "learn__bar" }, el("nav", { class: "subnav", "aria-label": "أقسام الصفحة" },
        TOC.map(([id, label]) => el("a", { href: `#/mut/${id}` }, label)))),
      el("header", { class: "learn-hero" },
        el("h1", {}, "المتشابهات اللفظية"),
        el("p", {}, `آيات تتفق في أكثر ألفاظها وتختلف في كلمة أو حرف أو ترتيب، فيخلط الحافظ بينها. هنا ${ar(index.total)} موضعًا في ${ar(Object.keys(index.surahs).length)} سورة، تُقارن كلمةً بكلمة، مع قواعد تضبط بها الفرق، وتدريب عليها.`)),
      this.howSection(), this.rulesSection(), this.browseSection(), this.practiceSection(), this.sourcesSection()));
    const target = anchor && document.getElementById(`mut-${anchor}`);
    if (target) target.scrollIntoView({ block: "start" }); else window.scrollTo({ top: 0 });
  }

  section(id, title, intro, ...content) {
    return el("section", { class: "plan-sec", id: `mut-${id}` },
      el("h2", {}, title), intro ? el("p", { class: "plan-sec__intro" }, intro) : null, ...content);
  }

  howSection() {
    return this.section("how", "كيف تضبط المتشابهات", null,
      el("ol", { class: "method__steps" },
        el("li", {}, "افتح المصحف على الموضعين، وتأمّل الفرق بينهما حتى تراه بعينك."),
        el("li", {}, "اجعل لنفسك قاعدة تميّز بها كل موضع، من القواعد التالية أو من عندك."),
        el("li", {}, "ركّز على هذا الفرق كلما راجعت الموضعين حتى تتقنه."),
        el("li", {}, "اكتب ما تخطئ فيه في دفتر، وراجعه مع وردك.")),
      el("p", { class: "muted" }, "الخطوات الثلاث الأولى من كتاب «أسهل طريقة لحفظ القرآن الكريم» للشيخ عبد المحسن القاسم."),
      el("h3", { class: "plan-sub" }, "في صفحة الحفظ"),
      el("p", {}, "الآية التي لها مواضع متشابهة عليها خط منقّط تحت رقمها. واختر تبويب «المتشابهات» في اللوحة الجانبية، فترى مواضعها مقارنةً بها كلمةً بكلمة."),
      legend());
  }

  rulesSection() {
    return this.section("rules", "قواعد الضبط", "طرق يستعملها المحفّظون ليعرف الحافظ أي اللفظين في أي موضع. ليست قواعد لغوية، بل وسائل للتذكّر، فاختر منها ما يعلق بذهنك.",
      el("div", { class: "mut-rules" }, this.daw.rules.map((r, i) => el("article", { class: "mut-rule", id: `rule-${r.id}` },
        el("h3", {}, el("span", { class: "mut-rule__n" }, ar(i + 1)), r.name),
        el("p", {}, r.explain),
        ...r.examples.flatMap((ex) => [
          this.comparison(this.daw.text, [ex.a], [ex.b], false, null, { here: false }),
          el("p", { class: "mut-dabit" }, el("b", {}, "الضابط: "), ex.dabit)])))),
      el("p", { class: "muted plan-note" }, "القواعد ١–١٠ وأمثلتها من «١٠ قواعد مهمة في ضبط الآيات المتشابهة» لعبد الشكور معلم عبد فارح، بتصرف في العبارة."));
  }

  browseSection() {
    const sel = el("select", { id: "mut-surah", "aria-label": "السورة" },
      this.surahs.filter((s) => this.index.surahs[String(s.id)]).map((s) =>
        el("option", { value: s.id, selected: s.id === this.browseSurah }, `${ar(s.id)}. ${s.name} (${ar(this.index.surahs[String(s.id)])})`)));
    const list = el("div", { class: "mut-list", "aria-live": "polite" });
    const load = async () => {
      this.browseSurah = +sel.value;
      list.replaceChildren(el("p", { class: "muted" }, "جارٍ التحميل…"));
      const d = await mutStore.surah(this.browseSurah);
      list.replaceChildren(...d.groups.map((g) => {
        const det = el("details", { class: "mut-item" },
          el("summary", {}, el("span", { class: "mut-ref" }, this.ref(g.src)),
            el("span", { class: "muted" }, ` مع ${g.muts.map((m) => this.ref(m)).join("، ")}`),
            g.notes ? el("span", { class: "tag" }, "له ضابط") : null));
        det.addEventListener("toggle", () => {
          if (!det.open || det.dataset.done) return;
          det.dataset.done = "1";
          det.append(...g.muts.map((m, i) => this.comparison(d.text, g.src, m, g.ctx, g.notes?.[i], { here: false })));
        });
        return det;
      }));
    };
    sel.addEventListener("change", load);
    load();
    return this.section("browse", "تصفّح السور", "اختر سورة، ثم افتح أي موضع لترى نظائره مقارنةً به.",
      el("label", { class: "mut-pick" }, el("span", {}, "السورة"), sel), list);
  }

  practiceSection() {
    const scopes = [["juz30", "جزء عمّ وتبارك", (s) => s >= 67], ["mufassal", "المفصّل (ق إلى الناس)", (s) => s >= 50],
      ["sel", "السورة المختارة في التصفّح", null], ["all", "القرآن كله", () => true]];
    const sel = el("select", { "aria-label": "نطاق التدريب" }, scopes.map(([v, t]) => el("option", { value: v }, t)));
    const box = el("div", { class: "mut-quiz", "aria-live": "polite" });
    const start = el("button", { type: "button", class: "btn btn--primary" }, "ابدأ ١٠ أسئلة");
    start.addEventListener("click", async () => {
      const [, , fit] = scopes.find(([v]) => v === sel.value);
      const ids = Object.keys(this.index.surahs).map(Number).filter((s) => (fit ? fit(s) : s === this.browseSurah));
      box.replaceChildren(el("p", { class: "muted" }, "جارٍ التحضير…"));
      const data = await Promise.all(ids.map((s) => mutStore.surah(s)));
      const pool = [];
      for (const d of data) for (const g of d.groups) g.muts.forEach((m) => pool.push({ d, g, m }));
      shuffle(pool);
      const qs = [];
      for (const it of pool) {
        if (qs.length >= 10) break;
        const A = blockWords(it.d.text, it.g.src), B = blockWords(it.d.text, it.m);
        const q = question(A.words, B.words);
        if (q && compare(A.words, B.words).shared >= 2) qs.push({ ...q, it });
      }
      if (!qs.length) { box.replaceChildren(el("p", {}, "لا أسئلة في هذا النطاق. اختر نطاقًا أوسع.")); return; }
      this.quiz(box, qs);
    });
    return this.section("practice", "تدرّب", "يُخفى موضع الفرق من آية، وتختار اللفظ الذي في هذه الآية من بين لفظ الموضعين. بعد الإجابة ترى الموضع الآخر.",
      el("div", { class: "mut-practice__bar" }, el("label", { class: "mut-pick" }, el("span", {}, "النطاق"), sel), start), box);
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

  sourcesSection() {
    const src = this.index.source;
    const a = (href, text) => el("a", { href, target: "_blank", rel: "noopener" }, text);
    return this.section("sources", "المصادر", null,
      el("h3", { class: "plan-sub" }, "بيانات المواضع"),
      el("p", {}, a(src.url, "Quran Mutashabihat Data"), " لوقار أكرم (Waqar Akram)، مبنية على عمل القارئ إدريس العاصم رحمه الله وخبرة جامعها في الحفظ والتحفيظ. رخصتها CC0 (ملك عام). وهي تجمع المواضع التي يكثر أن يخلط بينها الحفّاظ، لا كل تشابه في القرآن."),
      el("p", { class: "muted" }, "وفحصنا أيضًا: QUL من Tarteel (عبارات متكررة على مستوى الكلمة)، وQuranpedia، وUmmahAPI، وHifzLink، ومنصة «إحكام». اخترنا هذه البيانات لأن رخصتها تسمح بنشرها، ولأنها من عمل محفّظين، وتعمل دون اتصال."),
      el("h3", { class: "plan-sub" }, "المقارنة والتلوين"),
      el("p", {}, "يقارن الموقع كلمات الموضعين آليًا، ولا يغيّر شيئًا من نص المصحف. ويتجاهل الفروق التي يصنعها اتصال الكلمة بما بعدها (كشدة الإدغام أو السكون المحذوف)، لأنها ليست فرقًا في اللفظ المحفوظ. أما الضوابط فمن كتابة أهل العلم، ولا يولّد الموقع ضابطًا من عنده."),
      el("h3", { class: "plan-sub" }, "للاستزادة"),
      el("ul", { class: "sources" },
        el("li", {}, a("https://www.alukah.net/sharia/0/145909/", "١٠ قواعد مهمة في ضبط الآيات المتشابهة"), "، عبد الشكور معلم عبد فارح (الألوكة)."),
        el("li", {}, a("https://www.alukah.net/sharia/0/137988/", "١٠٠ فائدة في ضبط الآيات المتشابهة"), "، للمؤلف نفسه."),
        el("li", {}, "«القواعد الأربعينية في ضبط المتشابهات القرآنية» لدريد الموصلي، و«الضبط بالتقعيد للمتشابه اللفظي في القرآن المجيد» لفواز الحنين."),
        ...CLASSIC.map(([t, by, what]) => el("li", {}, el("b", {}, t), `، ${by}. `, el("span", { class: "muted" }, what)))));
  }
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
