/**
 * «خطط الحفظ» (#/plan): build a plan, follow the day's portion, and a reference
 * of the proven methods, review systems, research and videos.
 * The plan and its progress live in localStorage only.
 */
import { HADITH, MANAZIL, METHODS, QASIM_REVIEW, RULES, SCIENCE, SESSION, SOURCES, VIDEOS } from "./plans-content.js";
import { AMOUNTS, amountOf, calendarDays, DEFAULT_PLAN, juzProgress, portions, today } from "./plans-data.js";
import { ar, el } from "./util.js";
import { icon } from "./icons.js";
import { videoCard } from "./video.js";

const KEY = "hifz.plan.v1";
const KNOWN = [[0, "لا شيء بعد"], [1, "جزء عمّ"], [2, "آخر جزأين"], [3, "آخر ٣ أجزاء"], [5, "آخر ٥ أجزاء"], [10, "آخر ١٠ أجزاء"]];
const FIT = {
  third: "للمبتدئ، والصغير، ومن وقته ضيق. نحو نصف ساعة.",
  half: "لأكثر الطلاب والعاملين. نحو ساعة مع المراجعة.",
  page: "ما يوصي به الشيخ عبد المحسن القاسم. نحو ساعة ونصف مع المراجعة.",
  "2pages": "للمتفرغ القوي الحفظ. والشيخ القاسم ينهى عن الزيادة عليها.",
};
const PART_NAMES = { 2: ["النصف الأول", "النصف الثاني"], 3: ["الثلث الأول", "الثلث الثاني", "الثلث الثالث"] };
const TOC = [["plan", "خطتك"], ["ready", "الخطط الجاهزة"], ["methods", "طرق الحفظ"], ["review", "المراجعة"],
  ["day", "يوم الحفظ"], ["rules", "قواعد"], ["science", "علم الذاكرة"], ["videos", "فيديو"], ["sources", "المصادر"]];

function loadState() {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}
function saveState(st) {
  try { st ? localStorage.setItem(KEY, JSON.stringify(st)) : localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}
const isoDay = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

// ── Arabic counts ──────────────────────────────────────
// forms: [one, two, plural (3–10), singular accusative (11–99), singular after 100s]
// `gen` uses the genitive dual («نحو سنتين»).
const WORDS = {
  day: ["يوم", "يومان", "أيام", "يومًا", "يوم", "يومين"],
  month: ["شهر", "شهران", "أشهر", "شهرًا", "شهر", "شهرين"],
  year: ["سنة", "سنتان", "سنوات", "سنة", "سنة", "سنتين"],
  page: ["صفحة واحدة", "صفحتان", "صفحات", "صفحة", "صفحة", "صفحتين"],
  portion: ["مقطع", "مقطعان", "مقاطع", "مقطعًا", "مقطع", "مقطعين"],
};
function count(n, word, gen = false) {
  const [one, two, few, many, hundreds, two_gen] = WORDS[word];
  if (n === 1) return one;
  if (n === 2) return gen ? two_gen : two;
  const r = n % 100;
  return `${ar(n)} ${r >= 3 && r <= 10 ? few : r >= 11 ? many : hundreds}`;
}
function duration(days, gen = false) {
  const m = Math.max(1, Math.round(days / 30.44));
  if (m < 24) return count(m, "month", gen);
  const y = Math.floor(m / 12), r = m % 12;
  return r ? `${count(y, "year", gen)} و${count(r, "month", gen)}` : count(y, "year", gen);
}
function finishDate(days) {
  const d = new Date(Date.now() + days * 864e5);
  const g = new Intl.DateTimeFormat("ar-EG", { month: "long", year: "numeric" }).format(d);
  try {
    const h = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-arab", { month: "long", year: "numeric" }).format(d);
    return `${h} (${g})`;
  } catch { return g; }
}
const pagesText = (ranges) => ranges.map(([a, b]) => (a === b ? ar(a) : `${ar(a)}–${ar(b)}`)).join("، ");
const pagesLabel = (ranges) => (ranges.length === 1 && ranges[0][0] === ranges[0][1] ? "الصفحة " : "الصفحات ") + pagesText(ranges);

/** Hash that opens the memorize page on a selection (see main.js takeQuery). */
const hifzHash = (q) => `#/?${new URLSearchParams(q)}`;

export class PlansView {
  constructor({ root, surahs }) {
    this.root = root;
    this.names = new Map(surahs.map((s) => [s.id, s.name]));
    this.index = null;
    this.draft = { ...DEFAULT_PLAN };
  }

  async show(anchor) {
    try {
      this.index ||= await fetch("data/plans/mushaf.json").then((r) => {
        if (!r.ok) throw new Error("تعذّر تحميل فهرس صفحات المصحف.");
        return r.json();
      });
    } catch (e) {
      this.root.replaceChildren(el("div", { class: "learn__wrap" }, el("div", { class: "state is-error" }, e.message)));
      return;
    }
    this.render();
    const target = anchor && document.getElementById(`plan-${anchor}`);
    if (target) target.scrollIntoView({ block: "start" });
    else window.scrollTo({ top: 0 });
  }

  render() {
    this.root.replaceChildren(el("div", { class: "learn__wrap plans" },
      el("div", { class: "learn__bar" },
        el("nav", { class: "subnav", "aria-label": "أقسام الصفحة" },
          TOC.map(([id, label]) => el("a", { href: `#/plan/${id}` }, label)))),
      el("header", { class: "learn-hero" },
        el("h1", {}, "خطط حفظ القرآن"),
        el("p", {}, "كل الطرق المجرّبة تتفق على ثلاثة أوراد كل يوم: حفظ جديد قليل، ومراجعة لما حفظته قريبًا، ومراجعة لما حفظته قديمًا. اختر مقدارك هنا، وتحسب لك الصفحة ورد كل يوم، وتفتحه في صفحة الحفظ بضغطة.")),
      this.planSection(),
      this.readySection(),
      this.methodsSection(),
      this.reviewSection(),
      this.daySection(),
      this.rulesSection(),
      this.scienceSection(),
      this.videosSection(),
      this.sourcesSection(),
    ));
  }

  section(id, title, intro, ...content) {
    return el("section", { class: "plan-sec", id: `plan-${id}` },
      el("h2", {}, title), intro ? el("p", { class: "plan-sec__intro" }, intro) : null, ...content);
  }

  // ── your plan ────────────────────────────────────────
  planSection() {
    const st = loadState();
    const box = el("div", { class: "planner", "aria-live": "polite" });
    this.plannerBox = box;
    box.append(st ? this.todayCard(st) : this.form());
    return el("section", { class: "plan-sec plan-sec--first", id: "plan-plan" }, box);
  }

  refreshPlanner() {
    const st = loadState();
    this.plannerBox.replaceChildren(st ? this.todayCard(st) : this.form());
  }

  form() {
    const d = this.draft;
    const summary = el("p", { class: "planner__sum" });
    const update = () => {
      const n = portions(this.index, d).length;
      const days = calendarDays(n, d.days);
      summary.replaceChildren(
        el("strong", {}, `${count(n, "day")} للحفظ، تختم بعدها في نحو ${duration(days, true)}`),
        el("span", { class: "muted" }, ` بإذن الله. الموعد المتوقع: ${finishDate(days)}.`));
    };
    const seg = (label, key, options) => {
      const g = el("div", { class: "seg-ctl planner__seg", role: "radiogroup", "aria-label": label },
        options.map(([v, text, hint]) => el("button", { type: "button", role: "radio", "aria-checked": String(d[key] === v), dataset: { v: String(v) } },
          text, hint ? el("small", {}, hint) : null)));
      g.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        d[key] = typeof d[key] === "number" ? +b.dataset.v : b.dataset.v;
        g.querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
        update();
      });
      return el("div", { class: "planner__field" }, el("span", { class: "planner__label" }, label), g);
    };
    const known = el("select", { id: "plan-known" }, KNOWN.map(([v, t]) => el("option", { value: v, selected: d.known === v }, t)));
    known.addEventListener("change", () => { d.known = +known.value; update(); });
    const start = el("button", { type: "button", class: "btn btn--primary" }, "ابدأ الخطة");
    start.addEventListener("click", () => {
      saveState({ plan: { ...d }, done: 0, day: 0, last: null, undo: [] });
      this.refreshPlanner();
    });
    update();
    return el("div", { class: "planner__form" },
      el("h2", { class: "planner__title" }, "ابنِ خطتك"),
      seg("من أين تبدأ؟", "dir", [["back", "من آخر المصحف", "جزء عمّ أولًا"], ["fwd", "من أوله", "البقرة أولًا"]]),
      el("div", { class: "planner__field" }, el("label", { class: "planner__label", for: "plan-known" }, "ماذا تحفظ الآن؟"), known,
        el("span", { class: "muted planner__help" }, "يدخل في المراجعة من أول يوم، ولا يُحفظ مرة أخرى.")),
      seg("كم تحفظ في اليوم؟", "amount", AMOUNTS.map((a) => [a.id, a.name, a.hint])),
      seg("كم يومًا في الأسبوع؟", "days", [[5, "٥ أيام"], [6, "٦ أيام"], [7, "كل يوم"]]),
      el("p", { class: "muted planner__help" }, "في الأيام الأخرى تراجع فقط."),
      summary,
      start);
  }

  todayCard(st) {
    const { plan } = st;
    const list = portions(this.index, plan);
    const t = today(this.index, plan, list, st);
    const amt = amountOf(plan.amount);
    const logged = st.last === isoDay();
    const total = list.length;
    const left = total - st.done;

    const act = (label, cls, fn) => {
      const b = el("button", { type: "button", class: cls }, label);
      b.addEventListener("click", () => {
        const s = loadState();
        s.undo = [...(s.undo || []).slice(-19), { done: s.done, day: s.day, last: s.last }];
        fn(s);
        saveState(s);
        this.refreshPlanner();
      });
      return b;
    };
    const rows = [];
    if (t.next) {
      const p = t.next;
      const where = p.pages.length === 2 ? `الصفحتان ${ar(p.pages[0])} و${ar(p.pages[1])}`
        : `الصفحة ${ar(p.pages[0])}${p.parts > 1 ? `، ${PART_NAMES[p.parts]?.[p.part - 1] || `الجزء ${ar(p.part)}`}` : ""}`;
      const whole = p.parts === 1;
      const links = whole
        ? p.pages.map((pg) => el("a", { class: "btn btn--primary", href: hifzHash({ page: pg }) }, p.pages.length > 1 ? `افتح الصفحة ${ar(pg)}` : "احفظه الآن"))
        : p.segs.map((s, i) => el("a", { class: "btn" + (i === 0 ? " btn--primary" : ""), href: hifzHash({ s: s.s, from: s.from, to: s.to }) },
          p.segs.length > 1 ? `افتح ${this.names.get(s.s)}` : "احفظه الآن"));
      rows.push(this.track("new", "الحفظ الجديد", p.segs.map((s) => this.segText(s)).join("، "), where, links));
    } else {
      rows.push(this.track("new", "الحفظ الجديد", "أتممت حفظ ما في الخطة. الحمد لله.", "انتقل الآن إلى مرحلة الإتقان في قسم المراجعة.", []));
    }
    rows.push(t.nearCount
      ? this.track("near", "مراجعة القريب", pagesLabel(t.near), `${count(t.nearCount, "page")}، تسمّعها كلها كل يوم قبل الحفظ.`,
        [el("a", { class: "btn", href: hifzHash({ page: t.near[0][0] }) }, "افتح")])
      : this.track("near", "مراجعة القريب", "تبدأ من الغد.", "ما تحفظه اليوم تسمّعه كل يوم مدة ٢٠ يومًا.", []));
    rows.push(t.farCount
      ? this.track("far", "مراجعة البعيد", pagesLabel(t.far), `${count(t.farCount, "page")}، اليوم ${ar((st.day % t.cycle) + 1)} من ${ar(t.cycle)} في دورة تمرّ على ${count(t.farTotal, "page")}.`,
        [el("a", { class: "btn", href: hifzHash({ page: t.far[0][0] }) }, "افتح")])
      : this.track("far", "مراجعة البعيد", "لا شيء بعد.", "ما يخرج من مراجعة القريب يدخل هنا، ويدور عليك مرة كل أسبوع.", []));

    const pct = Math.round((st.done / total) * 100);
    const juz = juzProgress(this.index, plan, list, st.done);
    const days = calendarDays(left, plan.days);
    const undo = st.undo?.length ? el("button", { type: "button", class: "linkish" }, "تراجع عن آخر تسجيل") : null;
    undo?.addEventListener("click", () => {
      const s = loadState();
      Object.assign(s, s.undo.pop());
      saveState(s);
      this.refreshPlanner();
    });
    const reset = el("button", { type: "button", class: "linkish" }, "خطة جديدة");
    reset.addEventListener("click", () => {
      if (!confirm("ستُحذف خطتك الحالية وتقدّمك فيها من هذا المتصفح. هل تريد البدء من جديد؟")) return;
      this.draft = { ...plan };
      saveState(null);
      this.refreshPlanner();
    });

    return el("div", { class: "today" },
      el("header", { class: "today__head" },
        el("h2", {}, logged ? "سُجّل ورد اليوم. وهذا ورد الغد" : "ورد اليوم"),
        el("p", { class: "muted" }, `${amt.name} في اليوم، ${plan.dir === "back" ? "من آخر المصحف" : "من أوله"}، ${ar(plan.days)} أيام في الأسبوع.`)),
      el("ol", { class: "tracks" }, rows),
      t.next ? el("div", { class: "today__actions" },
        logged ? null : act("أتممتُ ورد اليوم", "btn btn--primary", (s) => { s.done++; s.day++; s.last = isoDay(); }),
        logged ? null : act("راجعتُ فقط اليوم", "btn", (s) => { s.day++; s.last = isoDay(); }),
        act("أحفظ هذا المقطع، تخطَّه", "linkish", (s) => { s.done++; })) : null,
      el("div", { class: "today__progress" },
        el("div", { class: "progress" },
          el("div", { class: "progress__bar" }, el("div", { style: `width:${pct}%` })),
          el("span", {}, `حفظت ${ar(st.done)} من ${count(total, "portion")} (${ar(pct)}٪)`)),
        left ? el("p", { class: "muted" }, `بقي نحو ${duration(days)} بإذن الله. الموعد المتوقع للختم: ${finishDate(days)}.`) : null,
        this.memoryMap(juz)),
      el("p", { class: "today__foot" }, undo, reset));
  }

  /** The 30 juz as a 10 × 3 grid: memorized, in progress, not started — each with its number and a legend. */
  memoryMap(juz) {
    const STATES = [["solid", "محفوظ"], ["learning", "قيد الحفظ"], ["new", "لم يبدأ"]];
    const state = (f) => (f >= 1 ? "solid" : f > 0 ? "learning" : "new");
    const counts = Object.fromEntries(STATES.map(([k]) => [k, juz.filter((f) => state(f) === k).length]));
    return el("div", { class: "juzmap" },
      el("div", { class: "juzmap__grid", role: "list", "aria-label": "خريطة الأجزاء" },
        juz.map((f, i) => el("span", {
          class: `juzmap__c is-${state(f)}`, role: "listitem",
          title: `الجزء ${ar(i + 1)}: ${ar(Math.round(f * 100))}٪`, "aria-label": `الجزء ${ar(i + 1)}، ${STATES.find(([k]) => k === state(f))[1]}`,
        }, ar(i + 1)))),
      el("p", { class: "juzmap__legend" }, STATES.map(([k, name]) =>
        el("span", {}, el("i", { class: `is-${k}` }), `${name} (${ar(counts[k])})`))));
  }

  track(kind, label, main, detail, links) {
    return el("li", { class: `track track--${kind}` },
      el("span", { class: "track__icon" }, icon(kind === "new" ? "wird" : "review")),
      el("div", { class: "track__body" }, el("span", { class: "track__label" }, label), el("strong", {}, main), el("span", { class: "muted" }, detail)),
      links.length ? el("div", { class: "track__links" }, links) : null);
  }

  segText({ s, from, to }) {
    const name = this.names.get(s) || `سورة ${ar(s)}`;
    return from === to ? `${name} ${ar(from)}` : `${name} ${ar(from)}–${ar(to)}`;
  }

  // ── ready plans ──────────────────────────────────────
  readySection() {
    const rows = AMOUNTS.map((a) => {
      const n = portions(this.index, { dir: "fwd", known: 0, amount: a.id }).length;
      const pick = el("button", { type: "button", class: "btn btn--sm" }, "اختر");
      pick.addEventListener("click", () => {
        if (loadState()) { document.getElementById("plan-plan").scrollIntoView({ behavior: "smooth" }); return; }
        this.draft.amount = a.id;
        this.refreshPlanner();
        document.getElementById("plan-plan").scrollIntoView({ behavior: "smooth" });
      });
      return el("tr", {},
        el("th", { scope: "row" }, a.name, el("span", { class: "muted" }, ` (${a.hint})`)),
        el("td", {}, count(n, "day")),
        el("td", {}, duration(calendarDays(n, 5))),
        el("td", {}, duration(calendarDays(n, 7))),
        el("td", { class: "ready__fit" }, FIT[a.id]),
        el("td", {}, pick));
    });
    return this.section("ready", "الخطط الجاهزة", "المدة لحفظ المصحف كاملًا من البداية. والمقطع اليومي لا يقطع سورة قصيرة، فعدد الأيام يختلف قليلًا عن حساب الأسطر.",
      el("div", { class: "table-wrap" }, el("table", { class: "ready" },
        el("thead", {}, el("tr", {}, ["المقدار اليومي", "أيام الحفظ", "٥ أيام في الأسبوع", "كل يوم", "يناسب", ""].map((h) => el("th", { scope: "col" }, h)))),
        el("tbody", {}, rows))),
      el("p", { class: "muted plan-note" }, "الأسرع ليس الأفضل. الأفضل ما تستطيع أن تداوم عليه سنتين وأنت تراجع كل يوم."));
  }

  // ── methods ──────────────────────────────────────────
  methodsSection() {
    return this.section("methods", "طرق الحفظ", "ست طرق مجرّبة، كل منها من كلام صاحبها أو أهلها. لا تجمع بينها كلها: اختر واحدة للحفظ الجديد، والزم المراجعة اليومية مهما كانت طريقتك.",
      el("div", { class: "methods" }, METHODS.map((m) => el("article", { class: "method", id: `method-${m.id}` },
        el("header", { class: "method__head" },
          el("h3", {}, m.name),
          el("p", { class: "method__by" }, m.by, el("span", { class: "muted" }, `. ${m.src}`))),
        el("p", { class: "method__lead" }, m.lead),
        el("ol", { class: "method__steps" }, m.steps.map((s) => el("li", {}, s))),
        m.note ? el("p", { class: "method__note" }, m.note) : null,
        el("p", { class: "method__fit" }, el("b", {}, "تناسب: "), m.fit),
        m.apply ? el("div", { class: "method__apply" },
          el("a", { class: "btn", href: hifzHash(m.apply) }, "طبّقها في صفحة الحفظ"),
          el("span", { class: "muted" }, m.applyHint)) : null))));
  }

  // ── review ───────────────────────────────────────────
  reviewSection() {
    return this.section("review", "المراجعة", null,
      el("blockquote", { class: "hadith" },
        el("p", {}, `«${HADITH[0].text}»`), el("cite", {}, HADITH[0].src)),
      el("p", {}, "الحفظ بلا مراجعة يتفلّت، والمراجعة هي التي تجعل المحفوظ يبقى سنين. ولها ثلاث مراحل:"),
      el("div", { class: "stages" },
        el("div", { class: "stage" },
          el("h3", {}, "أثناء الحفظ"),
          el("p", {}, "قريب يومي: ما حفظته في الأيام الأخيرة. يجعله الشيخ القاسم خمسة أيام، ويجعله د. سعيد حمزة آخر ٢٠ صفحة. وبعيد يدور على كل ما قبله."),
          el("p", { class: "muted" }, "مقدار البعيد اليومي في طريقة الشيخ القاسم، وهو يحفظ من الناس إلى البقرة:"),
          el("table", { class: "mini" },
            el("tbody", {}, QASIM_REVIEW.map(([when, amount]) => el("tr", {}, el("td", {}, `أثناء حفظك ${when}`), el("td", {}, `${amount} كل يوم`)))))),
        el("div", { class: "stage" },
          el("h3", {}, "بعد الختم: سنة الإتقان"),
          el("p", {}, "إذا أتممت الحفظ فراجع القرآن كله من البقرة إلى الناس، خمسة أجزاء كل يوم، فتختم كل ستة أيام. والزم ذلك سنة كاملة، فيثبت حفظك كله بإذن الله."),
          el("p", { class: "muted" }, "من كتاب الشيخ عبد المحسن القاسم.")),
        el("div", { class: "stage" },
          el("h3", {}, "ثم: ختمة كل أسبوع"),
          el("p", {}, "قال النبي ﷺ لعبد الله بن عمرو: «فاقرأه في سبع ولا تزد على ذلك» (البخاري ٥٠٥٤). وقسّم أهل العلم الأسبوع سبعة أحزاب، يجمعها قولهم «فمي بشوق»، كل حرف أول سورة يبدأ بها ورد اليوم:"),
          el("table", { class: "mini manazil" },
            el("tbody", {}, MANAZIL.map(([letter, from, to], i) => el("tr", {},
              el("td", { class: "manazil__l" }, letter), el("td", {}, `اليوم ${ar(i + 1)}`), el("td", {}, `من ${from} إلى آخر ${to}`))))))),
      el("h3", { class: "plan-sub" }, "الآيات المتشابهة"),
      el("p", {}, "إذا اشتبهت عليك آيتان: افتح المصحف عليهما، وتأمل الفرق بينهما، واجعل لنفسك قاعدة تميّز بها كل واحدة. ثم ركّز على هذا الفرق كلما راجعتهما حتى تتقنه. واكتب المتشابهات التي تخطئ فيها في دفتر تراجعه."),
      el("p", { class: "muted" }, "من كتاب الشيخ عبد المحسن القاسم، وله كتاب مستقل في المتشابهات."));
  }

  // ── a day of memorization ────────────────────────────
  daySection() {
    const total = SESSION.reduce((n, s) => n + s.min, 0);
    return this.section("day", "يوم الحفظ", `جلسة نموذجية لحفظ صفحة، نحو ${ar(total)} دقيقة. ولثلث صفحة أو نصفها قلّل وقت الحفظ والتحضير، ولا تقلّل المراجعة.`,
      el("ol", { class: "dayplan" }, SESSION.map((s) => el("li", {},
        el("span", { class: "dayplan__min" }, `${ar(s.min)} د`),
        el("div", {}, el("strong", {}, s.what), el("p", {}, s.how))))),
      el("p", { class: "plan-note" },
        "في صفحة الحفظ: «تكرار كل آية» للتكرار، و«مهلة للترديد» لتردد بعد القارئ، و«أول كلمة فقط» أو «إخفاء» للتسميع، وتبويب «التفسير» لفهم المعنى."));
  }

  // ── rules ────────────────────────────────────────────
  rulesSection() {
    return this.section("rules", "قواعد تتفق عليها الطرق كلها", null,
      el("dl", { class: "rules" }, RULES.flatMap(([t, d]) => [el("dt", {}, t), el("dd", {}, d)])),
      el("div", { class: "hadiths" }, HADITH.slice(1).map((h) => el("blockquote", { class: "hadith hadith--sm" }, el("p", {}, `«${h.text}»`), el("cite", {}, h.src)))));
  }

  // ── memory research ──────────────────────────────────
  scienceSection() {
    return this.section("science", "ما يقوله علم الذاكرة", "هذه الدراسات على مواد أخرى غير القرآن، لكن نتائجها توافق ما جرى عليه أهل التحفيظ منذ قرون.",
      el("div", { class: "science" }, SCIENCE.map((s) => {
        const r = SOURCES.research[s.ref];
        return el("article", { class: "finding" },
          el("h3", {}, s.finding),
          el("p", {}, s.detail),
          el("p", { class: "finding__so" }, el("b", {}, "في الحفظ: "), s.so),
          el("a", { class: "finding__ref", href: r.url, target: "_blank", rel: "noopener", lang: "en", dir: "ltr" }, r.by));
      })));
  }

  // ── videos ───────────────────────────────────────────
  videosSection() {
    return this.section("videos", "شروح مرئية", "شروح الطرق بأصوات أصحابها وأهل التحفيظ. حلقة «فاهم» تبدأ من موضع شرح الحصون الخمسة.",
      el("div", { class: "video-grid" }, VIDEOS.map((v) => videoCard(v))));
  }

  // ── sources ──────────────────────────────────────────
  sourcesSection() {
    return this.section("sources", "المصادر", null,
      el("h3", { class: "plan-sub" }, "كتب ومواد"),
      el("ul", { class: "sources" }, SOURCES.books.map((b) => el("li", {},
        el("a", { href: b.url, target: "_blank", rel: "noopener" }, b.title), ` لـ${b.by}. `,
        el("span", { class: "muted" }, b.note), b.url2 ? el("span", {}, " (", el("a", { href: b.url2, target: "_blank", rel: "noopener" }, "رابط"), ")") : null))),
      el("h3", { class: "plan-sub" }, "دراسات"),
      el("ul", { class: "sources", lang: "en", dir: "ltr" }, Object.values(SOURCES.research).map((r) => el("li", {},
        el("a", { href: r.url, target: "_blank", rel: "noopener" }, r.title), `. ${r.by}.`))),
      el("p", { class: "muted plan-note" }, "أرقام الأحاديث: البخاري بترقيم فتح الباري، ومسلم بترقيم محمد فؤاد عبد الباقي. وهذه الصفحة دليل يعين على التنظيم، ولا تغني عن شيخ متقن تقرأ عليه."));
  }
}
