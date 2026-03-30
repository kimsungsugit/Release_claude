"""Lightweight user identification for multi-user internal deployment.

Not authentication — just identification via X-User header.
Uses contextvars so any code can call get_current_user() without
passing the user through every function signature.
"""
from __future__ import annotations

import contextvars
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

current_user: contextvars.ContextVar[str] = contextvars.ContextVar(
    "current_user", default="default"
)


class UserContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        user = (request.headers.get("X-User") or "default").strip() or "default"
        token = current_user.set(user)
        try:
            response = await call_next(request)
            return response
        finally:
            current_user.reset(token)


def get_current_user() -> str:
    """Return the current request's user identifier."""
    return current_user.get("default")


def wrap_with_user(fn):
    """Wrap a callable so it inherits the current user context.

    Use this when launching background threads from request handlers:
        t = threading.Thread(target=wrap_with_user(_run_sync), daemon=True)
    """
    user = get_current_user()

    def wrapper(*args, **kwargs):
        token = current_user.set(user)
        try:
            return fn(*args, **kwargs)
        finally:
            current_user.reset(token)

    return wrapper
