/**
 * Plays a precise stretch of a recitation — a few words or one ayah — from the
 * reciter's chapter audio, using the same word timings as the main player.
 * Used by lesson examples so the learner hears exactly the rule being taught.
 */
import { api } from "./api.js";

const TAIL_MS = 140;

export class ClipPlayer extends EventTarget {
  constructor(audio) {
    super();
    this.audio = audio;
    this.end = 0;
    this.owner = null;
    this._raf = 0;
    const stopIfDone = () => { if (this.owner && this.audio.currentTime * 1000 >= this.end) this.stop(); };
    audio.addEventListener("timeupdate", stopIfDone);
    audio.addEventListener("ended", () => this.stop());
    audio.addEventListener("error", () => this._set("error"));
    audio.addEventListener("waiting", () => this.owner && this._set("loading"));
    audio.addEventListener("playing", () => this.owner && this._set("playing"));
  }

  /** Range in ms for words p1..p2 of an ayah (first contiguous occurrence). */
  static range(verse, p1, p2) {
    if (p1 == null) return [verse.from, verse.to];
    const segs = verse.segs;
    const i = segs.findIndex((s) => s[0] === p1);
    if (i < 0) return [verse.from, verse.to];
    let j = i;
    while (j < segs.length && segs[j][0] !== p2) j++;
    return [segs[i][1], (segs[j] || segs[segs.length - 1])[2]];
  }

  /**
   * @param owner   any object identifying the button (to toggle / report state)
   * @param rid     reciter id
   * @param surah   surah number, ayah: ayah number
   * @param words   [p1, p2] or null for the whole ayah
   */
  async play(owner, rid, surah, ayah, words = null) {
    if (this.owner === owner) { this.stop(); return; }
    this.stop();
    this.owner = owner;
    this._set("loading");
    try {
      const t = await api.timings(rid, surah);
      if (this.owner !== owner) return;
      const verse = t.verses.find((v) => v.n === ayah);
      if (!verse) throw new Error("no verse");
      const [start, end] = ClipPlayer.range(verse, words?.[0], words?.[1]);
      this.end = end + TAIL_MS;
      const src = t.stream;
      if (this.audio.getAttribute("src") !== src) this.audio.src = src;
      await this._seek(start / 1000);
      if (this.owner !== owner) return;
      await this.audio.play();
      this._loop();
    } catch (e) {
      if (this.owner === owner && e.name !== "AbortError") { this._set("error"); this.owner = null; }
    }
  }

  stop() {
    cancelAnimationFrame(this._raf);
    this.audio.pause();
    const prev = this.owner;
    this.owner = null;
    if (prev) this._emit({ owner: prev, state: "idle" });
  }

  _seek(sec) {
    return new Promise((resolve) => {
      const go = () => {
        this.audio.currentTime = sec;
        resolve();
      };
      if (this.audio.readyState >= 1) go();
      else this.audio.addEventListener("loadedmetadata", go, { once: true });
      if (this.audio.readyState === 0) this.audio.load();
    });
  }

  _loop() {
    const step = () => {
      if (!this.owner) return;
      if (this.audio.currentTime * 1000 >= this.end) { this.stop(); return; }
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  _set(state) { if (this.owner) this._emit({ owner: this.owner, state }); }
  _emit(detail) { this.dispatchEvent(new CustomEvent("state", { detail })); }
}
