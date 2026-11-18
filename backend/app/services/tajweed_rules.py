"""Tajweed rule catalog — the single source of truth for names, categories,
harakat counts, descriptions and colour palettes. Served to the UI via
/api/tajweed/rules. Keys are the class names used in Quran.com markup."""
from __future__ import annotations

# "lesson" = slug of the lesson that teaches the rule (frontend/data/learn/lessons/);
# "cite"   = lines of تحفة الأطفال / الجزرية that state it (line numbers from the
#            Ghunna project's Wikisource texts, see frontend/data/learn/mutun.json).
# Two palettes:
#   "maarifa": the colour convention of the Dar al-Maarifah tajweed mushaf
#              (familiar to most Arabic readers; merges all nasal rules into green).
#   "qcom":    Quran.com's granular palette (one colour per rule).
# Each colour is [light-theme, dark-theme].
RULES: dict[str, dict] = {
    # ── المدود ─────────────────────────────────────────────
    "madda_necessary": {
        "name": "مد لازم", "category": "madd", "harakat": "٦",
        "desc": "حرف مد بعده سكون أصلي ثابت وصلًا ووقفًا (في كلمة أو في حروف فواتح السور). يُمد ست حركات لزومًا.",
        "lesson": "madd-lazim", "cite": {"text": "tuhfah", "lines": [47, 48, 49, 50, 51, 52]},
        "maarifa": ["#8b0000", "#ff6b6b"], "qcom": ["#000ebc", "#7c8cff"],
    },
    "madda_obligatory_mottasel": {
        "name": "مد واجب متصل", "category": "madd", "harakat": "٤ – ٥",
        "desc": "حرف مد بعده همزة في الكلمة نفسها. يُمد أربع أو خمس حركات وجوبًا (حفص من طريق الشاطبية).",
        "lesson": "madd-muttasil-munfasil", "cite": {"text": "tuhfah", "lines": [42, 43]},
        "maarifa": ["#d10a1e", "#ff5c6c"], "qcom": ["#2144c1", "#7f9bff"],
    },
    "madda_obligatory_monfasel": {
        "name": "مد جائز منفصل", "category": "madd", "harakat": "٤ – ٥",
        "desc": "حرف مد في آخر الكلمة والهمزة في أول الكلمة التالية. يُمد أربع أو خمس حركات وصلًا، ويُمد حركتين عند الوقف على الكلمة.",
        "lesson": "madd-muttasil-munfasil", "cite": {"text": "tuhfah", "lines": [42, 44]},
        "maarifa": ["#f08a00", "#ffb347"], "qcom": ["#2144c1", "#7f9bff"],
    },
    "madda_permissible": {
        "name": "مد عارض للسكون", "category": "madd", "harakat": "٢ – ٤ – ٦",
        "desc": "حرف مد أو لين بعده حرف سُكّن لأجل الوقف. يجوز فيه القصر (٢) والتوسط (٤) والإشباع (٦) عند الوقف، ويُقرأ مدًا طبيعيًا عند الوصل.",
        "lesson": "madd-arid-leen", "cite": {"text": "tuhfah", "lines": [45]},
        "maarifa": ["#f08a00", "#ffb347"], "qcom": ["#4050ff", "#8f99ff"],
    },
    "madda_normal": {
        "name": "مد طبيعي", "category": "madd", "harakat": "٢",
        "desc": "حرف مد (ا، و، ي) أو ألف خنجرية ليس بعده همز ولا سكون. يُمد حركتين فقط بلا زيادة ولا نقص.",
        "lesson": "madd-tabee3i", "cite": {"text": "tuhfah", "lines": [35, 36, 37]},
        "maarifa": ["#b07a3c", "#d9a868"], "qcom": ["#537fff", "#93adff"],
    },
    # ── أحكام النون الساكنة والتنوين ───────────────────────
    "ikhafa": {
        "name": "إخفاء حقيقي", "category": "noon", "harakat": "٢ (غنة)",
        "desc": "نون ساكنة أو تنوين بعدها أحد حروف الإخفاء الخمسة عشر (ص ذ ث ك ج ش ق س د ط ز ف ت ض ظ). تُنطق النون بين الإظهار والإدغام مع غنة حركتين.",
        "lesson": "ikhfa-haqiqi", "cite": {"text": "tuhfah", "lines": [14, 15, 16]},
        "maarifa": ["#169200", "#5fd35f"], "qcom": ["#9400a8", "#e07af0"],
    },
    "idgham_ghunnah": {
        "name": "إدغام بغنة", "category": "noon", "harakat": "٢ (غنة)",
        "desc": "نون ساكنة أو تنوين في آخر كلمة، وبعدها أحد حروف «ينمو» (ي ن م و) في أول الكلمة التالية. تُدغم النون فيه مع غنة حركتين.",
        "lesson": "idgham-nun", "cite": {"text": "tuhfah", "lines": [9, 10, 11]},
        "maarifa": ["#169200", "#5fd35f"], "qcom": ["#169777", "#4fd1ad"],
    },
    "idgham_wo_ghunnah": {
        "name": "إدغام بلا غنة", "category": "noon", "harakat": "—",
        "desc": "نون ساكنة أو تنوين بعدها لام أو راء. تُدغم النون إدغامًا كاملًا بلا غنة.",
        "lesson": "idgham-nun", "cite": {"text": "tuhfah", "lines": [12]},
        "maarifa": ["#9a9a9a", "#8b8b8b"], "qcom": ["#169200", "#5fd35f"],
    },
    "iqlab": {
        "name": "إقلاب", "category": "noon", "harakat": "٢ (غنة)",
        "desc": "نون ساكنة أو تنوين بعدها باء. تُقلب النون ميمًا مخفاة عند الباء مع غنة حركتين (وتُرسم ميم صغيرة ۢ).",
        "lesson": "iqlab", "cite": {"text": "tuhfah", "lines": [13]},
        "maarifa": ["#169200", "#5fd35f"], "qcom": ["#26bffd", "#6fd6ff"],
    },
    # ── أحكام الميم الساكنة ───────────────────────────────
    "ikhafa_shafawi": {
        "name": "إخفاء شفوي", "category": "meem", "harakat": "٢ (غنة)",
        "desc": "ميم ساكنة بعدها باء. تُخفى الميم عند الباء مع غنة حركتين دون إطباق كامل للشفتين.",
        "lesson": "meem-sakinah", "cite": {"text": "tuhfah", "lines": [19, 20]},
        "maarifa": ["#169200", "#5fd35f"], "qcom": ["#d500b7", "#ff7ae6"],
    },
    "idgham_shafawi": {
        "name": "إدغام شفوي", "category": "meem", "harakat": "٢ (غنة)",
        "desc": "ميم ساكنة بعدها ميم متحركة (إدغام مثلين صغير). تُدغم الأولى في الثانية فتصيران ميمًا مشددة مع غنة حركتين.",
        "lesson": "meem-sakinah", "cite": {"text": "tuhfah", "lines": [21]},
        "maarifa": ["#169200", "#5fd35f"], "qcom": ["#58b800", "#8fe04a"],
    },
    # ── الغنة والقلقلة ────────────────────────────────────
    "ghunnah": {
        "name": "غنة مشددة", "category": "ghunnah", "harakat": "٢",
        "desc": "نون أو ميم مشددة. تجب فيها الغنة بمقدار حركتين، وهي أكمل مراتب الغنة.",
        "lesson": "ghunnah", "cite": {"text": "tuhfah", "lines": [17]},
        "maarifa": ["#169200", "#5fd35f"], "qcom": ["#ff7e1e", "#ffa45c"],
    },
    "qalaqah": {
        "name": "قلقلة", "category": "qalqalah", "harakat": "—",
        "desc": "أحد حروف «قطب جد» (ق ط ب ج د) ساكنًا. يُنطق بنبرة واضحة (اضطراب في المخرج). صغرى إذا كان السكون وسط الكلمة، وكبرى عند الوقف على الحرف.",
        "lesson": "qalqalah", "cite": {"text": "jazariyyah", "lines": [23, 38]},
        "maarifa": ["#1d4ed8", "#6ea8ff"], "qcom": ["#dd0008", "#ff6b70"],
    },
    # ── إدغام المتجانسين والمتقاربين ──────────────────────
    "idgham_mutajanisayn": {
        "name": "إدغام متجانسين", "category": "idgham", "harakat": "—",
        "desc": "حرفان اتفقا مخرجًا واختلفا صفة، والأول ساكن (مثل: د في ت، ت في ط، ث في ذ، ب في م). يُدغم الأول في الثاني.",
        "lesson": "mutamathilain", "cite": {"text": "tuhfah", "lines": [32, 33]},
        "maarifa": ["#9a9a9a", "#8b8b8b"], "qcom": ["#a1a1a1", "#9a9a9a"],
    },
    "idgham_mutaqaribayn": {
        "name": "إدغام متقاربين", "category": "idgham", "harakat": "—",
        "desc": "حرفان تقاربا مخرجًا أو صفة والأول ساكن (مثل: ل في ر «بل ران»، ق في ك «نخلقكم»). يُدغم الأول في الثاني.",
        "lesson": "mutamathilain", "cite": {"text": "tuhfah", "lines": [31, 33]},
        "maarifa": ["#9a9a9a", "#8b8b8b"], "qcom": ["#a1a1a1", "#9a9a9a"],
    },
    # ── ما يُكتب ولا يُلفظ ────────────────────────────────
    "ham_wasl": {
        "name": "همزة وصل", "category": "silent", "harakat": "—",
        "desc": "همزة تُنطق عند الابتداء بالكلمة وتسقط في درج الكلام (عند الوصل بما قبلها).",
        "lesson": "hamzat-al-wasl", "cite": {"text": "jazariyyah", "lines": [100, 101, 102]},
        "maarifa": ["#9a9a9a", "#8b8b8b"], "qcom": ["#aaaaaa", "#8b8b8b"],
    },
    "laam_shamsiyah": {
        "name": "لام شمسية", "category": "silent", "harakat": "—",
        "desc": "لام «ال» التعريف إذا وليها حرف شمسي: تُكتب ولا تُنطق، ويُدغم فيها الحرف الشمسي فيُشدد.",
        "lesson": "lam-shamsiyyah-qamariyyah", "cite": {"text": "tuhfah", "lines": [26, 27, 28]},
        "maarifa": ["#9a9a9a", "#8b8b8b"], "qcom": ["#aaaaaa", "#8b8b8b"],
    },
    "slnt": {
        "name": "حرف لا يُنطق", "category": "silent", "harakat": "—",
        "desc": "حرف يُكتب في الرسم العثماني ولا يُلفظ وصلًا ولا وقفًا (وعليه علامة الصفر المستدير ۟ أو يكون زائدًا).",
        "lesson": None, "cite": None,
        "maarifa": ["#9a9a9a", "#8b8b8b"], "qcom": ["#aaaaaa", "#8b8b8b"],
    },
}

CATEGORIES: dict[str, str] = {
    "madd": "المدود",
    "noon": "النون الساكنة والتنوين",
    "meem": "الميم الساكنة",
    "ghunnah": "الغنة",
    "qalqalah": "القلقلة",
    "idgham": "الإدغام",
    "silent": "ما يُكتب ولا يُلفظ",
}

# Classes present in the markup that carry no reading rule (rendering helpers).
IGNORED_CLASSES = {"custom-alef-maksora"}

# Waqf (pause) marks — shown in the audit panel when present in a word.
WAQF_MARKS: dict[str, dict[str, str]] = {
    "ۖ": {"sign": "صلى", "name": "الوصل أولى", "desc": "يجوز الوقف والوصل، والوصل أولى."},
    "ۗ": {"sign": "قلى", "name": "الوقف أولى", "desc": "يجوز الوقف والوصل، والوقف أولى."},
    "ۘ": {"sign": "م", "name": "وقف لازم", "desc": "يلزم الوقف هنا؛ لأن الوصل قد يوهم معنى غير مراد."},
    "ۙ": {"sign": "لا", "name": "لا تقف", "desc": "لا يُوقف هنا ابتداءً، ويُوصل بما بعده."},
    "ۚ": {"sign": "ج", "name": "جواز الوقف", "desc": "يجوز الوقف والوصل على السواء."},
    "ۛ": {"sign": "∴", "name": "وقف التعانق", "desc": "إذا وقفت على أحد الموضعين فلا تقف على الآخر."},
}


def catalog() -> dict:
    return {"rules": RULES, "categories": CATEGORIES, "waqf": WAQF_MARKS}
