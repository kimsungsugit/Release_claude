# /app/backend/routers/health.py
"""Health-check endpoint."""

from __future__ import annotations

from fastapi import APIRouter

import config

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
async def health_check():
    from backend.services.file_resolver import get_resolver
    resolver = get_resolver()
    return {
        "status": "ok",
        "engine": getattr(config, "ENGINE_NAME", "DevOps Analyzer"),
        "version": getattr(config, "ENGINE_VERSION", "unknown"),
        "file_mode": resolver.mode,
    }


@router.get("/file-mode")
async def get_file_mode():
    from backend.services.file_resolver import get_resolver
    return get_resolver().get_config()


@router.post("/file-mode")
async def set_file_mode(body: dict):
    from backend.services.file_resolver import switch_mode
    mode = body.get("mode", "local")
    kwargs = {k: v for k, v in body.items() if k != "mode"}
    resolver = switch_mode(mode, **kwargs)
    return {"ok": True, **resolver.get_config()}


@router.post("/file-mode/check-access")
async def check_cloudium_access(body: dict = {}):
    """경로 접근 가능 여부 확인."""
    from backend.services.file_resolver import get_resolver
    resolver = get_resolver()
    test_path = body.get("path", "")
    if test_path:
        try:
            resolver._check_allowed(test_path) if hasattr(resolver, '_check_allowed') else None
            accessible = Path(test_path).exists()
            return {"ok": True, "accessible": accessible, "path": test_path, "mode": resolver.mode}
        except PermissionError as e:
            return {"ok": False, "accessible": False, "error": str(e), "mode": resolver.mode}
    return {"ok": True, "mode": resolver.mode, **resolver.get_config()}
