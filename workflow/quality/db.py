"""Database engine and session factory for Quality DB (quality.sqlite)."""
from __future__ import annotations

import logging
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Optional, Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from workflow.quality.models import QualityBase

_logger = logging.getLogger("workflow.quality.db")

# 모듈 레벨 싱글톤
_engine = None
_SessionLocal = None
_lock = threading.Lock()
_QUALITY_DB_FILENAME = "quality.sqlite"


def _default_db_path() -> Path:
    """config.DEFAULT_REPORT_DIR 기반 기본 DB 경로 반환."""
    try:
        import config
        report_dir = getattr(config, "DEFAULT_REPORT_DIR", "reports")
        return Path(report_dir) / _QUALITY_DB_FILENAME
    except Exception:
        return Path("reports") / _QUALITY_DB_FILENAME


def get_engine(db_path: Optional[Path] = None, *, force_new: bool = False):
    """SQLAlchemy 엔진 반환 (싱글톤, thread-safe)."""
    global _engine
    if _engine is not None and not force_new:
        return _engine

    with _lock:
        if _engine is not None and not force_new:
            return _engine

        if db_path is None:
            db_path = _default_db_path()
        db_path.parent.mkdir(parents=True, exist_ok=True)

        url = f"sqlite:///{db_path}"
        _engine = create_engine(url, echo=False)

        @event.listens_for(_engine, "connect")
        def _set_sqlite_pragma(dbapi_conn, connection_record):
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.close()

        _logger.info("Quality DB engine: %s", db_path)
        return _engine


def get_session_factory(db_path: Optional[Path] = None):
    """SessionLocal 팩토리 반환."""
    global _SessionLocal
    if _SessionLocal is None:
        engine = get_engine(db_path)
        _SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
    return _SessionLocal


def init_db(db_path: Optional[Path] = None) -> None:
    """테이블 생성 (없으면 CREATE)."""
    engine = get_engine(db_path)
    QualityBase.metadata.create_all(engine, checkfirst=True)
    _logger.info("Quality DB tables initialized")


@contextmanager
def get_session(db_path: Optional[Path] = None) -> Generator[Session, None, None]:
    """세션 컨텍스트 매니저."""
    factory = get_session_factory(db_path)
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def reset_engine() -> None:
    """테스트용: 엔진/세션 초기화."""
    global _engine, _SessionLocal
    with _lock:
        if _engine is not None:
            _engine.dispose()
        _engine = None
        _SessionLocal = None
