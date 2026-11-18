/** Renders the selected ayahs and keeps the live highlight in sync. */
import { ar, el, reducedMotion } from "./util.js";

const BASMALA = "بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ";

export class MushafView extends EventTarget {
  constructor({ root, head, wrap }) {
    super();
    this.root = root;
    this.head = head;
    this.wrap = wrap;
    this.words = new Map();   // "n:p" -> element
    this.ayahs = new Map();   // n -> element
    this.data = null;
    this.current = null;      // current word element
    this.currentAyah = null;
    this.selected = null;
    this.mode = "show";

    root.addEventListener("click", (e) => {
      const w = e.target.closest(".w");
      if (w) return this._emit("word", { n: +w.dataset.n, p: +w.dataset.p });
      const end = e.target.closest(".ayah-end");
      if (end) this._emit("ayahclick", { n: +end.dataset.n });
    });
    root.addEventListener("dblclick", (e) => {
      const w = e.target.closest(".w");
      if (w) this._emit("playword", { n: +w.dataset.n, p: +w.dataset.p });
    });
    root.addEventListener("keydown", (e) => {
      const w = e.target.closest(".w");
      if (!w || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      e.stopPropagation();
      this._emit(e.key === "Enter" ? "word" : "playword", { n: +w.dataset.n, p: +w.dataset.p });
    });
  }

  render(surah, from, to) {
    this.data = surah;
    this.words.clear();
    this.ayahs.clear();
    this.current = this.currentAyah = this.selected = null;

    this.head.replaceChildren(
      el("h2", { class: "surah-head__name" }, `سورة ${surah.name}`),
      el("p", { class: "surah-head__meta" },
        `${surah.place}، ${ar(surah.ayahs)} آية. المقطع من الآية ${ar(from)} إلى ${ar(to)}`),
      surah.bismillah && from === 1 ? el("p", { class: "basmala" }, BASMALA) : null,
    );

    const frag = document.createDocumentFragment();
    for (const a of surah.verses) {
      if (a.n < from || a.n > to) continue;
      const ayahEl = el("span", { class: "ayah", dataset: { n: a.n } });
      a.words.forEach((w, i) => {
        const wEl = el("span", {
          class: "w" + (i === 0 ? " first" : ""), tabindex: "0", role: "button",
          dataset: { n: a.n, p: w.p }, "aria-label": w.text,
        });
        let hasRules = false;
        for (const s of w.segs) {
          if (s.r) {
            hasRules = true;
            wEl.append(el("span", { class: "tj", dataset: { r: s.r } }, s.t));
          } else wEl.append(document.createTextNode(s.t));
        }
        if (hasRules) wEl.dataset.rules = [...new Set(w.rules.map((r) => r.r))].join(" ");
        this.words.set(`${a.n}:${w.p}`, wEl);
        ayahEl.append(wEl, " ");
      });
      ayahEl.append(el("span", {
        class: "ayah-end", dataset: { n: a.n }, title: `الآية ${ar(a.n)} — تشغيل من هنا`,
      }, a.end || ar(a.n)), " ");
      this.ayahs.set(a.n, ayahEl);
      frag.append(ayahEl);
    }
    this.root.replaceChildren(frag);
  }

  ayahData(n) { return this.data?.verses.find((v) => v.n === n); }
  wordData(n, p) { return this.ayahData(n)?.words.find((w) => w.p === p); }

  setAyah(n) {
    const a = this.ayahs.get(n);
    if (a === this.currentAyah) return;
    this.currentAyah?.classList.remove("is-current");
    this.currentAyah = a || null;
    a?.classList.add("is-current");
  }

  /** Highlight the word being recited (null = between words / outside). */
  setWord(n, p) {
    const w = p == null ? null : this.words.get(`${n}:${p}`);
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
    const n = +w.dataset.n, p = +w.dataset.p;
    const ayah = this.ayahs.get(n);
    ayah?.querySelectorAll(".w").forEach((x) => { if (+x.dataset.p <= p) x.classList.add("revealed"); });
  }

  /** Re-hide words (when the mode changes or a new pass begins). */
  resetReveal(n = null) {
    const scope = n == null ? this.root : this.ayahs.get(n);
    scope?.querySelectorAll(".w.revealed").forEach((x) => x.classList.remove("revealed"));
  }

  select(n, p) {
    this.selected?.classList.remove("is-selected");
    this.selected = this.words.get(`${n}:${p}`) || null;
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
