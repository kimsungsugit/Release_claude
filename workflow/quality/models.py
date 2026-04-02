"""SQLAlchemy ORM models for Quality DB."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import (
    Column, Float, Integer, String, Text, Boolean,
    DateTime, ForeignKey, Index,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class QualityBase(DeclarativeBase):
    pass


class GenerationRun(QualityBase):
    __tablename__ = "generation_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_uuid: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)
    doc_type: Mapped[str] = mapped_column(String(10), nullable=False)  # uds/sts/suts
    project_root: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    target_function: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="success")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc),
    )
    elapsed_sec: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    output_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    output_size_bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    ai_model: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    error_msg: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    meta_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON

    scores: Mapped[List["QualityScore"]] = relationship(
        back_populates="run", cascade="all, delete-orphan",
    )
    summary: Mapped[Optional["QualitySummary"]] = relationship(
        back_populates="run", uselist=False, cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_gen_run_doc_type", "doc_type"),
        Index("ix_gen_run_created", "created_at"),
        Index("ix_gen_run_project", "project_root"),
    )


class QualityScore(QualityBase):
    __tablename__ = "quality_scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("generation_runs.id"), nullable=False,
    )
    metric_name: Mapped[str] = mapped_column(String(50), nullable=False)
    value: Mapped[float] = mapped_column(Float, default=0.0)
    gate_pass: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    threshold: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    run: Mapped["GenerationRun"] = relationship(back_populates="scores")

    __table_args__ = (
        Index("ix_qs_run_id", "run_id"),
        Index("ix_qs_metric", "metric_name"),
    )


class QualitySummary(QualityBase):
    __tablename__ = "quality_summaries"

    run_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("generation_runs.id"), primary_key=True,
    )
    overall_score: Mapped[float] = mapped_column(Float, default=0.0)
    gate_pass: Mapped[bool] = mapped_column(Boolean, default=False)
    score_delta: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    prev_run_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    fn_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    run: Mapped["GenerationRun"] = relationship(back_populates="summary")
