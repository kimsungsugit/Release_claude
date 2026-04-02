"""표준 에러 응답 및 핸들링

모든 API 엔드포인트에서 일관된 에러 형식을 제공합니다.
"""
from __future__ import annotations

import logging
import traceback
from typing import Any, Dict, Optional

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger("devops_api")


class APIError(HTTPException):
    """Structured API error with consistent format."""
    def __init__(
        self,
        status_code: int = 500,
        message: str = "Internal server error",
        code: str = "INTERNAL_ERROR",
        detail: Optional[Dict[str, Any]] = None,
    ):
        self.code = code
        self.message = message
        self.error_detail = detail or {}
        super().__init__(status_code=status_code, detail=message)


def error_response(
    status_code: int,
    message: str,
    code: str = "ERROR",
    detail: Optional[Dict[str, Any]] = None,
) -> JSONResponse:
    """Create standardized error response."""
    return JSONResponse(
        status_code=status_code,
        content={
            "ok": False,
            "error": {
                "code": code,
                "message": message,
                **({"detail": detail} if detail else {}),
            },
        },
    )


def success_response(data: Any = None, message: str = "ok") -> Dict[str, Any]:
    """Create standardized success response."""
    response = {"ok": True}
    if data is not None:
        response["data"] = data
    return response


def handle_exception(exc: Exception, context: str = "") -> JSONResponse:
    """Handle unexpected exceptions with logging."""
    tb = traceback.format_exc()
    logger.error("[%s] Unhandled exception: %s\n%s", context, exc, tb)
    return error_response(
        500,
        f"서버 내부 오류: {str(exc)[:200]}",
        code="INTERNAL_ERROR",
    )


async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """FastAPI global exception handler."""
    return handle_exception(exc, context=f"{request.method} {request.url.path}")


async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """FastAPI HTTP exception handler with consistent format."""
    return error_response(
        exc.status_code,
        str(exc.detail),
        code=f"HTTP_{exc.status_code}",
    )
