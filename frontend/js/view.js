/**
 * Renders the selection and keeps the live highlight in sync.
 *
 * A selection is a list of segments `[{ s: surahData, from, to }]`:
 *   "flow" layout — one segment, ayahs run as a justified paragraph;
 *   "page" layout — a full Madinah-mushaf page, line by line (words carry their
 *                   mushaf line `ln`), possibly spanning up to three surahs.
 * Everything is keyed by surah too ("s:n" / "s:n:p") so a page that holds the
 * end of one surah and the start of the next never confuses ayah numbers.
 */
import { juzName } from "./mushaf-meta.js";
import { ar, el, reducedMotion } from "./util.js";

const BASMALA = "بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ";
const MAX_PAGE_FONT = 40;
const MIN_PAGE_FONT = 11; // keep the 15 mushaf lines down to a small phone; reflow only below this

export class MushafView extends EventTarget {
  /** wrap: the element whose inner width the page fills; foot: where the page number goes. */
  constructor({ root, head, wrap, foot }) {
    super();
    this.root = root;
    this.head = head;
    this.wrap = wrap;
    this.foot = foot;
    this.words = new Map();   // "s:n:p" -> element
    this.ayahs = new Map();   // "s:n"   -> [elements] (an ayah may span several lines)
    this.segs = [];
    this.layout = "flow";
    this.current = null;
    this.currentAyah = [];
    this.selected = null;
    this.mode = "show";

    const at = (x) => ({ s: +x.dataset.s, n: +x.dataset.n, p: x.dataset.p ? +x.dataset.p : undefined });
    root.addEventListener("click", (e) => {
      const w = e.target.closest(".w");
      if (w) return this._emit("word", at(w));
      const end = e.target.closest(".ayah-end");
      if (end) this._emit("ayahclick", at(end));
    });
    root.addEventListener("dblclick", (e) => {
      const w = e.target.closest(".w");
      if (w) this._emit("playword", at(w));
    });
    root.addEventListener("keydown", (e) => {
      const w = e.target.closest(".w");
      if (!w || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      e.stopPropagation();
      this._emit(e.key === "Enter" ? "word" : "playword", at(w));
    });
    let lastW = 0;
    new ResizeObserver(() => {
      if (this.layout !== "page" || wrap.clientWidth === lastW) return;
      lastW = wrap.clientWidth;
      this._fitPage();
    }).observe(wrap);
  }

  /** @param segs [{s, from, to}]  @param opts {layout: "flow"|"page", page} */
  render(segs, { layout = "flow", page = null } = {}) {
    this.segs = segs;
    this.layout = layout;
    this.words.clear();
    this.ayahs.clear();
    this.current = this.selected = null;
    this.currentAyah = [];
    this.root.classList.toggle("mushaf--page", layout === "page");
    if (layout === "page") this._renderPage(segs, page);
    else this._renderFlow(segs[0]);
  }

  _renderFlow({ s, from, to }) {
    this.foot?.replaceChildren();
    this.root.style.removeProperty("--page-font");
    this.root.style.removeProperty("--page-w");
    this.head.replaceChildren(
      el("h2", { class: "surah-head__name" }, `سورة ${s.name}`),
      el("p", { class: "surah-head__meta" },
        `${s.place}، ${ar(s.ayahs)} آية. المقطع من الآية ${ar(from)} إلى ${ar(to)}`),
      s.bismillah && from === 1 ? el("p", { class: "basmala" }, BASMALA) : null,
    );
    const frag = document.createDocumentFragment();
    for (const a of s.verses) {
      if (a.n < from || a.n > to) continue;
      const ayahEl = this._ayahEl(s.id, a.n);
      a.words.forEach((w, i) => ayahEl.append(this._wordEl(s.id, a.n, w, i === 0), " "));
      ayahEl.append(this._endEl(s.id, a), " ");
      frag.append(ayahEl);
    }
    this.root.replaceChildren(frag);
  }

  _renderPage(segs, page) {
    const first = segs[0];
    const v0 = first.s.verses.find((v) => v.n === first.from);
    // As in the printed mushaf: the juz on the right, the surah on the left, the page number below.
    this.head.replaceChildren(
      el("p", { class: "page-head" },
        el("span", { class: "page-head__juz" }, juzName(v0?.juz ?? 1)),
        el("span", { class: "page-head__surah" }, `سورة ${first.s.name}`)),
    );
    this.foot?.replaceChildren(ar(page));

    // Flatten the page into [line, item] in reading order, then group by line.
    const lines = [];
    let line = null;
    const lineFor = (ln) => {
      if (!line || line.ln !== ln) { line = { ln, items: [] }; lines.push(line); }
      return line;
    };
    for (const { s, from, to } of segs) {
      if (from === 1) {
        line = null;
        lines.push({ header: s });
      }
      for (const a of s.verses) {
        if (a.n < from || a.n > to) continue;
        a.words.forEach((w, i) => lineFor(w.ln).items.push({ s: s.id, a, w, first: i === 0 }));
        lineFor(a.end_ln ?? a.words.at(-1)?.ln).items.push({ s: s.id, a, end: true });
      }
    }

    const frag = document.createDocumentFragment();
    for (const ln of lines) {
      if (ln.header) {
        frag.append(el("div", { class: "page-surah" },
          el("span", { class: "page-surah__m", title: "ترتيبها في المصحف" }, el("small", {}, "ترتيبها"), ar(ln.header.id)),
          el("span", { class: "page-surah__name" }, `سورة ${ln.header.name}`),
          el("span", { class: "page-surah__m", title: "عدد آياتها" }, el("small", {}, "آياتها"), ar(ln.header.ayahs))));
        if (ln.header.bismillah) frag.append(el("p", { class: "basmala basmala--page" }, BASMALA));
        continue;
      }
      const row = el("div", { class: "line" });
      let frag2 = null, fkey = null;
      for (const it of ln.items) {
        const key = `${it.s}:${it.a.n}`;
        if (key !== fkey) { frag2 = this._ayahEl(it.s, it.a.n); row.append(frag2); fkey = key; }
        frag2.append(it.end ? this._endEl(it.s, it.a) : this._wordEl(it.s, it.a.n, it.w, it.first), " ");
      }
      frag.append(row);
    }
    this.root.replaceChildren(frag);
    this.root.classList.toggle("page--opening", page <= 2);
    this._fitPage();
  }

  /** Scale the page so its longest line fits the reader, like a printed page.
   *  On a narrow screen the same page reflows as a paragraph instead. */
  async _fitPage() {
    const root = this.root;
    const cs = getComputedStyle(this.wrap);
    const avail = this.wrap.clientWidth - parseFloat(cs.paddingInlineStart) - parseFloat(cs.paddingInlineEnd);
    if (!avail || !root.isConnected) return;
    try { await document.fonts.load("20px UthmanicHafs"); } catch { /* fall back to whatever loaded */ }
    root.classList.remove("page--reflow");
    root.classList.add("is-measuring");
    root.style.setProperty("--page-font", "20px");
    const lines = [...root.querySelectorAll(".line")];
    const widths = lines.map((l) => l.scrollWidth);
    root.classList.remove("is-measuring");
    const max = Math.max(...widths, 1);
    const userMax = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--q-size")) || MAX_PAGE_FONT;
    const size = Math.min((20 * avail * 0.97) / max, MAX_PAGE_FONT, Math.max(userMax, 22));
    if (size < MIN_PAGE_FONT) {
      root.classList.add("page--reflow");
      root.style.removeProperty("--page-font");
      root.style.removeProperty("--page-w");
      return;
    }
    root.style.setProperty("--page-font", `${size.toFixed(2)}px`);
    root.style.setProperty("--page-w", `${Math.ceil((max * size) / 20)}px`);
    // A line much shorter than the page (end of a surah, opening pages) is centred, not stretched.
    lines.forEach((l, i) => l.classList.toggle("line--short", widths[i] < max * 0.78));
  }

  _ayahEl(s, n) {
    const node = el("span", { class: "ayah", dataset: { s, n } });
    const key = `${s}:${n}`;
    if (!this.ayahs.has(key)) this.ayahs.set(key, []);
    this.ayahs.get(key).push(node);
    return node;
  }

  _wordEl(s, n, w, first) {
    const wEl = el("span", {
      class: "w" + (first ? " first" : ""), tabindex: "0", role: "button",
      dataset: { s, n, p: w.p }, "aria-label": w.text,
    });
    let hasRules = false;
    for (const seg of w.segs) {
      if (seg.r) {
        hasRules = true;
        wEl.append(el("span", { class: "tj", dataset: { r: seg.r } }, seg.t));
      } else wEl.append(document.createTextNode(seg.t));
    }
    if (hasRules) wEl.dataset.rules = [...new Set(w.rules.map((r) => r.r))].join(" ");
    this.words.set(`${s}:${n}:${w.p}`, wEl);
    return wEl;
  }

  _endEl(s, a) {
    return el("span", {
      class: "ayah-end", dataset: { s, n: a.n }, title: `الآية ${ar(a.n)} — تشغيل من هنا`,
    }, a.end || ar(a.n));
  }

  seg(s) { return this.segs.find((x) => x.s.id === s); }
  ayahData(s, n) { return this.seg(s)?.s.verses.find((v) => v.n === n); }
  wordData(s, n, p) { return this.ayahData(s, n)?.words.find((w) => w.p === p); }

  setAyah(s, n) {
    const parts = this.ayahs.get(`${s}:${n}`) || [];
    if (parts[0] && parts[0] === this.currentAyah[0]) return;
    this.currentAyah.forEach((x) => x.classList.remove("is-current"));
    this.currentAyah = parts;
    parts.forEach((x) => x.classList.add("is-current"));
  }

  /** Highlight the word being recited (null = between words / outside). */
  setWord(s, n, p) {
    const w = p == null ? null : this.words.get(`${s}:${n}:${p}`);
    if (!w) return; // keep last word lit during short silences
    if (w === this.current) return;
    this.current?.classList.remove("is-current");
    this.current = w;
    w.classList.add("is-current");
    // Progressive reveal only in "reveal" / "first" modes; "hide" stays hidden for self-testing.
    if (this.mode === "reveal" || this.mode === "first") this._revealUpTo(w);
    this._scrollIntoView(w);
  }

  clearWord() {
    this.current?.classList.remove("is-current");
    this.current = null;
  }

  /** "Reveal as recited": every word before the current one becomes visible. */
  _revealUpTo(w) {
    const p = +w.dataset.p;
    for (const part of this.ayahs.get(`${w.dataset.s}:${w.dataset.n}`) || []) {
      part.querySelectorAll(".w").forEach((x) => { if (+x.dataset.p <= p) x.classList.add("revealed"); });
    }
  }

  /** Re-hide words (when the mode changes or a new pass begins). */
  resetReveal(s = null, n = null) {
    const scopes = n == null ? [this.root] : this.ayahs.get(`${s}:${n}`) || [];
    for (const sc of scopes) sc.querySelectorAll(".w.revealed").forEach((x) => x.classList.remove("revealed"));
  }

  select(s, n, p) {
    this.selected?.classList.remove("is-selected");
    this.selected = this.words.get(`${s}:${n}:${p}`) || null;
    this.selected?.classList.add("is-selected");
  }

  setMode(mode) {
    this.root.classList.remove("mode-show", "mode-hide", "mode-reveal", "mode-first");
    this.root.classList.add(`mode-${mode}`);
    this.mode = mode;
    this.resetReveal();
  }

  /** Emphasise one rule only (null clears). */
  focusRule(rule) {
    this.root.classList.toggle("focusing", !!rule);
    this.root.querySelectorAll(".is-focus").forEach((x) => x.classList.remove("is-focus"));
    this.root.querySelectorAll(".has-focus").forEach((x) => x.classList.remove("has-focus"));
    if (!rule) return;
    this.root.querySelectorAll(`.tj[data-r="${CSS.escape(rule)}"]`).forEach((x) => {
      x.classList.add("is-focus");
      x.closest(".w").classList.add("has-focus");
    });
  }

  _scrollIntoView(node) {
    const r = node.getBoundingClientRect();
    const top = 80, bottom = innerHeight - 120;
    if (r.top >= top && r.bottom <= bottom) return;
    node.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
  }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
}
