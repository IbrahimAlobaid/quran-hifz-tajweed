/**
 * Repetition engine on top of one chapter-length <audio>.
 *
 * Playback is driven by the reciter's verse timings: each ayah plays from
 * `from` to `to` (ms). At an ayah end the engine decides — repeat this ayah,
 * pause for the listener to repeat ("مهلة"), continue, loop the range, or stop.
 * A requestAnimationFrame loop reports the time so the view can highlight the
 * word being recited (word segments are [pos, start, end] in ms).
 */
import { lastStartingBefore } from "./util.js";

const END_SLACK_MS = 40;
const CONTIGUOUS_MS = 350;

export class Player extends EventTarget {
  constructor(audio) {
    super();
    this.audio = audio;
    this.verses = new Map();
    this.opts = { ayahRepeat: 1, rangeRepeat: 1, gap: "0", rate: 1 };
    this.range = { from: 1, to: 1 };
    this.reset();
    this._raf = 0;
    this._gapTimer = 0;
    audio.addEventListener("ended", () => this.playing && this._onAyahEnd());
    // rAF stops in background tabs, and also when the window is covered or not
    // being painted (the page then still reports itself visible). timeupdate
    // (~4 Hz) keeps tracking and the repetition engine running in both cases.
    this._lastFrame = 0;
    audio.addEventListener("timeupdate", () => {
      const stalled = performance.now() - this._lastFrame > 250;
      if (this.playing && !this.inGap && (document.hidden || stalled)) this._tick();
    });
    audio.addEventListener("error", () => this._emit("error", { message: "تعذّر تحميل ملف الصوت. تحقّق من الاتصال ثم أعد المحاولة." }));
    audio.addEventListener("waiting", () => this._emit("buffering", { on: true }));
    audio.addEventListener("playing", () => this._emit("buffering", { on: false }));
    // An ayah-by-ayah reciter's ayah ends where its own file does.
    audio.addEventListener("durationchange", () => {
      const v = this.perAyah && this.verse;
      if (v && this.audio.getAttribute("src") === v.url && Number.isFinite(audio.duration)) v.to = audio.duration * 1000;
    });
  }

  reset() {
    this.cur = this.range.from;
    this.ayahPass = 1;
    this.rangePass = 1;
    this.playing = false;
    this.inGap = false;
    this._positioned = false;
  }

  /**
   * Load a reciter/surah. `t` = sanitized timings from the API.
   * With `t.per_ayah` each verse has its own file (`url`) and no word segments: the
   * engine then switches files between ayahs, and an ayah's length is known once its
   * file loads (until then it ends on the file's 'ended').
   */
  load(t, src) {
    this.stop();
    this.perAyah = !!t.per_ayah;
    this.verses = new Map(t.verses.map((v) => [v.n, this.perAyah ? { ...v, to: Infinity } : v]));
    if (!this.perAyah && this.audio.getAttribute("src") !== src) {
      this.audio.src = src;
      this.audio.load();
    }
    this._rate(this.opts.rate);
    this.reset();
  }

  // a new src resets playbackRate to the default rate, so set both
  _rate(r) { this.audio.defaultPlaybackRate = r; this.audio.playbackRate = r; }

  setRange(from, to) {
    this.range = { from, to };
    if (this.cur < from || this.cur > to) this.stop();
    this.cur = Math.min(Math.max(this.cur, from), to);
  }

  setOptions(patch) {
    Object.assign(this.opts, patch);
    if ("rate" in patch) this._rate(patch.rate);
  }

  get verse() { return this.verses.get(this.cur); }

  async play() {
    const v = this.verse;
    if (!v) return;
    if (this.inGap) { this._endGap(); return; }
    const t = this.audio.currentTime * 1000;
    const elsewhere = this.perAyah && this.audio.getAttribute("src") !== v.url;
    if (elsewhere || !this._positioned || t < v.from - 200 || t >= v.to - END_SLACK_MS) this._seek(v.from);
    this.playing = true;
    this._emit("state");
    try { await this.audio.play(); }
    catch (e) {
      if (e.name !== "AbortError") { this.playing = false; this._emit("error", { message: "تعذّر بدء التشغيل." }); this._emit("state"); }
      return;
    }
    this._loop();
  }

  pause() {
    this.playing = false;
    this._clearGap();
    this.audio.pause();
    cancelAnimationFrame(this._raf);
    this._emit("state");
  }

  toggle() { (this.playing || this.inGap) ? this.pause() : this.play(); }

  stop() {
    this.pause();
    this.reset();
    this._emit("state");
  }

  /** Jump to an ayah (and optionally a word inside it) and play. */
  jump(n, wordPos = null) {
    if (!this.verses.has(n)) return;
    this._clearGap();
    this.cur = n;
    this.ayahPass = 1;
    const v = this.verse;
    let start = v.from;
    if (wordPos != null) {
      const seg = v.segs.find((s) => s[0] === wordPos);
      if (seg) start = seg[1];
    }
    this._seek(start);
    this._emit("ayah");
    this.play();
  }

  next() { if (this.cur < this.range.to) this.jump(this.cur + 1); }
  prev() { if (this.cur > this.range.from) this.jump(this.cur - 1); }

  /** Seek within the current ayah by fraction 0..1. */
  seekFraction(f) {
    const v = this.verse;
    if (!v || !Number.isFinite(v.to)) return; // an ayah file not loaded yet has no length
    this._seek(v.from + (v.to - v.from) * Math.min(Math.max(f, 0), 0.995));
    this._tick(true);
  }

  // ── internals ──────────────────────────────────────────
  _seek(ms) {
    const url = this.perAyah && this.verse?.url;
    if (url && this.audio.getAttribute("src") !== url) this.audio.src = url;
    this.audio.currentTime = ms / 1000;
    this._positioned = true;
  }

  _loop() {
    cancelAnimationFrame(this._raf);
    const step = () => {
      if (!this.playing) return;
      this._lastFrame = performance.now();
      this._tick();
      if (this.playing && !this.inGap) this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  _tick(force = false) {
    const v = this.verse;
    if (!v) return;
    const t = this.audio.currentTime * 1000;
    const i = lastStartingBefore(v.segs, t);
    const seg = i >= 0 ? v.segs[i] : null;
    const word = seg && t < v.to ? seg[0] : null;
    const frac = (t - v.from) / Math.max(1, v.to - v.from);
    this._emit("time", { t, ayah: this.cur, word, frac: Math.min(Math.max(frac, 0), 1) });
    if (!force && this.playing && t >= v.to - END_SLACK_MS) this._onAyahEnd();
  }

  _gapMs() {
    const g = String(this.opts.gap);
    if (g === "0") return 0;
    const v = this.verse;
    if (g.startsWith("x")) return (v.to - v.from) * parseFloat(g.slice(1)) / this.opts.rate;
    return parseFloat(g) * 1000;
  }

  _onAyahEnd() {
    const { ayahRepeat, rangeRepeat } = this.opts;
    const prev = this.verse;
    let nextN = this.cur;
    let finished = false;

    if (ayahRepeat === 0 || this.ayahPass < ayahRepeat) {
      this.ayahPass++;
    } else if (this.cur < this.range.to) {
      nextN = this.cur + 1;
      this.ayahPass = 1;
    } else if (rangeRepeat === 0 || this.rangePass < rangeRepeat) {
      this.rangePass++;
      nextN = this.range.from;
      this.ayahPass = 1;
    } else {
      finished = true;
    }

    if (finished) {
      this.pause();
      this.reset();
      this._seek(this.verses.get(this.range.from)?.from ?? 0);
      this._emit("state");
      this._emit("done");
      return;
    }

    const gap = this._gapMs();
    const changed = nextN !== this.cur;
    this.cur = nextN;
    if (changed) this._emit("ayah");
    const v = this.verse;
    const contiguous = changed && Math.abs(v.from - prev.to) < CONTIGUOUS_MS;

    if (gap > 0) {
      this.audio.pause();
      this._seek(v.from);
      this.inGap = true;
      this._emit("gap", { ms: gap });
      this._emit("state");
      this._gapTimer = setTimeout(() => this._endGap(), gap);
    } else if (!contiguous) {
      this._seek(v.from);
    }
    // After the media 'ended' event the element is paused; resume it.
    if (gap <= 0 && this.audio.paused) this.audio.play().catch(() => {});
    this._emit("pass");
  }

  _endGap() {
    this._clearGap();
    this.play();
  }

  _clearGap() {
    if (this._gapTimer) clearTimeout(this._gapTimer);
    this._gapTimer = 0;
    if (this.inGap) { this.inGap = false; this._emit("gap", { ms: 0 }); }
  }

  _emit(type, detail = {}) { this.dispatchEvent(new CustomEvent(type, { detail })); }
}
