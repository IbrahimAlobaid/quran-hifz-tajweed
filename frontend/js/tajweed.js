/** Tajweed legend, word audit (التدقيق) and per-ayah rule summary. */
import { learnData } from "./learn-data.js";
import { ar, el } from "./util.js";

const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
};

/** «مصحف التجويد» colours → the design system's tajweed tokens (Day, Night, Mushaf). */
const TJ_TOKEN = {
  "#8b0000": "--tj-madd-6", "#d10a1e": "--tj-madd-4", "#f08a00": "--tj-madd-2-6", "#b07a3c": "--tj-madd-2",
  "#169200": "--tj-ghunnah", "#1d4ed8": "--tj-qalqalah", "#9a9a9a": "--tj-silent",
};

export class TajweedPanel extends EventTarget {
  constructor({ catalog, legend, wordBox, ayahBox, ayahBadge, mushaf }) {
    super();
    this.cat = catalog;
    this.legend = legend;
    this.wordBox = wordBox;
    this.ayahBox = ayahBox;
    this.ayahBadge = ayahBadge;
    this.mushaf = mushaf;
    this.palette = "maarifa";
    this.focused = null;
  }

  color(rule) {
    const c = this.cat.rules[rule]?.[this.palette];
    if (!c) return "currentColor";
    if (this.palette === "maarifa" && TJ_TOKEN[c[0]]) return `var(${TJ_TOKEN[c[0]]})`; // follows the theme
    return c[isDark() ? 1 : 0];
  }

  /** Write one CSS custom property per rule onto the given roots. */
  applyColors(palette = this.palette) {
    this.palette = palette;
    const css = Object.keys(this.cat.rules)
      .map((r) => `[data-r="${r}"]{--c:${this.color(r)}}`).join("\n");
    let style = document.getElementById("tj-colors");
    if (!style) { style = el("style", { id: "tj-colors" }); document.head.append(style); }
    style.textContent = css;
  }

  renderLegend(counts) {
    const byCat = new Map();
    for (const [key, r] of Object.entries(this.cat.rules)) {
      if (!byCat.has(r.category)) byCat.set(r.category, []);
      byCat.get(r.category).push(key);
    }
    this.legend.replaceChildren(...[...byCat].map(([cat, keys]) =>
      el("div", {},
        el("p", { class: "legend__cat" }, this.cat.categories[cat]),
        el("div", { class: "legend__items" }, keys.map((k) => {
          const n = counts.get(k) || 0;
          return el("button", {
            type: "button", class: "chip" + (n ? "" : " chip--empty"), dataset: { r: k },
            "aria-pressed": String(this.focused === k), title: this.cat.rules[k].desc,
            onclick: () => this.toggleFocus(k),
          }, el("span", { class: "dot" }), this.cat.rules[k].name,
          // how often the rule occurs on screen, not a length in harakat
          el("span", { class: "chip__n", title: `عدد مرات وروده: ${ar(n)}`, "aria-label": `ورد ${ar(n)} مرة` }, ar(n)));
        })),
      )));
  }

  toggleFocus(rule) {
    this.focused = this.focused === rule ? null : rule;
    this.legend.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.r === this.focused)));
    this._emit("focus", { rule: this.focused });
  }

  /** Detailed audit for one word: every rule, its trigger and the reason. */
  showWord(word, ayahN, { onListen, onPlayFrom } = {}) {
    if (!word) {
      this.wordBox.replaceChildren(el("p", { class: "hint" }, "اختر كلمة من النص لعرض أحكامها وسبب كل حكم."));
      return;
    }
    const big = el("p", { class: "word-audit__word tj-on" });
    for (const s of word.segs) big.append(s.r ? el("span", { class: "tj", dataset: { r: s.r } }, s.t) : s.t);

    const actions = el("div", { class: "word-audit__actions" },
      word.wbw ? el("button", { type: "button", class: "btn", onclick: onListen },
        icon("M4 9v6h4l5 4V5L8 9zM16 8.5a5 5 0 0 1 0 7"), "استمع للكلمة") : null,
      el("button", { type: "button", class: "btn", onclick: onPlayFrom },
        icon("M8 5l11 7-11 7z", true), "تلاوة من هنا"),
    );

    const items = word.rules.map((r) => {
      const info = this.cat.rules[r.r];
      return el("li", { class: "rule", dataset: { r: r.r } },
        el("div", { class: "rule__head" },
          el("span", { class: "rule__name" }, info.name),
          el("span", { class: "rule__harakat" }, info.harakat !== "—" ? `المقدار: ${info.harakat}` : ""),
        ),
        el("span", { class: "rule__frag", "aria-hidden": "true" }, r.text),
        el("p", { class: "rule__note" }, r.note),
        el("details", {}, el("summary", {}, "تعريف الحكم"), info.desc),
        this._learnLinks(info),
      );
    });

    const waqf = (word.waqf || []).map((ch) => {
      const w = this.cat.waqf[ch];
      return el("div", { class: "waqf" }, el("b", {}, ch), ` ${w.name}: ${w.desc}`);
    });

    this.wordBox.replaceChildren(
      big,
      el("p", { class: "hint", style: "text-align:center" }, `الآية ${ar(ayahN)}، الكلمة ${ar(word.p)}`),
      actions,
      items.length ? el("ul", { class: "rule-list" }, items)
        : el("p", { class: "hint" }, "لا توجد في هذه الكلمة أحكام ملوّنة؛ تُقرأ بالإظهار والحركات الأصلية."),
      ...waqf,
    );
  }

  /** Rule summary for the current ayah, grouped by rule with the affected words. */
  showAyah(ayah, onPick) {
    if (!ayah) { this.ayahBox.replaceChildren(); this.ayahBadge.textContent = ""; return; }
    this.ayahBadge.textContent = `الآية ${ar(ayah.n)}`;
    const groups = new Map();
    for (const w of ayah.words) {
      for (const r of w.rules) {
        if (!groups.has(r.r)) groups.set(r.r, new Map());
        groups.get(r.r).set(w.p, w);
      }
    }
    if (!groups.size) {
      this.ayahBox.replaceChildren(el("p", { class: "hint" }, "لا أحكام ملوّنة في هذه الآية."));
      return;
    }
    const order = Object.keys(this.cat.rules);
    const rows = [...groups].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([rule, words]) => {
      const first = [...words.values()][0];
      return el("button", {
        type: "button", class: "ayah-rule", dataset: { r: rule },
        onclick: () => onPick(ayah.n, first.p),
        title: "اعرض تدقيق أول كلمة فيها هذا الحكم",
      },
        el("span", { class: "dot" }),
        el("span", {}, this.cat.rules[rule].name),
        el("span", { class: "muted" }, ar(words.size)),
        el("span", { class: "ayah-rule__words" }, [...words.values()].map((w) => w.text).join("، ")),
      );
    });
    this.ayahBox.replaceChildren(el("div", { class: "ayah-rules" }, rows));
  }

  /** «تعلّم هذا الحكم» link + the lines of the matn that state the rule. */
  _learnLinks(info) {
    if (!info.lesson && !info.cite) return null;
    const box = el("div", { class: "rule__learn" },
      info.lesson ? el("a", { href: `#/learn/lesson/${info.lesson}` }, "تعلّم هذا الحكم") : null);
    if (info.cite) {
      const shahid = el("blockquote", { class: "shahid", hidden: true });
      box.append(shahid);
      learnData.cite(info.cite.text, info.cite.lines).then((c) => {
        if (!c?.lines.length) return;
        shahid.hidden = false;
        shahid.append(
          ...c.lines.map((l) => el("p", { class: "shahid__bayt" }, el("span", {}, l.a), el("span", {}, l.b))),
          el("a", { class: "shahid__src", href: `#/learn/mutun/${c.key}-${c.lines[0].n}` },
            info.cite.text === "tuhfah" ? "تحفة الأطفال" : "المقدمة الجزرية", `، البيت ${c.lines.map((l) => ar(l.n)).join("، ")}`));
      }).catch(() => {});
    }
    return box;
  }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
}

function icon(d, fill = false) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", d);
  p.setAttribute("fill", fill ? "currentColor" : "none");
  p.setAttribute("stroke", "currentColor");
  p.setAttribute("stroke-width", "1.8");
  p.setAttribute("stroke-linejoin", "round");
  svg.append(p);
  return svg;
}
