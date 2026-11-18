/**
 * Tafsir sources and loading — no DOM here, so the grouping logic is testable
 * under Node (backend/tests run it via `node --test frontend/tests`).
 *
 * Two keyless, CORS-open providers, fetched by the browser in both modes:
 *   qc  — Quran.com API v4 `tafsirs/{id}/by_ayah/{key}`. The reply lists the
 *         ayahs the passage covers; an ayah explained together with the one
 *         before it answers 404, so we walk back to the passage that holds it.
 *   cdn — spa5k/tafsir_api (QUL data) on jsDelivr, one JSON per surah, pinned
 *         to a release. Ayahs explained together repeat the same text.
 */

export const LEVELS = [
  {
    id: "brief", name: "مختصر", hint: "معنى الآية بعبارة قريبة، للفهم السريع أثناء الحفظ",
    items: [
      { id: "muyassar", name: "التفسير الميسّر", by: "نخبة من العلماء، مجمع الملك فهد", about: "عبارة سهلة موجزة تبيّن المعنى العام للآية.", p: "qc", rid: 16 },
      { id: "mukhtasar", name: "المختصر في التفسير", by: "مركز تفسير للدراسات القرآنية", about: "معنى الآية في سطور بلغة معاصرة.", p: "cdn", slug: "ar-tafsir-al-mukhtasar" },
      { id: "jalalayn", name: "تفسير الجلالين", by: "جلال الدين المحلّي وجلال الدين السيوطي", about: "شرح لفظي موجز ممزوج بكلمات الآية.", p: "cdn", slug: "ar-tafsir-al-jalalayn" },
    ],
  },
  {
    id: "middle", name: "متوسط", hint: "شرح أوسع للمعاني والفوائد، للتدبّر",
    items: [
      { id: "saadi", name: "تيسير الكريم الرحمن (السعدي)", by: "عبد الرحمن بن ناصر السعدي", about: "واضح العبارة، يعتني بالمعاني والهدايات والفوائد.", p: "qc", rid: 91 },
      { id: "baghawi", name: "معالم التنزيل (البغوي)", by: "الحسين بن مسعود البغوي", about: "تفسير بالمأثور متوسط الطول، يذكر أقوال السلف باختصار.", p: "qc", rid: 94 },
      { id: "wasit", name: "التفسير الوسيط", by: "محمد سيد طنطاوي", about: "شرح متوسط بأسلوب معاصر، يجمع اللغة والمعنى.", p: "qc", rid: 93 },
    ],
  },
  {
    id: "deep", name: "موسّع", hint: "الأقوال والأدلة والأحكام، للدراسة",
    items: [
      { id: "ibnkathir", name: "تفسير القرآن العظيم (ابن كثير)", by: "إسماعيل بن عمر بن كثير", about: "يفسّر القرآن بالقرآن ثم بالسنة وأقوال الصحابة والتابعين.", p: "qc", rid: 14 },
      { id: "qurtubi", name: "الجامع لأحكام القرآن (القرطبي)", by: "محمد بن أحمد القرطبي", about: "يعتني بالأحكام الفقهية واللغة والقراءات.", p: "qc", rid: 90 },
      { id: "tabari", name: "جامع البيان (الطبري)", by: "محمد بن جرير الطبري", about: "شيخ المفسّرين؛ يسند أقوال السلف ويرجّح بينها. طويل جدًّا.", p: "qc", rid: 15 },
    ],
  },
];

export const SOURCES = new Map(LEVELS.flatMap((l) => l.items.map((it) => [it.id, { ...it, level: l }])));
export const DEFAULT_SOURCE = "muyassar";

const QC = "https://api.quran.com/api/v4/tafsirs";
const CDN = "https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@1.2.3/tafsir";
const WALK_BACK = 30; // longest run of ayahs explained as one passage

export const PROVIDERS = {
  qc: { name: "Quran.com", url: "https://quran.com" },
  cdn: { name: "tafsir_api (بيانات QUL)", url: "https://github.com/spa5k/tafsir_api" },
};

/**
 * @param fetchJson (url) => Promise<object|null>  — null for 404
 * Entries: { from, to, kind: "html"|"text", body }
 */
export function createTafsirStore(fetchJson) {
  const raw = new Map();     // url -> Promise<json|null>
  const entries = new Map(); // "src:s:n" -> Promise<entry|null>

  const get = (url) => {
    if (!raw.has(url)) {
      const p = fetchJson(url);
      raw.set(url, p);
      p.catch(() => raw.delete(url));
    }
    return raw.get(url);
  };

  async function qcEntry(src, s, n) {
    for (let k = n; k >= Math.max(1, n - WALK_BACK); k--) {
      const d = await get(`${QC}/${src.rid}/by_ayah/${s}:${k}`);
      const t = d?.tafsir;
      if (!t || !t.text) continue;
      const covered = Object.keys(t.verses || {}).map((key) => +key.split(":")[1]).filter(Boolean);
      return { from: Math.min(k, ...covered), to: Math.max(n, ...covered), kind: "html", body: t.text };
    }
    return null;
  }

  async function cdnEntry(src, s, n) {
    const d = await get(`${CDN}/${src.slug}/${s}.json`);
    return d ? groupSurah(d.ayahs || d).get(n) || null : null;
  }

  /** Commentary for one ayah (the passage it belongs to). */
  function entry(id, s, n) {
    const src = SOURCES.get(id);
    const key = `${id}:${s}:${n}`;
    if (!entries.has(key)) {
      const p = (src.p === "qc" ? qcEntry : cdnEntry)(src, s, n);
      entries.set(key, p);
      p.catch(() => entries.delete(key));
    }
    return entries.get(key);
  }

  return { entry };
}

/** Per-surah list [{ayah, text}] -> Map(ayah -> entry); repeated or empty text
 *  joins the previous passage. Entries of one passage share one object. */
export function groupSurah(list) {
  const out = new Map();
  let cur = null;
  for (const { ayah, text } of [...list].sort((a, b) => a.ayah - b.ayah)) {
    const t = (text || "").trim();
    if (cur && (!t || t === cur.body)) cur.to = ayah;
    else if (t) cur = { from: ayah, to: ayah, kind: "text", body: t };
    else continue;
    out.set(ayah, cur);
  }
  return out;
}

/** Merge per-ayah entries of a range into passages, in order. */
export function mergePassages(items) {
  const blocks = [];
  for (const { n, e } of items) {
    const last = blocks.at(-1);
    // Same passage: either reported as one, or the same text repeated per ayah.
    if (e && last?.e && last.e.body === e.body) {
      last.to = Math.max(last.to, n, e.to);
      continue;
    }
    blocks.push({ e, from: e ? Math.min(e.from, n) : n, to: e ? Math.max(e.to, n) : n, ayahs: [] });
  }
  for (const b of blocks) for (const { n } of items) if (n >= b.from && n <= b.to) b.ayahs.push(n);
  return blocks;
}
