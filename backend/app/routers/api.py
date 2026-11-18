from __future__ import annotations

import logging
import re
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path as P
from fastapi.responses import FileResponse, RedirectResponse

from app.services import audio_service, quran_api
from app.services.tajweed_rules import catalog

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

SurahNo = Annotated[int, P(ge=1, le=114)]
_WBW = re.compile(r"^wbw/\d{3}_\d{3}_\d{3}\.mp3$")
# "identity" keeps GZipMiddleware away from byte-range audio responses.
AUDIO_HEADERS = {"Cache-Control": "public, max-age=31536000", "Content-Encoding": "identity"}


async def _upstream(coro):
    try:
        return await coro
    except LookupError as e:
        raise HTTPException(404, str(e)) from e
    except RuntimeError as e:
        logger.warning("%s", e)
        raise HTTPException(502, "تعذّر الوصول إلى مصدر البيانات. تحقّق من الاتصال بالإنترنت.") from e


async def _check_reciter(rid: int) -> None:
    if rid not in {r["id"] for r in await _upstream(audio_service.reciters())}:
        raise HTTPException(404, "قارئ غير معروف")


@router.get("/health")
async def health():
    return {"status": "ok"}


@router.get("/surahs")
async def surahs():
    return await _upstream(quran_api.chapters())


@router.get("/surah/{n}")
async def surah(n: SurahNo):
    return await _upstream(quran_api.surah(n))


@router.get("/reciters")
async def reciters():
    return await _upstream(audio_service.reciters())


@router.get("/tajweed/rules")
async def tajweed_rules():
    return catalog()


@router.get("/timings/{rid}/{n}")
async def timings(rid: int, n: SurahNo):
    await _check_reciter(rid)
    t = await _upstream(audio_service.timings(rid, n))
    dest = audio_service.audio_file(rid, n)
    return {**t, "audio": f"/api/audio/{rid}/{n}", "cache": audio_service.download_state(dest)}


@router.get("/audio/{rid}/{n}")
async def audio(rid: int, n: SurahNo, cache: bool = True):
    """Serve the chapter mp3 from disk (HTTP Range supported for seeking).
    On a cache miss, redirect to the CDN and cache it in the background
    (cache=0 streams only — used for short lesson clips)."""
    await _check_reciter(rid)
    dest = audio_service.audio_file(rid, n)
    if dest.exists():
        return FileResponse(dest, media_type="audio/mpeg", headers=AUDIO_HEADERS)
    t = await _upstream(audio_service.timings(rid, n))
    if cache:
        audio_service.ensure_download(t["audio_url"], dest)
    return RedirectResponse(t["audio_url"], status_code=307)


@router.get("/wbw/{path:path}")
async def wbw(path: str):
    if not _WBW.match(path):
        raise HTTPException(400, "مسار غير صالح")
    try:
        f = await audio_service.wbw_audio(path)
    except Exception as e:
        raise HTTPException(502, "تعذّر جلب صوت الكلمة") from e
    return FileResponse(f, media_type="audio/mpeg", headers=AUDIO_HEADERS)
