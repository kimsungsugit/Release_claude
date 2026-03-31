"""File resolver abstraction layer.

Provides a unified interface for file access with two modes:
  - LOCAL mode: direct filesystem access (default)
  - CLOUDIUM mode: same filesystem access but with Cloudium process permissions

Cloudium 동작 방식:
  1. Python 프로세스를 클라우디움에 권한 요청
  2. 승인되면 해당 프로세스에서 클라우디움 경로 (네트워크 드라이브 등)에 직접 접근 가능
  3. 파일 읽기는 로컬과 동일 (Path 객체로 접근)

설정:
    DEVOPS_FILE_MODE=local       (기본값)
    DEVOPS_FILE_MODE=cloudium

    CLOUDIUM_PERMISSION_TOOL=C:/path/to/cloudium_register.exe
    CLOUDIUM_BASE_PATH=//cloudium-server/workspace
"""
from __future__ import annotations

import os
import subprocess
import logging
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Dict, List, Optional

_logger = logging.getLogger("devops_api.file_resolver")


class FileResolver(ABC):
    """Abstract base for file access."""

    @abstractmethod
    def exists(self, path: str) -> bool: ...
    @abstractmethod
    def is_file(self, path: str) -> bool: ...
    @abstractmethod
    def is_dir(self, path: str) -> bool: ...
    @abstractmethod
    def read_bytes(self, path: str) -> bytes: ...
    @abstractmethod
    def read_text(self, path: str, encoding: str = "utf-8") -> str: ...
    @abstractmethod
    def list_dir(self, path: str, pattern: str = "*", recursive: bool = False) -> List[str]: ...
    @abstractmethod
    def resolve(self, path: str) -> str: ...

    @property
    @abstractmethod
    def mode(self) -> str: ...

    def get_config(self) -> Dict[str, Any]:
        return {"mode": self.mode}


class LocalFileResolver(FileResolver):
    """Direct local filesystem access."""

    def exists(self, path: str) -> bool:
        return Path(path).exists()

    def is_file(self, path: str) -> bool:
        return Path(path).is_file()

    def is_dir(self, path: str) -> bool:
        return Path(path).is_dir()

    def read_bytes(self, path: str) -> bytes:
        return Path(path).read_bytes()

    def read_text(self, path: str, encoding: str = "utf-8") -> str:
        return Path(path).read_text(encoding=encoding, errors="replace")

    def list_dir(self, path: str, pattern: str = "*", recursive: bool = False) -> List[str]:
        p = Path(path)
        if not p.is_dir():
            return []
        if recursive:
            return [str(f) for f in p.rglob(pattern) if f.is_file()]
        return [str(f) for f in p.glob(pattern) if f.is_file()]

    def resolve(self, path: str) -> str:
        return str(Path(path).resolve())

    @property
    def mode(self) -> str:
        return "local"


class CloudiumFileResolver(LocalFileResolver):
    """Cloudium mode: 클라우디움 권한 획득 후 클라우디움 경로만 허용.

    클라우디움 권한을 받으면 클라우디움 경로가 자동으로 접근 가능해짐.
    이 모드에서는 로컬 경로(C:/, D:/ 등) 접근을 차단하고
    클라우디움 경로(allowed_prefixes)만 허용.
    """

    def __init__(
        self,
        allowed_prefixes: str = "",
        **_kwargs,
    ):
        raw = allowed_prefixes or os.getenv("CLOUDIUM_ALLOWED_PREFIXES", "")
        self.allowed_prefixes = [p.strip() for p in raw.split(",") if p.strip()]

    def _check_allowed(self, path: str):
        """클라우디움 경로만 허용. 로컬 경로 차단."""
        if not self.allowed_prefixes:
            return  # 허용 목록 미설정이면 전부 허용 (설정 전 단계)
        resolved = str(Path(path).resolve()).replace("\\", "/")
        for prefix in self.allowed_prefixes:
            normalized = prefix.replace("\\", "/")
            if resolved.startswith(normalized) or resolved.startswith(normalized.lstrip("/")):
                return
        raise PermissionError(
            f"Cloudium 모드: 로컬 경로 접근 차단됨.\n"
            f"  요청 경로: {path}\n"
            f"  허용 경로: {', '.join(self.allowed_prefixes)}"
        )

    def exists(self, path: str) -> bool:
        self._check_allowed(path)
        return super().exists(path)

    def is_file(self, path: str) -> bool:
        self._check_allowed(path)
        return super().is_file(path)

    def is_dir(self, path: str) -> bool:
        self._check_allowed(path)
        return super().is_dir(path)

    def read_bytes(self, path: str) -> bytes:
        self._check_allowed(path)
        return super().read_bytes(path)

    def read_text(self, path: str, encoding: str = "utf-8") -> str:
        self._check_allowed(path)
        return super().read_text(path, encoding)

    def list_dir(self, path: str, pattern: str = "*", recursive: bool = False) -> List[str]:
        self._check_allowed(path)
        return super().list_dir(path, pattern, recursive)

    @property
    def mode(self) -> str:
        return "cloudium"

    def get_config(self) -> Dict[str, Any]:
        return {
            "mode": "cloudium",
            "allowed_prefixes": self.allowed_prefixes,
        }


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------
_resolver: Optional[FileResolver] = None


def get_resolver() -> FileResolver:
    global _resolver
    if _resolver is None:
        mode = os.getenv("DEVOPS_FILE_MODE", "local").strip().lower()
        if mode == "cloudium":
            _resolver = CloudiumFileResolver()
        else:
            _resolver = LocalFileResolver()
        _logger.info("File resolver: mode=%s", _resolver.mode)
    return _resolver


def set_resolver(resolver: FileResolver) -> None:
    global _resolver
    _resolver = resolver
    _logger.info("File resolver changed: mode=%s", resolver.mode)


def switch_mode(mode: str, **kwargs) -> FileResolver:
    """모드 전환."""
    if mode == "cloudium":
        resolver = CloudiumFileResolver(**{k: v for k, v in kwargs.items()
                                           if k in ('allowed_prefixes',)})
    else:
        resolver = LocalFileResolver()
    set_resolver(resolver)
    return resolver
