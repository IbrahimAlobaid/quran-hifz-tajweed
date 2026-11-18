import { api } from "./api.js";
import { LearnView } from "./learn.js";
import { Player } from "./player.js";
import { settings, save } from "./store.js";
import { TafsirPanel } from "./tafsir.js";
import { TajweedPanel } from "./tajweed.js";
import { ar, el } from "./util.js";
import { MushafView } from "./view.js";

const PAGES = 604;
const $ = (id) => document.getElementById(id);
const ui = {
  surah: $("surah"), from: $("from"), to: $("to"), reciter: $("reciter"), page: $("page"),
  unit: $("unit"), rangeCtl: $("range-ctl"), pageCtl: $("page-ctl"), pageNav: $("page-nav"), pageNavLabel: $("page-nav-label"),
  ayahRepeat: $("ayah-repeat"), rangeRepeat: $("range-repeat"), gap: $("gap"), rate: $("rate"),
  mushaf: $("mushaf"), state: $("state"), play: $("play"), prev: $("prev"), next: $("next"),
  stAyah: $("st-ayah"), stDetail: $("st-detail"), stCache: $("st-cache"),
  progress: $("progress"), fill: $("progress-fill"), gapBox: $("gap-indicator"), gapRing: $("gap-ring"),
  tj: $("tj-toggle"), dim: $("dim-toggle"), hideMode: $("hide-mode"), palette: $("palette"),
};

const audio = $("audio");
const wbwAudio = $("wbw-audio");
const player = new Player(audio);
const view = new MushafView({ root: ui.mushaf, head: $("surah-head"), wrap: $("mushaf-wrap") });

// The selection is one or more segments {s, from, to}: one for "ayahs", up to
// three for a mushaf page that holds the end of a surah and the next ones.
// The player works on one segment at a time (`act`) and moves on at its end.
let surahs = [], segs = [], act = 0, pagePass = 1;
let panel = null, tafsir = null, learn = null, loadToken = 0, actToken = 0;
const isPage = () => settings.unit === "page";
const cur = () => segs[act];

// ── helpers ────────────────────────────────────────────
function fillRepeatSelect(sel, max, label) {
  sel.replaceChildren(
    ...Array.from({ length: max }, (_, i) => el("option", { value: i + 1 }, i === 0 ? "مرة واحدة" : `${ar(i + 1)} ${label}`)),
    el("option", { value: 0 }, "بلا توقف"),
  );
}

function bindSegmented(group, value, onChange, attr = "aria-checked") {
  const set = (v) => group.querySelectorAll("button").forEach((b) => b.setAttribute(attr, String(b.dataset.v === v)));
  set(value);
  group.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    set(b.dataset.v);
    onChange(b.dataset.v);
  });
}

function showState(msg, { error = false, retry = null } = {}) {
  ui.state.hidden = !msg;
  ui.state.classList.toggle("is-error", error);
  ui.state.replaceChildren(msg || "", retry ? el("div", {}, el("button", { class: "btn", type: "button", onclick: retry }, "إعادة المحاولة")) : "");
}

function clampRange(s) {
  const max = s.ayahs;
  let from = Math.min(Math.max(parseInt(ui.from.value, 10) || 1, 1), max);
  let to = Math.min(Math.max(parseInt(ui.to.value, 10) || from, 1), max);
  if (to < from) [from, to] = [to, from];
  ui.from.value = from; ui.to.value = to;
  ui.from.max = ui.to.max = max;
  return { from, to };
}

const clampPage = (p) => Math.min(Math.max(parseInt(p, 10) || 1, 1), PAGES);

function updateStatus() {
  const seg = cur();
  const { ayahRepeat, rangeRepeat } = player.opts;
  const multi = segs.length > 1;
  ui.stAyah.textContent = seg ? `سورة ${seg.s.name}، الآية ${ar(player.cur)}` : "—";
  const parts = [`التكرار ${ar(player.ayahPass)} من ${ayahRepeat ? ar(ayahRepeat) : "∞"}`];
  const rr = multi ? settings.rangeRepeat : rangeRepeat;
  if (rr !== 1) parts.push(`الدورة ${ar(multi ? pagePass : player.rangePass)} من ${rr ? ar(rr) : "∞"}`);
  parts.push(isPage() ? `الصفحة ${ar(settings.page)}` : `المقطع ${ar(player.range.from)}–${ar(player.range.to)}`);
  ui.stDetail.textContent = parts.join("  |  ");
  document.body.classList.toggle("is-playing", player.playing || player.inGap);
  ui.mushaf.classList.toggle("is-playing", player.playing || player.inGap);
  ui.play.setAttribute("aria-label", player.playing ? "إيقاف مؤقت" : "تشغيل");
}

async function refreshCacheState() {
  const seg = cur();
  if (!seg) return;
  try {
    const s = await api.cacheState(settings.rid, seg.s.id);
    ui.stCache.textContent = { cached: "الصوت محفوظ على الجهاز", downloading: "جارٍ حفظ الصوت للاستماع دون اتصال…", remote: "يُبث الصوت من الإنترنت" }[s] || "";
    if (s === "downloading") setTimeout(refreshCacheState, 4000);
  } catch { /* status is informational only */ }
}

function syncUnitControls() {
  const page = isPage();
  ui.rangeCtl.hidden = page;
  ui.pageCtl.hidden = !page;
  ui.pageNav.hidden = !page;
}

// ── loading ────────────────────────────────────────────
/** @param at {s, n} — ayah to keep current if it is in the new selection */
async function loadSelection({ at = null } = {}) {
  const token = ++loadToken;
  ui.play.disabled = true;
  showState("جارٍ تحميل الآيات والتوقيتات…");
  syncUnitControls();
  try {
    let next;
    if (isPage()) {
      const P = clampPage(settings.page);
      ui.page.value = P;
      const metas = surahs.filter((m) => m.pages && m.pages[0] <= P && P <= m.pages[1]);
      const list = await Promise.all(metas.map((m) => api.surah(m.id)));
      next = list.map((s) => {
        const vs = s.verses.filter((v) => v.page === P);
        return vs.length ? { s, from: vs[0].n, to: vs.at(-1).n } : null;
      }).filter(Boolean);
      save({ page: P });
      ui.pageNavLabel.textContent = `الصفحة ${ar(P)} من ${ar(PAGES)}`;
    } else {
      const s = await api.surah(settings.surah);
      const { from, to } = clampRange(s);
      save({ from, to });
      next = [{ s, from, to }];
    }
    if (token !== loadToken) return;
    segs = next;
    pagePass = 1;
    view.render(segs, { layout: isPage() ? "page" : "flow", page: settings.page });
    view.setMode(settings.hideMode);
    panel.renderLegend(countRules(segs));
    if (panel.focused) view.focusRule(panel.focused);
    tafsir.setSelection(segs);
    const i = at ? Math.max(0, segIndex(at.s)) : 0;
    await activate(i, { ayah: at?.n, token });
    if (token !== loadToken) return;
    showState("");
  } catch (e) {
    if (token !== loadToken) return;
    showState(e.message || "تعذّر التحميل.", { error: true, retry: () => loadSelection() });
  }
}

/**
 * Make segment `i` the one the player works on.
 * opts: ayah (start ayah), word (play from that word), play (start playing).
 */
async function activate(i, { ayah = null, word = null, play = false, token = null } = {}) {
  const mine = ++actToken;
  const seg = segs[i];
  ui.play.disabled = true;
  let t;
  try { t = await api.timings(settings.rid, seg.s.id); }
  catch (e) {
    if (token != null) throw e; // loadSelection shows it with a retry button
    ui.play.disabled = false;
    ui.stDetail.textContent = e.message || "تعذّر تحميل توقيتات القارئ.";
    return;
  }
  if (mine !== actToken || (token != null && token !== loadToken)) return;
  act = i;
  player.load(t, t.audio);
  player.setOptions({ rangeRepeat: segs.length > 1 ? 1 : settings.rangeRepeat });
  player.setRange(seg.from, seg.to);
  player.cur = ayah != null && ayah >= seg.from && ayah <= seg.to ? ayah : seg.from;
  if (isPage()) { ui.surah.value = seg.s.id; save({ surah: seg.s.id }); }
  onAyahChanged();
  panel.showWord(null);
  ui.play.disabled = false;
  updateStatus();
  refreshCacheState();
  if (word != null || play) player.jump(player.cur, word);
}

function onAyahChanged() {
  const s = cur().s.id;
  view.setAyah(s, player.cur);
  panel.showAyah(view.ayahData(s, player.cur), (n, p) => pickWord(s, n, p));
  tafsir.setCurrent(s, player.cur);
}

function countRules(list) {
  const c = new Map();
  for (const { s, from, to } of list) {
    for (const a of s.verses) {
      if (a.n < from || a.n > to) continue;
      for (const w of a.words) for (const r of w.rules) c.set(r.r, (c.get(r.r) || 0) + 1);
    }
  }
  return c;
}

const segIndex = (s) => segs.findIndex((x) => x.s.id === s);

/** Select a word (and its ayah, when idle) without starting playback. */
async function pickWord(s, n, p) {
  if (s !== cur().s.id) await activate(segIndex(s), { ayah: n });
  view.select(s, n, p);
  const w = view.wordData(s, n, p);
  panel.showWord(w, n, {
    onListen: () => { wbwAudio.src = api.wbwUrl(w.wbw); wbwAudio.play().catch(() => {}); },
    onPlayFrom: () => playFrom(s, n, p),
  });
  if (n !== player.cur && !player.playing) selectAyah(n);
}

function selectAyah(n) {
  player.cur = n;
  onAyahChanged();
  updateStatus();
}

function playFrom(s, n, p = null) {
  if (s !== cur().s.id) return activate(segIndex(s), { ayah: n, word: p, play: true });
  player.jump(n, p);
}

/** From the tafsir panel: show that ayah (play from it if already playing). */
async function goToAyah(s, n) {
  if (player.playing) return playFrom(s, n);
  if (s !== cur().s.id) await activate(segIndex(s), { ayah: n });
  else selectAyah(n);
  const first = view.words.get(`${s}:${n}:1`);
  first?.scrollIntoView({ block: "center", behavior: "smooth" });
}

function goPage(P) {
  P = clampPage(P);
  if (P === settings.page && segs.length) return;
  save({ page: P });
  player.stop();
  loadSelection();
}

// ── wiring ─────────────────────────────────────────────
player.addEventListener("time", ({ detail }) => {
  view.setWord(cur().s.id, detail.ayah, detail.word);
  ui.fill.style.width = `${(detail.frac * 100).toFixed(2)}%`;
  ui.progress.setAttribute("aria-valuenow", Math.round(detail.frac * 100));
});
player.addEventListener("ayah", () => { onAyahChanged(); updateStatus(); });
player.addEventListener("pass", () => {
  if (settings.hideMode !== "show") view.resetReveal(cur().s.id, player.cur);
  view.clearWord();
  updateStatus();
});
player.addEventListener("state", updateStatus);
player.addEventListener("done", async () => {
  view.clearWord();
  ui.fill.style.width = "0";
  if (segs.length > 1) {
    // A page across surahs: continue with the next surah, then loop the page.
    if (act < segs.length - 1) return activate(act + 1, { play: true });
    const rr = settings.rangeRepeat;
    if (rr === 0 || pagePass < rr) { pagePass++; return activate(0, { play: true }); }
    pagePass = 1;
    await activate(0);
  }
  ui.stDetail.textContent = isPage() ? "اكتملت الصفحة. اضغط تشغيل للبدء من جديد." : "اكتمل المقطع. اضغط تشغيل للبدء من جديد.";
});
player.addEventListener("error", ({ detail }) => { ui.stDetail.textContent = detail.message; });
player.addEventListener("buffering", ({ detail }) => { ui.play.classList.toggle("is-loading", detail.on); });
player.addEventListener("gap", ({ detail }) => {
  ui.gapBox.hidden = !detail.ms;
  if (!detail.ms) return;
  const ring = ui.gapRing;
  ring.style.transition = "none";
  ring.style.strokeDashoffset = "0";
  ring.getBoundingClientRect();
  ring.style.transition = `stroke-dashoffset ${detail.ms}ms linear`;
  ring.style.strokeDashoffset = "94.25";
});

view.addEventListener("word", ({ detail }) => pickWord(detail.s, detail.n, detail.p));
view.addEventListener("playword", ({ detail }) => playFrom(detail.s, detail.n, detail.p));
view.addEventListener("ayahclick", ({ detail }) => playFrom(detail.s, detail.n));

ui.play.addEventListener("click", () => player.toggle());
function step(dir) {
  if (dir > 0 && player.cur >= player.range.to && act < segs.length - 1) return activate(act + 1, { play: true });
  if (dir < 0 && player.cur <= player.range.from && act > 0) return activate(act - 1, { ayah: segs[act - 1].to, play: true });
  dir > 0 ? player.next() : player.prev();
}
ui.next.addEventListener("click", () => step(1));
ui.prev.addEventListener("click", () => step(-1));

function seekFromPointer(e) {
  const r = ui.progress.getBoundingClientRect();
  const f = (r.right - e.clientX) / r.width; // RTL: progress grows from the right
  player.seekFraction(f);
}
ui.progress.addEventListener("pointerdown", (e) => { seekFromPointer(e); ui.progress.setPointerCapture(e.pointerId); });
ui.progress.addEventListener("pointermove", (e) => { if (e.buttons) seekFromPointer(e); });

ui.surah.addEventListener("change", () => {
  const n = +ui.surah.value;
  const meta = surahs.find((s) => s.id === n);
  save({ surah: n });
  player.stop();
  if (isPage()) { save({ page: meta.pages[0] }); return loadSelection(); }
  ui.from.value = 1;
  ui.to.value = Math.min(meta.ayahs, 7);
  loadSelection();
});
for (const inp of [ui.from, ui.to]) inp.addEventListener("change", () => { player.stop(); loadSelection(); });
ui.page.addEventListener("change", () => goPage(ui.page.value));
$("page-prev").addEventListener("click", () => goPage(settings.page - 1));
$("page-next").addEventListener("click", () => goPage(settings.page + 1));
ui.pageNav.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-step]");
  if (!b) return;
  goPage(settings.page + +b.dataset.step);
  $("mushaf-wrap").scrollIntoView({ block: "start", behavior: "smooth" });
});

const here = () => (cur() ? { s: cur().s.id, n: player.cur } : null); // read before player.stop() resets it
ui.reciter.addEventListener("change", () => { const at = here(); save({ rid: +ui.reciter.value }); player.stop(); loadSelection({ at }); });
ui.ayahRepeat.addEventListener("change", () => { save({ ayahRepeat: +ui.ayahRepeat.value }); player.setOptions({ ayahRepeat: settings.ayahRepeat }); updateStatus(); });
ui.rangeRepeat.addEventListener("change", () => {
  save({ rangeRepeat: +ui.rangeRepeat.value });
  player.setOptions({ rangeRepeat: segs.length > 1 ? 1 : settings.rangeRepeat });
  updateStatus();
});
ui.gap.addEventListener("change", () => { save({ gap: ui.gap.value }); player.setOptions({ gap: settings.gap }); });
ui.rate.addEventListener("change", () => { save({ rate: +ui.rate.value }); player.setOptions({ rate: settings.rate }); });

ui.tj.addEventListener("change", () => { save({ tajweed: ui.tj.checked }); ui.mushaf.classList.toggle("tj-on", ui.tj.checked); });
ui.dim.addEventListener("change", () => { save({ dim: ui.dim.checked }); ui.mushaf.classList.toggle("dim-others", ui.dim.checked); });

function setFont(px) {
  px = Math.min(Math.max(px, 20), 64);
  document.documentElement.style.setProperty("--q-size", `${px}px`);
  save({ qSize: px });
  if (isPage()) view._fitPage();
}
const curFont = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--q-size")) || 34;
$("font-inc").addEventListener("click", () => setFont(curFont() + 3));
$("font-dec").addEventListener("click", () => setFont(curFont() - 3));

$("theme-btn").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = dark ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  save({ theme });
  panel.applyColors();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => panel?.applyColors());

document.addEventListener("keydown", (e) => {
  if (document.body.classList.contains("in-learn")) return;
  if (e.target.closest("input, select, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === "Space" && !e.target.closest(".w, button")) { e.preventDefault(); player.toggle(); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); step(1); }   // RTL: left = forward
  else if (e.key === "ArrowRight") { e.preventDefault(); step(-1); }
  else if (e.key === "PageDown" && isPage()) { e.preventDefault(); goPage(settings.page + 1); }
  else if (e.key === "PageUp" && isPage()) { e.preventDefault(); goPage(settings.page - 1); }
  else if (e.key.toLowerCase() === "t") { ui.tj.click(); }
  else if (e.key.toLowerCase() === "r") {
    const v = settings.ayahRepeat === 0 ? 1 : 0;
    ui.ayahRepeat.value = v; ui.ayahRepeat.dispatchEvent(new Event("change"));
  }
});

/** Switch between a chosen ayah range and a full mushaf page, keeping the place. */
function setUnit(v) {
  if (v === settings.unit) return;
  const seg = cur();
  const at = here();
  const a = seg && view.ayahData(seg.s.id, player.cur);
  if (v === "page" && a) save({ page: a.page });
  if (v === "ayahs" && seg) {
    save({ surah: seg.s.id });
    ui.surah.value = seg.s.id;
    ui.from.value = seg.from;
    ui.to.value = seg.to;
  }
  save({ unit: v });
  player.stop();
  loadSelection({ at });
}

function setSideTab(v) {
  save({ sideTab: v });
  $("side-tajweed").hidden = v !== "tajweed";
  $("tafsir-panel").hidden = v !== "tafsir";
  document.querySelector(".layout").classList.toggle("is-tafsir", v === "tafsir");
  tafsir.setActive(v === "tafsir");
}

// ── routing: #/ (memorize) · #/learn/... (learn tajweed) ─────────────
function route() {
  const parts = (location.hash || "#/").replace(/^#\/?/, "").split("/").filter(Boolean);
  const isLearn = parts[0] === "learn";
  $("view-hifz").hidden = isLearn;
  $("view-learn").hidden = !isLearn;
  document.body.classList.toggle("in-learn", isLearn);
  document.querySelectorAll(".mainnav a").forEach((a) =>
    a.setAttribute("aria-current", String(a.dataset.view === (isLearn ? "learn" : "hifz") ? "page" : "false")));
  if (isLearn) {
    player.pause();
    learn?.show(parts.slice(1));
  } else learn?.hide();
}

// ── boot ───────────────────────────────────────────────
async function boot() {
  fillRepeatSelect(ui.ayahRepeat, 10, "مرات");
  fillRepeatSelect(ui.rangeRepeat, 10, "مرات");
  ui.ayahRepeat.value = settings.ayahRepeat;
  ui.rangeRepeat.value = settings.rangeRepeat;
  ui.gap.value = settings.gap;
  ui.rate.value = settings.rate;
  ui.tj.checked = settings.tajweed;
  ui.dim.checked = settings.dim;
  ui.mushaf.classList.toggle("tj-on", settings.tajweed);
  ui.mushaf.classList.toggle("dim-others", settings.dim);
  if (settings.qSize) document.documentElement.style.setProperty("--q-size", `${settings.qSize}px`);
  player.setOptions({ ayahRepeat: settings.ayahRepeat, rangeRepeat: settings.rangeRepeat, gap: settings.gap, rate: settings.rate });
  syncUnitControls();

  showState("جارٍ التحميل…");
  try {
    const [list, reciters, catalog] = await Promise.all([api.surahs(), api.reciters(), api.rules()]);
    surahs = list;
    ui.surah.replaceChildren(...list.map((s) => el("option", { value: s.id }, `${ar(s.id)}. ${s.name}`)));
    ui.reciter.replaceChildren(...reciters.map((r) => el("option", { value: r.id }, r.label)));
    if (!reciters.some((r) => r.id === settings.rid)) save({ rid: reciters[0].id });
    ui.surah.value = settings.surah;
    ui.reciter.value = settings.rid;
    ui.from.value = settings.from;
    ui.to.value = settings.to;
    ui.page.value = settings.page;

    panel = new TajweedPanel({
      catalog, legend: $("legend"), wordBox: $("word-audit"), ayahBox: $("ayah-audit"), ayahBadge: $("ayah-badge"),
    });
    panel.applyColors(settings.palette);
    panel.addEventListener("focus", ({ detail }) => view.focusRule(detail.rule));
    bindSegmented(ui.palette, settings.palette, (v) => { save({ palette: v }); panel.applyColors(v); });
    bindSegmented(ui.hideMode, settings.hideMode, (v) => { save({ hideMode: v }); view.setMode(v); });
    bindSegmented(ui.unit, settings.unit, setUnit);

    tafsir = new TafsirPanel({
      root: $("tafsir-panel"), onAyah: goToAyah,
      state: { source: settings.tafsir, scope: settings.tafsirScope }, onChange: save,
    });
    bindSegmented(document.querySelector(".side-tabs"), settings.sideTab, setSideTab, "aria-selected");
    setSideTab(settings.sideTab);

    learn = new LearnView({ root: $("view-learn"), clipAudio: $("clip-audio"), reciters });
    addEventListener("hashchange", route);
    route();
    await loadSelection();
  } catch (e) {
    showState(e.message || "تعذّر الاتصال بالخادم المحلي.", { error: true, retry: boot });
  }
}

boot();
