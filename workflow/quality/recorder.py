"""Record generation runs and quality scores to the Quality DB."""
from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

from workflow.quality.models import GenerationRun, QualityScore, QualitySummary
from workflow.quality.evaluator import (
    evaluate_uds, evaluate_sts, evaluate_suts,
    compute_overall_score, MetricList,
)

_logger = logging.getLogger("workflow.quality.recorder")


def record_run(
    doc_type: str,
    quality_data: Dict[str, Any],
    *,
    project_root: Optional[str] = None,
    target_function: Optional[str] = None,
    status: str = "success",
    elapsed_sec: Optional[float] = None,
    output_path: Optional[str] = None,
    ai_model: Optional[str] = None,
    error_msg: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
    db_path: Optional[Path] = None,
) -> int:
    """생성 실행 1회를 Quality DB에 기록.

    Returns:
        run_id (성공 시), -1 (실패 시 -- 예외 전파하지 않음)
    """
    try:
        return _record_run_impl(
            doc_type, quality_data,
            project_root=project_root, target_function=target_function,
            status=status, elapsed_sec=elapsed_sec,
            output_path=output_path, ai_model=ai_model,
            error_msg=error_msg, meta=meta, db_path=db_path,
        )
    except Exception:
        _logger.exception("Failed to record quality run (non-fatal)")
        return -1


def _record_run_impl(
    doc_type: str,
    quality_data: Dict[str, Any],
    **kwargs: Any,
) -> int:
    from workflow.quality.db import init_db, get_session

    db_path = kwargs.get("db_path")
    init_db(db_path)

    # 1. 평가
    doc_type = doc_type.lower().strip()
    if doc_type == "uds":
        metrics = evaluate_uds(quality_data)
    elif doc_type == "sts":
        metrics = evaluate_sts(quality_data)
    elif doc_type == "suts":
        metrics = evaluate_suts(quality_data)
    else:
        _logger.warning("Unknown doc_type: %s, skipping evaluation", doc_type)
        metrics = []

    overall = compute_overall_score(metrics)
    gate_pass = all(
        m.get("gate_pass", True)
        for m in metrics
        if m.get("gate_pass") is not None
    )

    # 2. DB 기록
    with get_session(db_path) as session:
        # output_size 계산
        output_size = None
        if kwargs.get("output_path"):
            try:
                output_size = Path(kwargs["output_path"]).stat().st_size
            except Exception:
                pass

        run = GenerationRun(
            run_uuid=str(uuid.uuid4()),
            doc_type=doc_type,
            project_root=kwargs.get("project_root"),
            target_function=kwargs.get("target_function"),
            status=kwargs.get("status", "success"),
            elapsed_sec=kwargs.get("elapsed_sec"),
            output_path=kwargs.get("output_path"),
            output_size_bytes=output_size,
            ai_model=kwargs.get("ai_model"),
            error_msg=kwargs.get("error_msg"),
            meta_json=(
                json.dumps(kwargs.get("meta") or {}, ensure_ascii=False)
                if kwargs.get("meta") else None
            ),
        )
        session.add(run)
        session.flush()  # run.id 확보

        # QualityScore
        for m in metrics:
            score = QualityScore(
                run_id=run.id,
                metric_name=m["metric_name"],
                value=m["value"],
                gate_pass=m.get("gate_pass"),
                threshold=m.get("threshold"),
            )
            session.add(score)

        # 직전 동일 doc_type run 조회 (delta 계산)
        prev_run = (
            session.query(GenerationRun)
            .filter(
                GenerationRun.doc_type == doc_type,
                GenerationRun.id != run.id,
            )
            .order_by(GenerationRun.created_at.desc())
            .first()
        )

        score_delta = None
        prev_run_id = None
        if prev_run and prev_run.summary:
            prev_run_id = prev_run.id
            score_delta = round(overall - prev_run.summary.overall_score, 2)

        # fn_count 추출
        fn_count = None
        if doc_type == "uds":
            qg = quality_data.get("quick_gate") or {}
            fn_count = int(qg.get("total_functions") or qg.get("fn_count") or 0)
        else:
            fn_count = int(quality_data.get("total_test_cases") or 0)

        summary = QualitySummary(
            run_id=run.id,
            overall_score=overall,
            gate_pass=gate_pass,
            score_delta=score_delta,
            prev_run_id=prev_run_id,
            fn_count=fn_count,
        )
        session.add(summary)

        _logger.info(
            "Quality recorded: doc_type=%s run_id=%d score=%.1f gate=%s delta=%s",
            doc_type, run.id, overall, gate_pass, score_delta,
        )
        return run.id
