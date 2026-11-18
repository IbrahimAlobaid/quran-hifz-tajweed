import { api } from "./api.js";
import { LearnView } from "./learn.js";
import { Player } from "./player.js";
import { settings, save } from "./store.js";
import { TajweedPanel } from "./tajweed.js";
import { ar, el } from "./util.js";
import { MushafView } from "./view.js";

const $ = (id) => document.getElementById(id);
const ui = {
  surah: $("surah"), from: $("from"), to: $("to"), reciter: $("reciter"),
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
let surahs = [], surah = null, panel = null, loadToken = 0, learn = null;

// ── helpers ────────────────────────────────────────────
function fillRepeatSelect(sel, max, label) {
  sel.replaceChildren(
    ...Array.from({ length: max }, (_, i) => el("option", { value: i + 1 }, i === 0 ? "مرة واحدة" : `${ar(i + 1)} ${label}`)),
    el("option", { value: 0 }, "بلا توقف"),
  );
}

function bindSegmented(group, value, onChange) {
  const set = (v) => group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.v === v)));
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

function clampRange() {
  const max = surah?.ayahs || 286;
  let from = Math.min(Math.max(parseInt(ui.from.value, 10) || 1, 1), max);
  let to = Math.min(Math.max(parseInt(ui.to.value, 10) || from, 1), max);
  if (to < from) [from, to] = [to, from];
  ui.from.value = from; ui.to.value = to;
  ui.from.max = ui.to.max = max;
  return { from, to };
}

function updateStatus() {
  const cur = player.cur;
  const { ayahRepeat, rangeRepeat } = player.opts;
  ui.stAyah.textContent = surah ? `سورة ${surah.name}، الآية ${ar(cur)}` : "—";
  const parts = [];
  parts.push(`التكرار ${ar(player.ayahPass)} من ${ayahRepeat ? ar(ayahRepeat) : "∞"}`);
  if (rangeRepeat !== 1) parts.push(`الدورة ${ar(player.rangePass)} من ${rangeRepeat ? ar(rangeRepeat) : "∞"}`);
  parts.push(`المقطع ${ar(player.range.from)}–${ar(player.range.to)}`);
  ui.stDetail.textContent = parts.join("  |  ");
  document.body.classList.toggle("is-playing", player.playing || player.inGap);
  ui.mushaf.classList.toggle("is-playing", player.playing || player.inGap);
  ui.play.setAttribute("aria-label", player.playing ? "إيقاف مؤقت" : "تشغيل");
}

async function refreshCacheState() {
  try {
    const s = await api.cacheState(settings.rid, settings.surah);
    ui.stCache.textContent = { cached: "الصوت محفوظ على الجهاز", downloading: "جارٍ حفظ الصوت للاستماع دون اتصال…", remote: "يُبث الصوت من الإنترنت" }[s] || "";
    if (s === "downloading") setTimeout(refreshCacheState, 4000);
  } catch { /* status is informational only */ }
}

// ── loading ────────────────────────────────────────────
async function loadSelection({ keepPosition = false } = {}) {
  const token = ++loadToken;
  const n = settings.surah;
  ui.play.disabled = true;
  showState("جارٍ تحميل الآيات والتوقيتات…");
  try {
    const [s, t] = await Promise.all([api.surah(n), api.timings(settings.rid, n)]);
    if (token !== loadToken) return;
    surah = s;
    const { from, to } = clampRange();
    save({ from, to });
    view.render(s, from, to);
    view.setMode(settings.hideMode);
    const prevAyah = player.cur;
    player.load(t, t.audio);
    player.setRange(from, to);
    player.cur = keepPosition && prevAyah >= from && prevAyah <= to ? prevAyah : from;
    view.setAyah(player.cur);
    panel.renderLegend(countRules(s, from, to));
    if (panel.focused) view.focusRule(panel.focused);
    panel.showAyah(view.ayahData(player.cur), pickWord);
    panel.showWord(null);
    showState("");
    ui.play.disabled = false;
    updateStatus();
    refreshCacheState();
  } catch (e) {
    if (token !== loadToken) return;
    showState(e.message || "تعذّر التحميل.", { error: true, retry: () => loadSelection() });
  }
}

function countRules(s, from, to) {
  const c = new Map();
  for (const a of s.verses) {
    if (a.n < from || a.n > to) continue;
    for (const w of a.words) for (const r of w.rules) c.set(r.r, (c.get(r.r) || 0) + 1);
  }
  return c;
}

function pickWord(n, p) {
  view.select(n, p);
  const w = view.wordData(n, p);
  panel.showWord(w, n, {
    onListen: () => { wbwAudio.src = api.wbwUrl(w.wbw); wbwAudio.play().catch(() => {}); },
    onPlayFrom: () => player.jump(n, p),
  });
  if (n !== player.cur && !player.playing) {
    player.cur = n;
    view.setAyah(n);
    panel.showAyah(view.ayahData(n), pickWord);
    updateStatus();
  }
}

// ── wiring ─────────────────────────────────────────────
player.addEventListener("time", ({ detail }) => {
  view.setWord(detail.ayah, detail.word);
  ui.fill.style.width = `${(detail.frac * 100).toFixed(2)}%`;
  ui.progress.setAttribute("aria-valuenow", Math.round(detail.frac * 100));
});
player.addEventListener("ayah", () => {
  view.setAyah(player.cur);
  panel.showAyah(view.ayahData(player.cur), pickWord);
  updateStatus();
});
player.addEventListener("pass", () => {
  if (settings.hideMode !== "show") view.resetReveal(player.cur);
  view.clearWord();
  updateStatus();
});
player.addEventListener("state", updateStatus);
player.addEventListener("done", () => { view.clearWord(); ui.fill.style.width = "0"; ui.stDetail.textContent = "اكتمل المقطع. اضغط تشغيل للبدء من جديد."; });
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

view.addEventListener("word", ({ detail }) => pickWord(detail.n, detail.p));
view.addEventListener("playword", ({ detail }) => player.jump(detail.n, detail.p));
view.addEventListener("ayahclick", ({ detail }) => player.jump(detail.n));

ui.play.addEventListener("click", () => player.toggle());
ui.next.addEventListener("click", () => player.next());
ui.prev.addEventListener("click", () => player.prev());

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
  ui.from.value = 1;
  ui.to.value = Math.min(meta.ayahs, 7);
  save({ surah: n });
  player.stop();
  loadSelection();
});
for (const inp of [ui.from, ui.to]) inp.addEventListener("change", () => { player.stop(); loadSelection(); });
ui.reciter.addEventListener("change", () => { save({ rid: +ui.reciter.value }); player.stop(); loadSelection({ keepPosition: true }); });
ui.ayahRepeat.addEventListener("change", () => { save({ ayahRepeat: +ui.ayahRepeat.value }); player.setOptions({ ayahRepeat: settings.ayahRepeat }); updateStatus(); });
ui.rangeRepeat.addEventListener("change", () => { save({ rangeRepeat: +ui.rangeRepeat.value }); player.setOptions({ rangeRepeat: settings.rangeRepeat }); updateStatus(); });
ui.gap.addEventListener("change", () => { save({ gap: ui.gap.value }); player.setOptions({ gap: settings.gap }); });
ui.rate.addEventListener("change", () => { save({ rate: +ui.rate.value }); player.setOptions({ rate: settings.rate }); });

ui.tj.addEventListener("change", () => { save({ tajweed: ui.tj.checked }); ui.mushaf.classList.toggle("tj-on", ui.tj.checked); });
ui.dim.addEventListener("change", () => { save({ dim: ui.dim.checked }); ui.mushaf.classList.toggle("dim-others", ui.dim.checked); });

function setFont(px) {
  px = Math.min(Math.max(px, 20), 64);
  document.documentElement.style.setProperty("--q-size", `${px}px`);
  save({ qSize: px });
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
  else if (e.key === "ArrowLeft") { e.preventDefault(); player.next(); }   // RTL: left = forward
  else if (e.key === "ArrowRight") { e.preventDefault(); player.prev(); }
  else if (e.key.toLowerCase() === "t") { ui.tj.click(); }
  else if (e.key.toLowerCase() === "r") {
    const v = settings.ayahRepeat === 0 ? 1 : 0;
    ui.ayahRepeat.value = v; ui.ayahRepeat.dispatchEvent(new Event("change"));
  }
});

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

    panel = new TajweedPanel({
      catalog, legend: $("legend"), wordBox: $("word-audit"), ayahBox: $("ayah-audit"), ayahBadge: $("ayah-badge"),
    });
    panel.applyColors(settings.palette);
    panel.addEventListener("focus", ({ detail }) => view.focusRule(detail.rule));
    bindSegmented(ui.palette, settings.palette, (v) => { save({ palette: v }); panel.applyColors(v); });
    bindSegmented(ui.hideMode, settings.hideMode, (v) => { save({ hideMode: v }); view.setMode(v); });

    learn = new LearnView({ root: $("view-learn"), clipAudio: $("clip-audio"), reciters });
    addEventListener("hashchange", route);
    route();
    await loadSelection();
  } catch (e) {
    showState(e.message || "تعذّر الاتصال بالخادم المحلي.", { error: true, retry: boot });
  }
}

boot();
