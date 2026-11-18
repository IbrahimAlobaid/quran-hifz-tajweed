import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.routers import api
from app.services.cache import close_client

settings = get_settings()
logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings.cache_dir.mkdir(parents=True, exist_ok=True)
    yield
    await close_client()


app = FastAPI(title="مُعين الحفظ — Quran Hifz Companion", version="1.0.0", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=2048)
app.include_router(api.router)
# The UI is served by the same process — open http://127.0.0.1:8000
app.mount("/", StaticFiles(directory=settings.frontend_dir, html=True), name="ui")
