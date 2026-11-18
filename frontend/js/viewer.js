/**
 * The reading page as a gallery-style viewer: a top bar (back to the page
 * grid, title, tools), the page, previous / next page buttons and the player
 * at the bottom, a floating tajweed button, and a bottom sheet holding the
 * tajweed / tafsir / similar-verses panels. Pen marks and the five switches
 * live in localStorage. main.js keeps the selection, the player and the panels.
 */
import { juzName, mushafIndex } from "./mushaf-meta.js";
import { ar, el } from "./util.js";

const MARKS_KEY = "hifz.marks.v1";
const $ = (id) => document.getElementById(id);
const wide = () => matchMedia("(min-width: 1200px)").matches;

export const pen = {
  load() { try { return new Set(JSON.parse(localStorage.getItem(MARKS_KEY) || "[]")); } catch { return new Set(); } },
  save(set) { try { localStorage.setItem(MARKS_KEY, JSON.stringify([...set])); } catch { /* storage unavailable */ } },
};

export class Viewer {
  /**
   * opts: settings, save, surahs, goPage(P), openSurah(id), mushaf (element),
   * words() → Map "s:n:p" → element, onSettings(changed), sheetTab(v)
   */
  constructor(opts) {
    Object.assign(this, opts);
    this.marks = pen.load();
    this.penOn = false;
    this.sheetState = "closed";
    this.index = null;
    this.page = null;

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
    $("fab-tj").addEventListener("click", () => { this.sheetTab("tajweed"); this.openSheet(); });
    $("peek").addEventListener("click", () => this.openSheet());
    $("sheet-close").addEventListener("click", () => this.setSheet("closed"));
    this.dragSheet();
    matchMedia("(min-width: 1200px)").addEventListener("change", () => this.setSheet(this.sheetState));

    // previous / next page, and swiping the page (finger or mouse) as in a printed
    // mushaf: drag towards the right for the next page, towards the left for the previous
    $("pg-prev").addEventListener("click", () => this.step(-1));
    $("pg-next").addEventListener("click", () => this.step(1));
    let sx = null, sy = 0;
    const stage = $("stage"), wrap = $("mushaf-wrap");
    stage.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || this.penOn || e.target.closest("button, input, select, a")) return;
      if (e.pointerType === "mouse") e.preventDefault(); // no text selection while dragging
      sx = e.clientX; sy = e.clientY;
    });
    stage.addEventListener("pointermove", (e) => {
      if (sx == null) return;
      const dx = e.clientX - sx;
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(e.clientY - sy)) wrap.style.transform = `translateX(${dx * 0.25}px)`;
    });
    const release = (e) => {
      if (sx == null) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      sx = null;
      wrap.style.removeProperty("transform");
      if (e.type === "pointerup" && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) this.step(dx > 0 ? 1 : -1);
    };
    stage.addEventListener("pointerup", release);
    stage.addEventListener("pointercancel", release);
    stage.addEventListener("pointerleave", release);

    // the page leaves room for the dock (sheet handle, page buttons, player) whatever its height
    const dock = $("dock");
    new ResizeObserver(() => $("view-hifz").style.setProperty("--dock-h", `${dock.offsetHeight}px`)).observe(dock);

    this.initSettings();
    this.setSheet(wide() && this.settings.panelOpen !== false ? "half" : "closed");
  }

  step(dir) {
    if (this.page) this.goPage(Math.min(604, Math.max(1, this.page + dir)));
  }

  // ── title, page buttons ──────────────────────────────
  /** Called after every selection / current-ayah change. */
  update({ surahName, page, juz, ayah }) {
    $("v-title").textContent = `سورة ${surahName}`;
    $("v-sub").textContent = [juz ? juzName(juz) : null, page ? `الصفحة ${ar(page)}` : null, ayah ? `الآية ${ar(ayah)}` : null].filter(Boolean).join("، ");
    if (!page) return;
    this.page = page;
    $("pg-label").textContent = `${ar(page)} / ${ar(604)}`;
    $("pg-prev").disabled = page <= 1;
    $("pg-next").disabled = page >= 604;
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
          const s = this.index.pages[p - 1][0][0];
          tiles.push(el("button", { type: "button", class: "gtile" + (p === this.page ? " is-current" : ""), onclick: go(p), "aria-label": `الصفحة ${ar(p)}، سورة ${names.get(s)}` },
            el("span", { class: "thumb__lines", "aria-hidden": "true" }), el("b", {}, ar(p)), el("small", {}, names.get(s))));
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
    $("peek").setAttribute("aria-expanded", String(state !== "closed"));
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

  // ── pen ──────────────────────────────────────────────
  setPen(on) {
    this.penOn = on;
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

  paintMarks() {
    let n = 0;
    for (const [k, w] of this.words()) {
      const on = this.marks.has(k);
      w.classList.toggle("is-marked", on);
      if (on) n++;
    }
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
    $("fab-tj").hidden = !s.showTajweed;
    $("peek").hidden = !this.hasPanels();
    $("peek-label").textContent = [s.showTajweed && "التجويد", s.showTafsir && "التفسير", s.showMut && "المتشابهات"].filter(Boolean).join(" · ");
    document.querySelector(".player").hidden = !s.withReciter;
    if (!this.hasPanels()) this.setSheet("closed");
  }

  showTheme() { $("v-theme-name").textContent = $("theme-name").textContent; }
}
