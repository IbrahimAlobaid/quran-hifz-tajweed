/**
 * The reading page as a gallery-style viewer: a top bar (back to the page
 * grid, title, tools), the page, previous / next page buttons and the player
 * at the bottom, a floating tajweed button, and a bottom sheet holding the
 * tajweed / tafsir / similar-verses panels. The bars hide while you read and
 * a tap on the page brings them back. Pages turn like a photo carousel: the
 * neighbouring pages are rendered beside the page and follow the finger.
 * Pen marks and the five switches live in localStorage. main.js keeps the
 * selection, the player and the panels.
 */
import { juzName, mushafIndex } from "./mushaf-meta.js";
import { ar, el } from "./util.js";

const MARKS_KEY = "hifz.marks.v1";
const HINT_KEY = "hifz.barsHint.v1";
const $ = (id) => document.getElementById(id);
const wide = () => matchMedia("(min-width: 1200px)").matches;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// the carousel: how far, how fast, and the deceleration a page settles with
const COMMIT_FRACTION = 0.45;   // of the page width
const FLICK_SPEED = 0.45;       // px per ms, measured over the last 100 ms
const EASE = "cubic-bezier(.22, .8, .3, 1)"; // eases out, never overshoots

export const pen = {
  load() { try { return new Set(JSON.parse(localStorage.getItem(MARKS_KEY) || "[]")); } catch { return new Set(); } },
  save(set) { try { localStorage.setItem(MARKS_KEY, JSON.stringify([...set])); } catch { /* storage unavailable */ } },
};

export class Viewer {
  /**
   * opts: settings, save, surahs, goPage(P) → Promise, openSurah(id), preload(P) → Promise,
   * words() → Map "s:n:p" → element, onSettings(changed), sheetTab(v)
   */
  constructor(opts) {
    Object.assign(this, opts);
    this.marks = pen.load();
    this.penOn = false;
    this.sheetState = "closed";
    this.index = null;
    this.page = null;
    this.settling = false;
    this.suppressClick = false;

    $("v-grid").addEventListener("click", () => this.openGrid());
    $("grid-close").addEventListener("click", () => this.closeGrid());
    $("pagegrid").addEventListener("keydown", (e) => { if (e.key === "Escape") this.closeGrid(); });
    $("grid-by").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      this.save({ navBy: b.dataset.v });
      this.renderGrid();
    });
    $("pagegrid").addEventListener("click", (e) => { if (e.target.closest(".pagegrid__links a")) this.closeGrid(false); });

    // menu
    const menu = $("v-menu"), more = $("v-more");
    const closeMenu = () => { menu.hidden = true; more.setAttribute("aria-expanded", "false"); };
    more.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      more.setAttribute("aria-expanded", String(!menu.hidden));
    });
    document.addEventListener("click", (e) => { if (!e.target.closest("#v-menu")) closeMenu(); });
    menu.addEventListener("click", (e) => { if (e.target.closest("a, button")) closeMenu(); });
    $("v-theme").addEventListener("click", () => { $("theme-btn").click(); this.showTheme(); });
    $("v-settings").addEventListener("click", () => this.openSettings());

    // tools
    $("v-opts").addEventListener("click", () => this.setDetailed(!this.settings.detailed));
    $("v-pen").addEventListener("click", () => this.setPen(!this.penOn));
    $("pen-done").addEventListener("click", () => this.setPen(false));
    $("pen-clear").addEventListener("click", () => {
      const keys = [...this.marks].filter((k) => this.words().has(k));
      if (!keys.length || !confirm(`تُمسح ${ar(keys.length)} علامة من هذه الصفحة. هل تريد المتابعة؟`)) return;
      keys.forEach((k) => this.marks.delete(k));
      pen.save(this.marks);
      this.paintMarks();
    });

    // sheet
    // the floating button opens the panel on its first enabled tab (tajweed, else tafsir, else similar verses)
    $("fab-tj").addEventListener("click", () => { this.sheetTab(this.firstPanel()); this.openSheet(); });
    $("sheet-close").addEventListener("click", () => this.setSheet("closed"));
    this.dragSheet();
    matchMedia("(min-width: 1200px)").addEventListener("change", () => this.setSheet(this.sheetState));

    this.carousel();
    this.bars();

    // the page leaves room for the dock (sheet handle, page buttons, player) whatever its height
    const dock = $("dock");
    new ResizeObserver(() => $("view-hifz").style.setProperty("--dock-h", `${dock.offsetHeight}px`)).observe(dock);

    this.initSettings();
    this.setSheet(wide() && this.settings.panelOpen !== false ? "half" : "closed");
  }

  canStep(dir) { return !!this.page && !this.settling && this.page + dir >= 1 && this.page + dir <= 604; }

  /** The neighbour page in direction dir is rendered and ready to slide in. */
  ready(dir) { return !!$(`pslot-${dir > 0 ? "next" : "prev"}`).dataset.page; }

  // ── the carousel ─────────────────────────────────────
  /**
   * Swipe the page as in a photo carousel. The page follows the finger 1:1
   * with its neighbour coming in from the side (drag right for the next page,
   * left for the previous, as in a printed mushaf). On release it moves on
   * past ~half the width or on a quick flick, and settles back otherwise.
   * Vertical drags scroll the page as usual; the pen turns swiping off.
   */
  carousel() {
    const stage = $("stage"), track = $("ptrack");
    let g = null;
    const offset = (dx) => {
      const dir = dx > 0 ? 1 : -1;
      if (this.canStep(dir) && this.ready(dir)) return dx;
      return (dx / (1 + Math.abs(dx) / 120)) * 0.5; // the first and last page resist, then come back
    };
    stage.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || this.penOn || this.settling || e.target.closest("button, input, select, a, .state")) return;
      if (e.pointerType === "mouse") e.preventDefault(); // no text selection while dragging
      g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, axis: null, pts: [[e.timeStamp, e.clientX]] };
    });
    stage.addEventListener("pointermove", (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      if (!g.axis) {
        if (Math.hypot(dx, dy) < 8) return;
        g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (g.axis === "y") { g = null; return; }
        try { stage.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
        track.classList.remove("is-settling");
      }
      g.dx = dx;
      g.pts.push([e.timeStamp, e.clientX]);
      while (g.pts.length > 2 && e.timeStamp - g.pts[0][0] > 100) g.pts.shift();
      track.style.transform = `translateX(${offset(dx)}px)`;
    });
    const release = (e) => {
      if (!g || e.pointerId !== g.id) return;
      const { dx, axis, pts } = g;
      g = null;
      if (axis !== "x") return;
      this.suppressClick = true; // the click that follows a drag is not a tap
      setTimeout(() => { this.suppressClick = false; }, 0);
      const [t0, x0] = pts[0], [t1, x1] = pts.at(-1);
      const v = t1 > t0 ? (x1 - x0) / (t1 - t0) : 0;
      const dir = dx > 0 ? 1 : -1;
      const W = track.offsetWidth;
      const go = e.type === "pointerup" && this.canStep(dir) && this.ready(dir) &&
        (Math.abs(dx) > W * COMMIT_FRACTION || (Math.abs(v) > FLICK_SPEED && Math.sign(v) === dir && Math.abs(dx) > 16));
      if (go) this.slide(dir, offset(dx), Math.abs(v));
      else this.settle(0, offset(dx));
    };
    stage.addEventListener("pointerup", release);
    stage.addEventListener("pointercancel", release);
  }

  /** Move the track from `from` px to `to` px with a decelerating ease; resolves when it stops. */
  settle(to, from, speed = 0) {
    const track = $("ptrack");
    const dist = Math.abs(to - from);
    if (reduced() || dist < 1) {
      track.classList.remove("is-settling");
      track.style.transform = to ? `translateX(${to}px)` : "";
      return Promise.resolve();
    }
    // a fast flick finishes sooner; a slow release still takes a short, calm glide
    const ms = Math.round(Math.min(380, Math.max(180, dist / Math.max(speed, dist / 340))));
    track.style.setProperty("--settle", `${ms}ms`);
    track.style.setProperty("--ease", EASE);
    track.classList.add("is-settling");
    track.style.transform = `translateX(${to}px)`;
    return new Promise((done) => {
      const end = () => { clearTimeout(t); track.removeEventListener("transitionend", end); done(); };
      const t = setTimeout(end, ms + 60);
      track.addEventListener("transitionend", end);
    });
  }

  /** Slide to the neighbour page (dir 1 = next), load it, then put the track back under it. */
  async slide(dir, from = 0, speed = 0) {
    const track = $("ptrack");
    const P = this.page + dir;
    this.settling = true;
    try {
      if (this.ready(dir)) await this.settle(dir * track.offsetWidth, from, speed);
      await this.goPage(P);
    } finally {
      track.classList.remove("is-settling");
      track.style.transform = "";
      this.settling = false;
      this.preload?.(this.page);
    }
  }

  // ── the bars: hidden while reading, a tap on the page shows them ──
  bars() {
    $("stage").addEventListener("click", (e) => {
      if (this.suppressClick) { this.suppressClick = false; e.stopPropagation(); return; }
      if (this.penOn || e.target.closest("button, a, input, select")) return;
      if (this.barsHidden) { this.showBars(true); e.stopPropagation(); return; } // the first tap only brings the bars back
      if (!e.target.closest(".w, .ayah-end")) this.showBars(false);
    }, true);
    // keyboard: Tab brings the bars back so their buttons can be reached
    document.addEventListener("keydown", (e) => {
      if (e.key === "Tab" && this.barsHidden && document.body.classList.contains("in-hifz")) this.showBars(true);
    });
    for (const id of ["vtop", "dock"]) $(id).addEventListener("focusin", () => this.showBars(true));
  }

  get barsHidden() { return document.body.classList.contains("bars-hidden"); }

  /** Show or hide the bars; they stay while the pen, the menu, the sheet (on a phone) or a dialog is open. */
  showBars(show) {
    if (!show) {
      const busy = this.penOn || !$("v-menu").hidden || document.querySelector("dialog[open]") ||
        (!wide() && this.sheetState !== "closed");
      if (busy) return;
    }
    document.body.classList.toggle("bars-hidden", !show);
    $("bars-hint").hidden = true;
  }

  /** Entering the reading page: the page alone, and once ever a hint on how to bring the bars back. */
  enter() {
    this.showBars(false);
    if (!this.barsHidden) return;
    let seen = true;
    try { seen = !!localStorage.getItem(HINT_KEY); localStorage.setItem(HINT_KEY, "1"); } catch { /* storage unavailable */ }
    if (seen) return;
    const hint = $("bars-hint");
    hint.hidden = false;
    setTimeout(() => { hint.hidden = true; }, 4000);
  }

  // ── title, page buttons ──────────────────────────────
  /** Called after every selection / current-ayah change. */
  update({ surahName, page, juz, ayah }) {
    $("v-title").textContent = `سورة ${surahName}`;
    $("v-sub").textContent = [juz ? juzName(juz) : null, page ? `الصفحة ${ar(page)}` : null, ayah ? `الآية ${ar(ayah)}` : null].filter(Boolean).join("، ");
    if (!page) return;
    if (page !== this.page && !this.settling) this.preload?.(page);
    this.page = page;
  }

  // ── page grid (the back button) ──────────────────────
  async openGrid() {
    this.index ||= await mushafIndex();
    $("pagegrid").hidden = false;
    document.body.classList.add("grid-open");
    this.renderGrid();
    $("grid-close").focus();
  }

  closeGrid(focus = true) {
    $("pagegrid").hidden = true;
    document.body.classList.remove("grid-open");
    if (focus) $("v-grid").focus();
  }

  renderGrid() {
    const by = this.settings.navBy === "surah" ? "surah" : "juz";
    $("grid-by").querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.v === by)));
    const body = $("grid-body");
    const names = new Map(this.surahs.map((s) => [s.id, s.name]));
    const go = (p) => () => { this.closeGrid(false); this.goPage(p); };
    if (by === "juz") {
      body.replaceChildren(...this.index.juz.map((start, j) => {
        const end = j < 29 ? this.index.juz[j + 1] - 1 : 604;
        const tiles = [];
        for (let p = start; p <= end; p++) {
          // a page is named by its first three words, as huffaz name it; the surah and number go small below
          const s = this.index.pages[p - 1][0][0];
          const name = this.index.names?.[p - 1] || ar(p);
          tiles.push(el("button", { type: "button", class: "gtile" + (p === this.page ? " is-current" : ""), onclick: go(p), "aria-label": `${name}، الصفحة ${ar(p)}، سورة ${names.get(s)}` },
            el("span", { class: "thumb__lines", "aria-hidden": "true" }), el("b", {}, name), el("small", {}, `${names.get(s)} · ${ar(p)}`)));
        }
        const here = this.page >= start && this.page <= end;
        return el("details", { class: "gjuz", open: here || null },
          el("summary", {}, el("span", { class: "gjuz__n" }, ar(j + 1)), juzName(j + 1),
            el("span", { class: "muted" }, ` الصفحات ${ar(start)}–${ar(end)}`)),
          el("div", { class: "gtiles" }, tiles));
      }));
      body.querySelector(".gjuz[open]")?.scrollIntoView({ block: "start" });
    } else {
      body.replaceChildren(el("ol", { class: "gsurahs" }, this.surahs.map((s) =>
        el("li", {}, el("button", { type: "button", onclick: () => { this.closeGrid(false); this.openSurah(s.id); } },
          el("span", { class: "gjuz__n" }, ar(s.id)),
          el("span", {}, el("b", {}, `سورة ${s.name}`), el("small", { class: "muted" }, `${s.place}، ${ar(s.ayahs)} آية`)),
          el("span", { class: "muted" }, `ص ${ar(s.pages[0])}`))))));
    }
  }

  // ── bottom sheet ─────────────────────────────────────
  openSheet() { this.setSheet(this.sheetState === "closed" ? "half" : this.sheetState); }

  setSheet(state) {
    const sheet = $("sheet");
    if (!this.hasPanels()) state = "closed";
    this.sheetState = state;
    sheet.dataset.state = state;
    sheet.style.removeProperty("--drag");
    sheet.inert = state === "closed";
    $("fab-tj").setAttribute("aria-expanded", String(state !== "closed"));
    document.body.classList.toggle("panel-open", state !== "closed");
    if (wide()) this.save({ panelOpen: state !== "closed" });
  }

  /** Drag the sheet by its head: snap to closed, half or full. */
  dragSheet() {
    const sheet = $("sheet"), head = $("sheet-head");
    let y0 = null, h0 = 0, moved = false;
    head.addEventListener("pointerdown", (e) => {
      if (wide() || e.target.closest("button")) return;
      y0 = e.clientY; h0 = sheet.getBoundingClientRect().height; moved = false;
      head.setPointerCapture(e.pointerId);
      sheet.classList.add("is-dragging");
    });
    head.addEventListener("pointermove", (e) => {
      if (y0 == null) return;
      const h = Math.max(0, Math.min(innerHeight * 0.94, h0 + (y0 - e.clientY)));
      if (Math.abs(e.clientY - y0) > 4) moved = true;
      sheet.style.setProperty("--drag", `${h}px`);
    });
    const end = (e) => {
      if (y0 == null) return;
      const h = h0 + (y0 - e.clientY);
      y0 = null;
      sheet.classList.remove("is-dragging");
      if (!moved) return this.setSheet(this.sheetState === "half" ? "full" : "half");
      const vh = innerHeight;
      this.setSheet(h < vh * 0.25 ? "closed" : h < vh * 0.72 ? "half" : "full");
    };
    head.addEventListener("pointerup", end);
    head.addEventListener("pointercancel", end);
  }

  hasPanels() { const s = this.settings; return s.showTajweed || s.showTafsir || s.showMut; }

  firstPanel() { const s = this.settings; return s.showTajweed ? "tajweed" : s.showTafsir ? "tafsir" : "mut"; }

  // ── pen ──────────────────────────────────────────────
  setPen(on) {
    this.penOn = on;
    if (on) this.showBars(true);
    $("v-pen").setAttribute("aria-pressed", String(on));
    $("pen-bar").hidden = !on;
    document.body.classList.toggle("pen-on", on);
    this.paintMarks();
  }

  /** In pen mode a word tap marks or unmarks it. Returns true when handled. */
  tapWord(s, n, p) {
    if (!this.penOn) return false;
    const k = `${s}:${n}:${p}`;
    if (this.marks.has(k)) this.marks.delete(k); else this.marks.add(k);
    pen.save(this.marks);
    this.paintMarks();
    return true;
  }

  /** Underline the marked words of the page (or of a neighbour page's `words`). */
  paintMarks(words = null) {
    let n = 0;
    for (const [k, w] of words || this.words()) {
      const on = this.marks.has(k);
      w.classList.toggle("is-marked", on);
      if (on) n++;
    }
    if (words) return;
    $("pen-count").textContent = n ? `(${ar(n)})` : "";
    $("pen-clear").disabled = !n;
  }

  // ── settings: five switches ──────────────────────────
  initSettings() {
    const dlg = $("settings-dlg");
    dlg.querySelectorAll("input[data-set]").forEach((inp) => {
      inp.addEventListener("change", () => {
        this.save({ [inp.dataset.set]: inp.checked });
        this.applySettings();
        this.onSettings(inp.dataset.set);
      });
    });
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    this.applySettings();
  }

  openSettings() {
    const dlg = $("settings-dlg");
    dlg.querySelectorAll("input[data-set]").forEach((inp) => { inp.checked = !!this.settings[inp.dataset.set]; });
    dlg.showModal();
  }

  setDetailed(on) {
    this.save({ detailed: on });
    this.applySettings();
    this.onSettings("detailed");
  }

  applySettings() {
    const s = this.settings;
    const b = document.body.classList;
    b.toggle("no-tajweed", !s.showTajweed);
    b.toggle("no-tafsir", !s.showTafsir);
    b.toggle("no-mut", !s.showMut);
    b.toggle("no-reciter", !s.withReciter);
    b.toggle("is-detailed", !!s.detailed);
    $("detail").hidden = !s.detailed;
    $("v-opts").setAttribute("aria-pressed", String(!!s.detailed));
    $("tab-tajweed").hidden = !s.showTajweed;
    $("tab-tafsir").hidden = !s.showTafsir;
    $("tab-mut").hidden = !s.showMut;
    $("fab-tj").hidden = !this.hasPanels();
    const name = { tajweed: "التجويد", tafsir: "التفسير", mut: "المتشابهات" }[this.firstPanel()];
    $("fab-label").textContent = name;
    $("fab-tj").setAttribute("aria-label", `افتح لوحة ${name}`);
    $("fab-tj").title = `لوحة ${name}`;
    document.querySelector(".player").hidden = !s.withReciter;
    if (!this.hasPanels()) this.setSheet("closed");
  }

  showTheme() { $("v-theme-name").textContent = $("theme-name").textContent; }
}
