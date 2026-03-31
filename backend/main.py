"""DevOps Pro API -- FastAPI application entry point.

All endpoint logic lives in backend/routers/.
Shared helper functions live in backend/helpers/ package.

Deployment notes:
  Development : uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
  Production  : uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers 2

  With --workers > 1, in-memory progress state (backend/state.py) is NOT shared
  across worker processes. Long-running jobs (UDS/STS/SUTS) use generate-async +
  progress polling endpoints that run work in daemon threads, so a single worker
  is sufficient as long as these async endpoints are used instead of the sync ones.
"""
from __future__ import annotations

import json
import sys
import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

repo_root = Path(__file__).resolve().parents[1]
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

_api_logger = logging.getLogger("devops_api")
if not _api_logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("[%(asctime)s] %(levelname)s %(name)s: %(message)s", datefmt="%H:%M:%S"))
    _api_logger.addHandler(_h)
    _api_logger.setLevel(logging.INFO)

app = FastAPI(title="DevOps Pro API", version="1.0")


@app.on_event("startup")
async def _startup():
    import socket
    try:
        hostname = socket.gethostname()
        ip = socket.gethostbyname(hostname)
    except Exception:
        ip = "127.0.0.1"
    _api_logger.info("=" * 50)
    _api_logger.info("DevOps Release Server started")
    _api_logger.info("  Local:   http://127.0.0.1:8000")
    _api_logger.info("  Network: http://%s:8000", ip)
    _api_logger.info("=" * 50)

    # Log file access mode
    from backend.services.file_resolver import get_resolver
    resolver = get_resolver()
    _api_logger.info("  File mode: %s", resolver.mode)
    if resolver.mode == "cloudium":
        cfg = resolver.get_config()
        _api_logger.info("  Allowed paths: %s", cfg.get("allowed_prefixes", []))

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from backend.user_context import UserContextMiddleware  # noqa: E402
app.add_middleware(UserContextMiddleware)


@app.exception_handler(Exception)
async def _global_exception_handler(request: Request, exc: Exception):
    _api_logger.error("Unhandled %s on %s %s: %s",
                      type(exc).__name__, request.method, request.url.path, exc, exc_info=True)
    return HTMLResponse(
        content=json.dumps({"detail": f"Internal error: {type(exc).__name__}: {str(exc)[:300]}"}),
        status_code=500,
        media_type="application/json",
    )


@app.exception_handler(HTTPException)
async def _http_exception_handler(request: Request, exc: HTTPException):
    _api_logger.warning("HTTP %d on %s %s: %s", exc.status_code, request.method, request.url.path, exc.detail)
    return HTMLResponse(
        content=json.dumps({"detail": exc.detail}),
        status_code=exc.status_code,
        media_type="application/json",
    )


# ---------------------------------------------------------------------------
# Register modular routers
# ---------------------------------------------------------------------------
from backend.routers.health import router as _health_router  # noqa: E402
app.include_router(_health_router)

from backend.routers.chat import router as _chat_router  # noqa: E402
app.include_router(_chat_router)
from backend.routers.code import router as _code_router  # noqa: E402
app.include_router(_code_router)
from backend.routers.config import router as _config_router  # noqa: E402
app.include_router(_config_router)
from backend.routers.excel import router as _excel_router  # noqa: E402
app.include_router(_excel_router)
from backend.routers.exports import router as _exports_router  # noqa: E402
app.include_router(_exports_router)
from backend.routers.impact import router as _impact_router  # noqa: E402
app.include_router(_impact_router)
from backend.routers.profiles import router as _profiles_router  # noqa: E402
app.include_router(_profiles_router)
from backend.routers.qac import router as _qac_router  # noqa: E402
app.include_router(_qac_router)
from backend.routers.test_gen import router as _test_gen_router  # noqa: E402
app.include_router(_test_gen_router)
from backend.routers.vcast import router as _vcast_router  # noqa: E402
app.include_router(_vcast_router)
from backend.routers.jenkins import router as _jenkins_router  # noqa: E402
app.include_router(_jenkins_router)
from backend.routers.local import router as _local_router  # noqa: E402
app.include_router(_local_router)
from backend.routers.sessions import router as _sessions_router  # noqa: E402
app.include_router(_sessions_router)
from backend.routers.scm import router as _scm_router  # noqa: E402
app.include_router(_scm_router)

# ---------------------------------------------------------------------------
# Serve frontend-v2 production build (static files + SPA fallback)
# ---------------------------------------------------------------------------
_frontend_dist = repo_root / "frontend-v2" / "dist"
if (_frontend_dist / "index.html").exists():
    from fastapi.staticfiles import StaticFiles  # noqa: E402
    from fastapi.responses import FileResponse  # noqa: E402

    _assets_dir = _frontend_dist / "assets"
    if _assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(_assets_dir)), name="frontend_assets")

    # Serve favicon
    _favicon = _frontend_dist / "favicon.svg"
    if _favicon.exists():
        @app.get("/favicon.svg")
        async def _favicon_svg():
            return FileResponse(str(_favicon), media_type="image/svg+xml")

    # Explicit 404 for unmatched API routes (prevents SPA fallback masking)
    @app.get("/api/{api_path:path}")
    async def _api_not_found(api_path: str):
        raise HTTPException(status_code=404, detail=f"API endpoint not found: /api/{api_path}")

    # SPA catch-all: return index.html for any non-API unmatched route
    @app.get("/{full_path:path}")
    async def _spa_fallback(full_path: str):
        return FileResponse(str(_frontend_dist / "index.html"))

    _api_logger.info("Frontend-v2 production build served from %s", _frontend_dist)
else:
    _api_logger.warning("No frontend-v2 dist/ found at %s — run 'cd frontend-v2 && npm run build'", _frontend_dist)
