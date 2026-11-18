/**
 * «التفسير» panel: one dropdown of sources grouped by level (مختصر / متوسط /
 * موسّع), and a scope switch — the current ayah, or every ayah selected (the
 * chosen ayahs or the whole page). Source HTML is never inserted as markup:
 * it is parsed inertly and rebuilt from text nodes with a tiny allow-list.
 */
import { createTafsirStore, DEFAULT_SOURCE, LEVELS, mergePassages, PROVIDERS, SOURCES } from "./tafsir-data.js";
import { ar, el } from "./util.js";

async function fetchJson(url) {
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`تعذّر تحميل التفسير (خطأ ${r.status}).`);
  return r.json();
}

const QUOTE = /(﴿[^﴾]*﴾|\{[^{}]*\})/;

function quoted(text) {
  return text.split(QUOTE).filter(Boolean).map((part) =>
    QUOTE.test(part) && (part.startsWith("﴿") || part.startsWith("{")) ? el("span", { class: "tf-q" }, part) : document.createTextNode(part));
}

/** Rebuild provider HTML as paragraphs of text, quotes and line breaks only. */
function fromHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = [];
  let p = null;
  const para = () => (p ||= out[out.push(el("p")) - 1]);
  const inline = (node, into) => {
    for (const c of node.childNodes) {
      if (c.nodeType === Node.TEXT_NODE) into.append(...quoted(c.textContent));
      else if (c.nodeType !== Node.ELEMENT_NODE) continue;
      else if (c.tagName === "BR") into.append(el("br"));
      else if (c.tagName === "SUP") continue;
      else if (c.tagName === "SPAN" && /qpc-hafs|arabic/.test(c.className)) into.append(el("span", { class: "tf-q" }, c.textContent));
      else inline(c, into);
    }
  };
  for (const c of doc.body.childNodes) {
    if (c.nodeType === Node.ELEMENT_NODE && /^(P|DIV|H[1-6]|BLOCKQUOTE|LI)$/.test(c.tagName)) {
      p = null;
      const node = el("p", { class: /^H/.test(c.tagName) ? "tf-h" : null });
      inline(c, node);
      if (node.textContent.trim()) out.push(node);
    } else if (c.nodeType === Node.ELEMENT_NODE || c.nodeType === Node.TEXT_NODE) {
      const holder = el("span");
      inline({ childNodes: [c] }, holder);
      if (holder.textContent.trim() || holder.querySelector("br")) para().append(...holder.childNodes);
    }
  }
  return out;
}

function fromText(text) {
  return text.split(/\n\s*\n/).map((t) => t.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean)
    .map((t) => el("p", {}, quoted(t)));
}

const LONG = 1400; // characters

const span = (from, to) => (from === to ? `الآية ${ar(from)}` : `الآيات ${ar(from)}–${ar(to)}`);

export class TafsirPanel {
  /**
   * @param root      container element
   * @param onAyah    (s, n) => void  — a passage heading was chosen
   * @param state     { source, scope } initial values; onChange(patch) persists them
   */
  constructor({ root, onAyah, state = {}, onChange = () => {} }) {
    this.root = root;
    this.onAyah = onAyah;
    this.onChange = onChange;
    this.store = createTafsirStore(fetchJson);
    this.source = SOURCES.has(state.source) ? state.source : DEFAULT_SOURCE;
    this.scope = state.scope === "all" ? "all" : "ayah";
    this.segs = [];
    this.cur = null;
    this.token = 0;
    this.active = false;
    this._build();
  }

  _build() {
    this.select = el("select", { id: "tafsir-src", "aria-describedby": "tafsir-about" },
      LEVELS.map((l) => el("optgroup", { label: `${l.name}: ${l.hint}` },
        l.items.map((it) => el("option", { value: it.id }, it.name)))));
    this.select.value = this.source;
    this.select.addEventListener("change", () => { this.source = this.select.value; this.onChange({ tafsir: this.source }); this._about(); this.refresh(); });

    this.scopeCtl = el("div", { class: "seg-ctl seg-ctl--sm", role: "radiogroup", "aria-label": "نطاق التفسير" },
      el("button", { type: "button", role: "radio", dataset: { v: "ayah" } }, "الآية الحالية"),
      el("button", { type: "button", role: "radio", dataset: { v: "all" } }, "كل المحدّد"));
    this.scopeCtl.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || b.dataset.v === this.scope) return;
      this.scope = b.dataset.v;
      this.onChange({ tafsirScope: this.scope });
      this._syncScope();
      this.refresh();
    });
    this._syncScope();

    this.aboutEl = el("p", { class: "tf-about", id: "tafsir-about" });
    this.body = el("div", { class: "tf-body", "aria-live": "polite" });
    this.credit = el("p", { class: "tf-credit" });
    this.root.replaceChildren(
      el("div", { class: "panel__row" }, el("h2", { class: "panel__title" }, "التفسير"), this.scopeCtl),
      el("label", { class: "sr-only", for: "tafsir-src" }, "كتاب التفسير"),
      el("div", { class: "tf-pick" }, this.select),
      this.aboutEl, this.body, this.credit,
    );
    this._about();
  }

  _syncScope() {
    this.scopeCtl.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.v === this.scope)));
  }

  _about() {
    const src = SOURCES.get(this.source);
    this.aboutEl.replaceChildren(el("span", { class: `tf-level tf-level--${src.level.id}` }, src.level.name), ` ${src.by}. ${src.about}`);
    const prov = PROVIDERS[src.p];
    this.credit.replaceChildren("النص من ", el("a", { href: prov.url, target: "_blank", rel: "noopener" }, prov.name), " كما هو، دون تعديل.");
  }

  /** Panel visibility: fetch only while it is on screen. */
  setActive(on) {
    this.active = on;
    if (on) this.refresh();
  }

  setSelection(segs) {
    this.segs = segs.map(({ s, from, to }) => ({ id: s.id, name: s.name, from, to }));
    this.stale = true; // filled on the next refresh (needs the current ayah first)
    if (this.active) this.refresh();
  }

  setCurrent(s, n) {
    const changed = !this.cur || this.cur.s !== s || this.cur.n !== n;
    this.cur = { s, n };
    if (!this.active || (!changed && !this.stale)) return;
    if (this.scope === "ayah" || this.stale) this.refresh();
    else this._markCurrent(true);
  }

  async refresh() {
    if (!this.active || !this.cur) return;
    this.stale = false;
    const token = ++this.token;
    this.body.setAttribute("aria-busy", "true");
    this.body.replaceChildren(el("p", { class: "hint" }, "جارٍ تحميل التفسير…"));
    const multi = this.segs.length > 1;
    const targets = this.scope === "ayah"
      ? [{ id: this.cur.s, name: this.segs.find((x) => x.id === this.cur.s)?.name, from: this.cur.n, to: this.cur.n }]
      : this.segs;
    try {
      const sections = [];
      for (const seg of targets) {
        const ns = Array.from({ length: seg.to - seg.from + 1 }, (_, i) => seg.from + i);
        const es = await Promise.all(ns.map((n) => this.store.entry(this.source, seg.id, n)));
        if (token !== this.token) return;
        sections.push({ seg, blocks: mergePassages(ns.map((n, i) => ({ n, e: es[i] }))) });
      }
      this.body.replaceChildren(...sections.flatMap(({ seg, blocks }) => blocks.map((b) => this._block(seg, b, multi))));
      this._markCurrent(false);
    } catch (e) {
      if (token !== this.token) return;
      this.body.replaceChildren(el("p", { class: "tf-error" }, e.message || "تعذّر تحميل التفسير."),
        el("button", { class: "btn", type: "button", onclick: () => this.refresh() }, "إعادة المحاولة"));
    } finally {
      if (token === this.token) this.body.removeAttribute("aria-busy");
    }
  }

  _block(seg, b, multi) {
    const label = (multi ? `سورة ${seg.name}، ` : "") + span(b.from, b.to);
    const head = this.scope === "all"
      ? el("button", { type: "button", class: "tf-head", onclick: () => this.onAyah(seg.id, b.ayahs[0] ?? b.from) }, label)
      : el("p", { class: "tf-head" }, b.from === b.to ? label : `${label}، تفسيرها معًا`);
    const content = b.e
      ? (b.e.kind === "html" ? fromHtml(b.e.body) : fromText(b.e.body))
      : [el("p", { class: "hint" }, "لا يوجد نص لهذه الآية في هذا التفسير.")];
    const text = el("div", { class: "tf-text" }, content);
    const block = el("article", { class: "tf-block", dataset: { s: seg.id, from: b.from, to: b.to } }, head, text);
    // Over a whole page, long passages open folded so the list stays scannable.
    if (this.scope === "all" && text.textContent.length > LONG) {
      text.classList.add("is-folded");
      block.append(el("button", {
        type: "button", class: "tf-more",
        onclick: (e) => { text.classList.remove("is-folded"); e.currentTarget.remove(); },
      }, "اقرأ التفسير كاملًا"));
    }
    return block;
  }

  _markCurrent(scroll) {
    if (!this.cur) return;
    let hit = null;
    this.body.querySelectorAll(".tf-block").forEach((x) => {
      const on = +x.dataset.s === this.cur.s && this.cur.n >= +x.dataset.from && this.cur.n <= +x.dataset.to;
      x.classList.toggle("is-current", on && this.scope === "all");
      if (on && !hit) hit = x;
    });
    // Keep the current passage in view inside the side column (only when it scrolls on its own).
    const box = this.root.closest(".side");
    if (scroll && hit && box && box.scrollHeight > box.clientHeight) {
      const dy = hit.getBoundingClientRect().top - box.getBoundingClientRect().top;
      if (dy < 0 || dy > box.clientHeight - 80) box.scrollTo({ top: box.scrollTop + dy - 12, behavior: "smooth" });
    }
  }
}
