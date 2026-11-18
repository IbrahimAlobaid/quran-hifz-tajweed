/**
 * «تعلّم التجويد» — the learning section.
 * Routes: #/learn · #/learn/lesson/<slug> · #/learn/practice · #/learn/sheet · #/learn/mutun
 */
import { ClipPlayer } from "./clip.js";
import { learnData, progress } from "./learn-data.js";
import { ar, el } from "./util.js";

const CALLOUT_TITLE = { rule: "القاعدة", tip: "حيلةٌ للحفظ", note: "انتبِه", warning: "تنبيهٌ مهمّ" };
const TEACHING_RECITERS = [12, 6, 9, 168, 2, 7]; // shown first in the lesson reciter menu
const RID_KEY = "hifz.learn.rid";

const SVG_NS = "http://www.w3.org/2000/svg";
function icon(d, fill = true) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", d);
  p.setAttribute("fill", fill ? "currentColor" : "none");
  if (!fill) { p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "2"); p.setAttribute("stroke-linejoin", "round"); }
  svg.append(p);
  return svg;
}
const PLAY = "M8 5l11 7-11 7z";

/** «١٥ حرفًا» with the right Arabic number agreement. */
function lettersCount(n) {
  if (n === 1) return "حرفٌ واحد";
  if (n === 2) return "حرفان";
  if (n <= 10) return `${ar(n)} أحرف`;
  return `${ar(n)} حرفًا`;
}

/** Stable shuffle seeded by the question id, so the order never changes. */
function seededOrder(id, n) {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  const idx = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return idx;
}

export class LearnView {
  constructor({ root, clipAudio, reciters, onLeave }) {
    this.root = root;
    this.clip = new ClipPlayer(clipAudio);
    this.reciters = reciters;
    this.onLeave = onLeave;
    this.index = null;
    this.buttons = new Map(); // owner -> button
    let rid = 12;
    try { rid = +(localStorage.getItem(RID_KEY) || 12); } catch {}
    this.rid = reciters.some((r) => r.id === rid) ? rid : reciters[0]?.id;
    this.clip.addEventListener("state", ({ detail }) => {
      const b = this.buttons.get(detail.owner);
      if (!b) return;
      b.dataset.state = detail.state;
      b.setAttribute("aria-pressed", String(detail.state === "playing" || detail.state === "loading"));
    });
  }

  async show(route) {
    this.clip.stop();
    this.buttons.clear();
    try {
      this.index ||= await learnData.index();
      const [page, arg] = route;
      if (page === "lesson" && arg) await this.renderLesson(arg);
      else if (page === "practice") await this.renderPractice();
      else if (page === "sheet") await this.renderSheet();
      else if (page === "mutun") await this.renderMutun(arg);
      else this.renderHome();
    } catch (e) {
      this.root.replaceChildren(this.shell(el("div", { class: "state is-error" }, e.message || "تعذّر تحميل المحتوى.")));
    }
  }

  hide() { this.clip.stop(); }

  // ── chrome ───────────────────────────────────────────
  shell(...content) {
    const cur = location.hash;
    const link = (href, label) => el("a", { href, "aria-current": cur === href || (href !== "#/learn" && cur.startsWith(href)) ? "page" : null }, label);
    const sel = el("select", { id: "learn-reciter", "aria-label": "القارئ في الأمثلة" },
      [...this.reciters].sort((a, b) => {
        const ia = TEACHING_RECITERS.indexOf(a.id), ib = TEACHING_RECITERS.indexOf(b.id);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      }).map((r) => el("option", { value: r.id, selected: r.id === this.rid }, r.label)));
    sel.addEventListener("change", () => {
      this.rid = +sel.value;
      try { localStorage.setItem(RID_KEY, String(this.rid)); } catch {}
      this.clip.stop();
    });
    return el("div", { class: "learn__wrap" },
      el("div", { class: "learn__bar" },
        el("nav", { class: "subnav", "aria-label": "أقسام التعلّم" },
          link("#/learn", "الدروس"), link("#/learn/practice", "تدريب شامل"),
          link("#/learn/sheet", "خلاصة الأحكام"), link("#/learn/mutun", "المتون")),
        el("label", { class: "learn__reciter" }, el("span", {}, "صوت الأمثلة"), sel)),
      ...content);
  }

  playButton(owner, label, surah, ayah, words) {
    const b = el("button", { type: "button", class: "play-chip", "aria-pressed": "false", "aria-label": label, title: label },
      icon(PLAY), el("span", {}, label));
    b.addEventListener("click", () => this.clip.play(owner, this.rid, surah, ayah, words));
    this.buttons.set(owner, b);
    return b;
  }

  // ── home ─────────────────────────────────────────────
  renderHome() {
    const done = progress.get();
    const lessons = this.index.lessons;
    const pct = Math.round((lessons.filter((l) => done.has(l.slug)).length / lessons.length) * 100);
    const units = this.index.units.map((u, ui) => {
      const ls = lessons.filter((l) => l.unit === u.id);
      if (!ls.length) return null;
      return el("section", { class: "unit" },
        el("header", { class: "unit__head" },
          el("span", { class: "unit__n" }, ar(ui + 1)),
          el("div", {}, el("h2", {}, u.title), el("p", { class: "muted" }, u.description))),
        el("ol", { class: "lesson-list" }, ls.map((l) =>
          el("li", {},
            el("a", { href: `#/learn/lesson/${l.slug}`, class: "lesson-row" + (done.has(l.slug) ? " is-done" : "") },
              el("span", { class: "lesson-row__n" }, ar(l.order)),
              el("span", { class: "lesson-row__body" },
                el("strong", {}, l.title),
                el("span", { class: "muted" }, l.description)),
              el("span", { class: "lesson-row__meta" },
                l.videos ? el("span", { class: "tag", title: "فيه شرحٌ مرئيّ" }, "فيديو") : null,
                l.quiz ? el("span", { class: "tag" }, `${ar(l.quiz)} أسئلة`) : null,
                el("span", { class: "muted" }, `${ar(l.minutes)} د`),
                el("span", { class: "check", "aria-label": done.has(l.slug) ? "مكتمل" : "" }, done.has(l.slug) ? "✓" : ""))))),
        ),
      );
    });
    const next = lessons.find((l) => !done.has(l.slug));
    this.root.replaceChildren(this.shell(
      el("header", { class: "learn-hero" },
        el("h1", {}, "تعلّم أحكام التجويد"),
        el("p", {}, `${ar(lessons.length)} درسًا في ${ar(this.index.units.length)} وحدة على رواية حفص عن عاصم من طريق الشاطبية، من الأسهل إلى الأصعب. كل مثالٍ تسمعه بصوت القارئ الذي تختاره، كلمةً بكلمة.`),
        el("div", { class: "progress" },
          el("div", { class: "progress__bar" }, el("div", { style: `width:${pct}%` })),
          el("span", {}, `أتممت ${ar(done.size)} من ${ar(lessons.length)}`)),
        next ? el("a", { class: "btn btn--primary", href: `#/learn/lesson/${next.slug}` }, done.size ? `تابِع: ${next.title}` : "ابدأ الدرس الأول") : null),
      ...units,
      this.credits(),
    ));
  }

  credits() {
    const c = this.index.credits;
    return el("footer", { class: "credits" },
      el("p", {}, "المحتوى التعليمي مأخوذ من ",
        el("a", { href: c.lessons.url, target: "_blank", rel: "noopener" }, c.lessons.name), ` (رخصة ${c.lessons.license}). `,
        "نصّا تحفة الأطفال والجزرية من ويكي مصدر بترقيم ",
        el("a", { href: c.mutun.url, target: "_blank", rel: "noopener" }, c.mutun.name), ` (${c.mutun.license}). `,
        "التلاوات وتوقيت الكلمات من Quran.com."),
      el("p", { class: "muted" }, "إن وجدت خطأً في حكمٍ فراجِع به أهل العلم، فهذه أداة مساعدة وليست بديلًا عن التلقّي من شيخٍ متقن."));
  }

  // ── lesson ───────────────────────────────────────────
  async renderLesson(slug) {
    const lesson = await learnData.lesson(slug);
    const list = this.index.lessons;
    const i = list.findIndex((l) => l.slug === slug);
    const prev = list[i - 1], next = list[i + 1];
    const unit = this.index.units.find((u) => u.id === lesson.unit);
    const done = progress.get().has(slug);

    const doneBtn = el("button", { type: "button", class: "btn" + (done ? " is-done" : " btn--primary") }, done ? "✓ أتممتُ هذا الدرس" : "أتممتُ هذا الدرس");
    doneBtn.addEventListener("click", () => {
      const now = !progress.get().has(slug);
      progress.set(slug, now);
      doneBtn.className = "btn" + (now ? " is-done" : " btn--primary");
      doneBtn.textContent = now ? "✓ أتممتُ هذا الدرس" : "أتممتُ هذا الدرس";
    });

    const body = lesson.blocks.map((b, bi) => this.block(b, `${slug}:${bi}`)).filter(Boolean);
    const videos = lesson.videos.length ? el("section", { class: "videos" },
      el("h2", {}, "شاهِد الشرح"),
      el("div", { class: "video-grid" }, lesson.videos.map((v) => this.video(v)))) : null;
    const resources = lesson.resources.length ? el("section", { class: "resources" },
      el("h2", {}, "للاستزادة"),
      el("ul", {}, lesson.resources.map((r) => el("li", {},
        el("a", { href: r.url, target: "_blank", rel: "noopener" }, r.title), r.note ? el("span", { class: "muted" }, ` — ${r.note}`) : null)))) : null;

    this.root.replaceChildren(this.shell(
      el("article", { class: "lesson" },
        el("p", { class: "lesson__crumb" }, el("a", { href: "#/learn" }, "الدروس"), " / ", unit?.title || ""),
        el("h1", {}, lesson.title),
        el("p", { class: "lesson__desc" }, lesson.description),
        el("p", { class: "lesson__meta muted" }, `الدرس ${ar(lesson.order)} من ${ar(list.length)}، نحو ${ar(lesson.minutes)} دقائق`),
        ...body, videos, resources,
        el("div", { class: "lesson__end" },
          doneBtn,
          el("nav", { class: "pager" },
            prev ? el("a", { href: `#/learn/lesson/${prev.slug}`, class: "pager__link" }, el("span", { class: "muted" }, "السابق"), prev.title) : el("span"),
            next ? el("a", { href: `#/learn/lesson/${next.slug}`, class: "pager__link pager__link--next" }, el("span", { class: "muted" }, "التالي"), next.title) : el("span")))),
    ));
    window.scrollTo({ top: 0 });
  }

  ruleInfo(id) { return this.index.rules[id]; }

  ruleChip(id) {
    const r = this.ruleInfo(id);
    if (!r) return null;
    return el("a", { class: "rule-chip", dataset: { fam: r.color }, href: `#/learn/lesson/${r.lesson}`, title: r.short }, r.name);
  }

  /** Quran words with our tajweed colouring; `marks` = [{from,to,rule}] by word position. */
  quranWords(words, { marks = [], hl = null, color = true } = {}) {
    const box = el("p", { class: "lq" + (color ? " tj-on" : "") });
    for (const w of words) {
      const m = marks.find((x) => w.p >= x.from && w.p <= x.to);
      const inHl = hl ? w.p >= hl[0] && w.p <= hl[1] : true;
      const fam = m ? this.ruleInfo(m.rule)?.color : null;
      const span = el("span", { class: "lq__w" + (m ? " is-mark" : "") + (inHl ? "" : " is-faint"), dataset: fam ? { fam } : {} });
      for (const s of w.segs) span.append(s.r ? el("span", { class: "tj", dataset: { r: s.r } }, s.t) : s.t);
      box.append(span, " ");
    }
    return box;
  }

  block(b, key) {
    switch (b.t) {
      case "md": { const d = el("div", { class: "prose" }); d.innerHTML = b.html; return d; }
      case "callout": {
        const d = el("aside", { class: `callout callout--${b.kind}` }, el("p", { class: "callout__title" }, CALLOUT_TITLE[b.kind]));
        const inner = el("div", { class: "prose" }); inner.innerHTML = b.html; d.append(inner);
        return d;
      }
      case "ayah": {
        const rules = [...new Set(b.marks.map((m) => m.rule).filter(Boolean))];
        const note = el("p", { class: "ayah-card__note" }); note.innerHTML = b.note;
        return el("figure", { class: "ayah-card" },
          this.quranWords(b.words, { marks: b.marks }),
          el("figcaption", {},
            el("span", { class: "muted" }, `سورة ${b.name}، الآية ${ar(b.ayah)}`),
            el("span", { class: "ayah-card__btns" },
              b.marks.length ? this.playButton(`${key}:m`, "موضع الحكم", b.surah, b.ayah, [b.marks[0].from, b.marks[b.marks.length - 1].to]) : null,
              this.playButton(`${key}:a`, b.whole ? "الآية" : "المقطع", b.surah, b.ayah, b.whole ? null : [b.words[0].p, b.words[b.words.length - 1].p]))),
          rules.length ? el("div", { class: "chips" }, rules.map((r) => this.ruleChip(r))) : null,
          b.note ? note : null);
      }
      case "examples": {
        return el("div", { class: "examples" },
          b.title ? el("h3", {}, b.title) : null,
          el("div", { class: "examples__grid" }, b.items.map((it, ii) => {
            const fam = this.ruleInfo(it.rule)?.color;
            return el("div", { class: "example", dataset: fam ? { fam } : {} },
              this.quranWords(it.words, { hl: it.hl, marks: it.hl ? [{ from: it.hl[0], to: it.hl[1], rule: it.rule }] : [] }),
              el("div", { class: "example__foot" },
                it.note ? el("span", { class: "example__note" }, it.note) : el("span"),
                el("span", { class: "muted example__ref" }, `${ar(it.surah)}:${ar(it.ayah)}`),
                this.playButton(`${key}:${ii}`, "استمع", it.surah, it.ayah, [it.words[0].p, it.words[it.words.length - 1].p])));
          })),
          b.rule ? el("div", { class: "chips" }, this.ruleChip(b.rule)) : null);
      }
      case "letters": {
        const fam = this.ruleInfo(b.rule)?.color;
        const note = el("p", { class: "muted" }); note.innerHTML = b.note;
        return el("div", { class: "letters", dataset: fam ? { fam } : {} },
          el("p", { class: "letters__title" }, b.title || "الحروف", el("span", { class: "muted" }, ` (${lettersCount(b.items.length)})`)),
          el("div", { class: "letters__set" }, b.items.map((x) => el("span", { class: "letter" }, x))),
          b.mnemonic ? el("p", { class: "letters__mnemonic" }, b.mnemonic) : null,
          b.note ? note : null);
      }
      case "mistake": {
        const row = (cls, label, html) => { const p = el("p", { class: cls }, el("b", {}, label)); const s = el("span"); s.innerHTML = html; p.append(s); return p; };
        return el("div", { class: "mistake" },
          row("mistake__wrong", "خطأ شائع: ", b.wrong), row("mistake__right", "الصواب: ", b.right), row("mistake__why", "لماذا؟ ", b.why));
      }
      case "compare":
        return el("div", { class: "compare" }, b.columns.map((c) => {
          const fam = this.ruleInfo(c.rule)?.color;
          return el("div", { class: "compare__col", dataset: fam ? { fam } : {} },
            el("h3", {}, c.title),
            el("ul", {}, c.points.map((p) => { const li = el("li"); li.innerHTML = p; return li; })));
        }));
      case "quiz":
        return this.quiz(b.questions, b.title || "اختبِر نفسك");
      default:
        return null;
    }
  }

  quiz(questions, title, { onFinish } = {}) {
    let answered = 0, correct = 0;
    const score = el("p", { class: "quiz__score", "aria-live": "polite" });
    const items = questions.map((q, qi) => {
      const order = seededOrder(q.id, q.options.length);
      const why = el("p", { class: "quiz__why", hidden: true }); why.innerHTML = q.why;
      const opts = order.map((oi) => {
        const b = el("button", { type: "button", class: "quiz__opt" });
        b.innerHTML = q.options[oi];
        b.addEventListener("click", () => {
          if (li.dataset.done) return;
          li.dataset.done = "1";
          answered++;
          const ok = oi === q.answer;
          if (ok) correct++;
          b.classList.add(ok ? "is-right" : "is-wrong");
          opts.forEach((x, k) => { x.disabled = true; if (order[k] === q.answer) x.classList.add("is-right"); });
          why.hidden = false;
          why.prepend(el("b", {}, ok ? "أحسنت. " : "ليس كذلك. "));
          score.textContent = `النتيجة: ${ar(correct)} من ${ar(answered)}` + (answered === questions.length ? ` — انتهى الاختبار` : "");
          if (answered === questions.length) onFinish?.(correct);
        });
        return b;
      });
      const qText = el("p", { class: "quiz__q" }, el("span", { class: "quiz__n" }, `${ar(qi + 1)}.`));
      const qs = el("span"); qs.innerHTML = q.q; qText.append(qs);
      const li = el("li", { class: "quiz__item" },
        q.words ? el("div", { class: "quiz__ayah" }, this.quranWords(q.words, { color: false }), el("span", { class: "muted" }, `${ar(q.surah)}:${ar(q.ayah)}`)) : null,
        qText,
        el("div", { class: "quiz__opts" }, opts),
        why,
        q.lesson && onFinish ? el("a", { class: "quiz__lesson", href: `#/learn/lesson/${q.lesson}` }, "راجِع الدرس") : null);
      return li;
    });
    return el("section", { class: "quiz" }, el("h2", {}, title), el("ol", { class: "quiz__list" }, items), score);
  }

  video(v) {
    const box = el("div", { class: "video" });
    const btn = el("button", { type: "button", class: "video__facade" },
      el("span", { class: "video__play" }, icon(PLAY)),
      el("span", { class: "video__title" }, v.title),
      el("span", { class: "muted" }, "يُحمَّل من YouTube عند الضغط"));
    btn.addEventListener("click", () => {
      const start = v.start ? `&start=${+v.start}` : "";
      box.replaceChildren(el("iframe", {
        src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?autoplay=1&rel=0${start}`,
        title: v.title, allow: "autoplay; encrypted-media; picture-in-picture", allowfullscreen: true, loading: "lazy",
        referrerpolicy: "strict-origin-when-cross-origin",
      }));
    });
    box.append(btn);
    return box;
  }

  // ── practice ─────────────────────────────────────────
  async renderPractice() {
    const bank = await learnData.practice();
    const draw = () => {
      const pick = [...bank].sort(() => Math.random() - 0.5).slice(0, 10);
      const again = el("button", { type: "button", class: "btn btn--primary" }, "عشرة أسئلة أخرى");
      again.addEventListener("click", draw);
      this.root.replaceChildren(this.shell(
        el("header", { class: "learn-hero learn-hero--sm" },
          el("h1", {}, "تدريب شامل"),
          el("p", {}, `عشرة أسئلة مختارة عشوائيًا من ${ar(bank.length)} سؤالًا في جميع الدروس. بعد كل إجابة ترى السبب ورابط الدرس.`)),
        this.quiz(pick, "الأسئلة", { onFinish: () => {} }),
        el("div", { class: "lesson__end" }, again)));
      window.scrollTo({ top: 0 });
    };
    draw();
  }

  // ── cheat sheet ──────────────────────────────────────
  async renderSheet() {
    const s = await learnData.cheatsheet();
    const d = el("div", { class: "prose prose--sheet" }); d.innerHTML = s.html;
    this.root.replaceChildren(this.shell(el("article", { class: "lesson" }, el("h1", {}, s.title), d)));
  }

  // ── mutun ────────────────────────────────────────────
  async renderMutun(anchor) {
    const mutun = await learnData.mutun();
    const tabs = el("div", { class: "seg-ctl", role: "tablist" });
    const panes = mutun.map((m, i) => {
      const b = el("button", { type: "button", role: "tab", "aria-selected": String(i === 0), "aria-checked": String(i === 0) }, m.title.split(" ")[0] === "تحفة" ? "تحفة الأطفال" : "المقدمة الجزرية");
      tabs.append(b);
      const pane = el("section", { class: "matn", hidden: i !== 0, id: `matn-${m.key}` },
        el("h2", {}, m.title), el("p", { class: "muted" }, `نظم ${m.author}. المصدر: ${m.source}.`),
        ...m.sections.map((s) => el("div", { class: "matn__sec" },
          el("h3", {}, s.title),
          el("ol", { class: "matn__lines" }, s.lines.map((l) =>
            el("li", { id: `${m.key}-${l.n}`, class: "bayt" },
              el("span", { class: "bayt__n" }, ar(l.n)),
              el("span", { class: "bayt__a" }, l.a),
              el("span", { class: "bayt__b" }, l.b)))))));
      b.addEventListener("click", () => {
        tabs.querySelectorAll("button").forEach((x) => { x.setAttribute("aria-selected", String(x === b)); x.setAttribute("aria-checked", String(x === b)); });
        this.root.querySelectorAll(".matn").forEach((p) => { p.hidden = p !== pane; });
      });
      return pane;
    });
    this.root.replaceChildren(this.shell(
      el("header", { class: "learn-hero learn-hero--sm" },
        el("h1", {}, "المتون"),
        el("p", {}, "نصّا المتنين اللذين يحفظهما طلاب التجويد. عند كل حكم في صفحة الحفظ تجد الأبيات التي تنصّ عليه."),
        tabs),
      ...panes));
    if (anchor) {
      const [key] = anchor.split("-");
      const idx = mutun.findIndex((m) => m.key === key);
      if (idx >= 0) tabs.children[idx].click();
      const target = document.getElementById(anchor);
      if (target) { target.classList.add("is-target"); target.scrollIntoView({ block: "center" }); }
    } else window.scrollTo({ top: 0 });
  }
}
