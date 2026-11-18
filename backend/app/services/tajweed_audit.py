"""Tajweed markup parser + rule-reason engine ("التدقيق في الأحكام").

Quran.com marks each word like:
    يُ<rule class=ikhafa>نف</rule>ِق<rule class=madda_permissible>ُو</rule>نَ
Rules spanning two words are marked on both sides: the *source* (the noon/meem/
madd letter at the end of a word) and the *target* letter at the start of the
next word. This module:

1. parses that markup into safe, structured segments  [{"t": text, "r": rule|None}]
2. explains every rule occurrence from its context — which letter triggers it
   and why — e.g. «نون ساكنة بعدها «ف» ← إخفاء حقيقي».
"""
from __future__ import annotations

import html
import re

from app.services.tajweed_rules import IGNORED_CLASSES, RULES, WAQF_MARKS

_TOKEN = re.compile(r"<rule class=([\w-]+)>|</rule>|<[^>]*>|[^<]+")

TANWEEN = set("ًࣰٌࣱٍࣲ")
NOON_RULES = {"ikhafa", "idgham_ghunnah", "idgham_wo_ghunnah", "iqlab"}
MEEM_RULES = {"ikhafa_shafawi", "idgham_shafawi"}
MADD_LETTERS = set("اويىٰۥۦ")  # + dagger alef U+0670, small waw/yeh U+06E5/U+06E6 (صلة)


def is_letter(ch: str) -> bool:
    o = ord(ch)
    return 0x0621 <= o <= 0x063A or 0x0641 <= o <= 0x064A or o == 0x0671


def letters(s: str) -> list[str]:
    return [c for c in s if is_letter(c)]


def parse_markup(markup: str) -> list[dict]:
    """Parse Quran.com word tajweed markup into merged segments.
    Unknown tags are dropped; rule classes are allow-listed."""
    segs: list[dict] = []
    # stack of (rule, occurrence-id): adjacent tags of the same rule (e.g. «لٓ»«مٓ»)
    # stay separate occurrences, while pieces of one tag are merged.
    stack: list[tuple[str | None, int]] = []
    occ = 0
    last_key: tuple[str | None, int] | None = None
    for m in _TOKEN.finditer(markup or ""):
        tok = m.group(0)
        if m.group(1) is not None:
            cls = m.group(1)
            if cls in IGNORED_CLASSES:
                stack.append(stack[-1] if stack else (None, 0))  # inherit outer rule
            else:
                occ += 1
                stack.append((cls, occ) if cls in RULES else (None, 0))
        elif tok == "</rule>":
            if stack:
                stack.pop()
        elif tok.startswith("<"):
            continue
        else:
            text = html.unescape(tok)
            key = stack[-1] if stack and stack[-1][0] else (None, 0)
            if segs and last_key == key:
                segs[-1]["t"] += text
            else:
                segs.append({"t": text} if key[0] is None else {"t": text, "r": key[0]})
            last_key = key
    return segs


def _q(ch: str) -> str:
    return f"«{ch}»"


def _first_letter_after(seg_text: str, anchor: set[str], post: str, next_word: str | None) -> str | None:
    """First base letter after the anchor letter inside the segment, else in the
    rest of the word, else the first letter of the next word."""
    if TANWEEN & set(seg_text):
        # Tanween is always followed (in speech) by the next word; any letter
        # written after it in the same word (e.g. «ى» in «هُدًى», «ا» in «عَلِيمًا») is silent.
        ls = letters(next_word or "")
        return ls[0] if ls else None
    seen = False
    for c in seg_text:
        if c in anchor or c in TANWEEN:
            seen = True
            continue
        if seen and is_letter(c):
            return c
    for src in (post, next_word or ""):
        ls = letters(src)
        if ls:
            return ls[0]
    return None


def _explain(rule: str, seg: str, pre: str, post: str, ctx: dict) -> tuple[str, str]:
    """Return (role, note). role ∈ {source, target, self}."""
    at_start = not letters(pre)
    at_end = not letters(post)
    nxt: str | None = ctx.get("next_word")
    prv: str | None = ctx.get("prev_word")
    seg_letters = letters(seg)
    L = seg_letters[0] if seg_letters else ""

    if rule in NOON_RULES or rule in MEEM_RULES:
        is_meem = rule in MEEM_RULES
        if at_start and pre == "" and not (TANWEEN & set(seg)) and prv:
            src = "للميم الساكنة" if is_meem else "للنون الساكنة أو التنوين"
            return "target", f"الحرف {_q(L)} هو سبب {RULES[rule]['name']} {src} في آخر «{prv}»."
        kind = "ميم ساكنة" if is_meem else ("تنوين" if TANWEEN & set(seg) else "نون ساكنة")
        anchor = {"م"} if is_meem else {"ن"}
        trig = _first_letter_after(seg, anchor, post, nxt)
        where = "" if (trig and trig in seg) or not at_end else " في أول الكلمة التالية"
        tail = {
            "ikhafa": "من حروف الإخفاء ← تُخفى مع غنة حركتين.",
            "idgham_ghunnah": "من حروف «ينمو» ← تُدغم مع غنة حركتين.",
            "idgham_wo_ghunnah": "(لام أو راء) ← تُدغم إدغامًا كاملًا بلا غنة.",
            "iqlab": "← تُقلب ميمًا مخفاة مع الغنة.",
            "ikhafa_shafawi": "← تُخفى الميم عند الباء مع غنة.",
            "idgham_shafawi": "← تُدغم الميم في الميم مع غنة.",
        }[rule]
        return "source", f"{kind} بعدها {_q(trig or '؟')}{where} {tail}"

    if rule == "ghunnah":
        what = "نون مشددة" if "ن" in seg else "ميم مشددة"
        return "self", f"{what} {_q(L)} ← غنة واجبة بمقدار حركتين."

    if rule == "qalaqah":
        if not at_end:
            return "self", f"الحرف {_q(L)} ساكن وسط الكلمة ← قلقلة صغرى."
        if ctx.get("is_last"):
            return "self", f"الحرف {_q(L)} في آخر الآية، يُسكَّن عند الوقف ← قلقلة كبرى."
        return "self", f"الحرف {_q(L)} في آخر الكلمة ← قلقلة صغرى وصلًا، وكبرى إن وقفت عليه."

    if rule == "laam_shamsiyah":
        nxt_l = letters(post)
        sun = nxt_l[0] if nxt_l else "؟"
        return "self", f"لام التعريف بعدها الحرف الشمسي {_q(sun)} ← لا تُنطق ويُشدد {_q(sun)}."

    if rule == "ham_wasl":
        return "self", "همزة وصل: تُنطق عند الابتداء بالكلمة فقط وتسقط عند الوصل."

    if rule == "slnt":
        return "self", f"الحرف {_q(L or seg.strip())} يُكتب ولا يُنطق."

    if rule.startswith("madda_"):
        madd = next((c for c in seg if c in MADD_LETTERS), "") or L
        madd_name = {
            "ٰ": "حرف المد (الألف الخنجرية)",
            "ۥ": "حرف المد (واو الصلة الصغرى)",
            "ۦ": "حرف المد (ياء الصلة الصغرى)",
        }.get(madd, f"حرف المد {_q(madd)}")
        if rule == "madda_normal":
            return "self", f"{madd_name} ليس بعده همز ولا سكون ← حركتان."
        if rule == "madda_obligatory_mottasel":
            return "self", f"{madd_name} بعده همزة في الكلمة نفسها ← ٤ أو ٥ حركات."
        if rule == "madda_obligatory_monfasel":
            n = f" «{nxt}»" if nxt else ""
            return "self", f"{madd_name} في آخر الكلمة والهمزة في أول الكلمة التالية{n} ← ٤ أو ٥ حركات وصلًا."
        if rule == "madda_necessary":
            if L and L not in MADD_LETTERS:  # e.g. «لٓ» «مٓ» in the opening letters of surahs
                return "self", f"حرف {_q(L)} من فواتح السور هجاؤه ثلاثة أحرف أوسطها حرف مد ← مد لازم حرفي ست حركات."
            return "self", f"{madd_name} بعده سكون أصلي أو حرف مشدد ← مد لازم كلمي ست حركات."
        if rule == "madda_permissible":
            lin = re.search("َ[وي]", seg) is not None
            base = "حرف لين (واو أو ياء ساكنة قبلها فتح)" if lin else madd_name
            kind = "مد لين" if lin else "مد عارض للسكون"
            when = "عند الوقف على رأس الآية" if ctx.get("is_last") else "عند الوقف على هذه الكلمة"
            return "self", f"{base} بعده حرف يُسكَّن {when} ← {kind}: ٢ أو ٤ أو ٦ حركات، ويُقرأ طبيعيًا عند الوصل."

    if rule in ("idgham_mutajanisayn", "idgham_mutaqaribayn"):
        second = None
        for src in (post, nxt or ""):
            ls = letters(src)
            if ls:
                second = ls[0]
                break
        return "source", f"إدغام {_q(L)} في {_q(second or '؟')} ← يُنطق حرفًا واحدًا مشددًا."

    return "self", RULES.get(rule, {}).get("desc", "")


def annotate_word(segs: list[dict], ctx: dict) -> list[dict]:
    """List of rule occurrences for one word, each with a contextual note."""
    out: list[dict] = []
    for i, s in enumerate(segs):
        rule = s.get("r")
        if not rule:
            continue
        pre = "".join(x["t"] for x in segs[:i])
        post = "".join(x["t"] for x in segs[i + 1:])
        role, note = _explain(rule, s["t"], pre, post, ctx)
        out.append({"r": rule, "seg": i, "text": s["t"], "role": role, "note": note})
    return out


def waqf_in(text: str) -> list[str]:
    return [c for c in text if c in WAQF_MARKS]
