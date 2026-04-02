"""Quality evaluators for UDS, STS, SUTS documents."""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

_logger = logging.getLogger("workflow.quality.evaluator")

MetricResult = Dict[str, Any]  # {"metric_name": str, "value": float, "gate_pass": bool|None, "threshold": float|None}
MetricList = List[MetricResult]


def _metric(name: str, value: float, *, threshold: Optional[float] = None) -> MetricResult:
    """단일 메트릭 dict 생성."""
    gate_pass = None
    if threshold is not None:
        gate_pass = value >= threshold
    return {
        "metric_name": name,
        "value": round(value, 2),
        "gate_pass": gate_pass,
        "threshold": threshold,
    }


def _safe_float(d: Any, key: str, default: float = 0.0) -> float:
    """dict에서 안전하게 float 추출."""
    if not isinstance(d, dict):
        return default
    v = d.get(key)
    if v is None:
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def evaluate_uds(quality_eval: Dict[str, Any]) -> MetricList:
    """_build_quality_evaluation() 반환 dict -> MetricList.

    Args:
        quality_eval: UDS 품질 평가 dict. quick_gate.fields, accuracy 등 포함.
    """
    metrics: MetricList = []

    try:
        import config
        thresholds = getattr(config, "UDS_QUALITY_GATE_THRESHOLDS", {})
    except Exception:
        thresholds = {}

    quick_gate = quality_eval.get("quick_gate") or {}
    fields = quick_gate.get("fields") or {}

    # 필드별 메트릭 추출
    field_mappings = [
        ("called_pct", "called_min"),
        ("calling_pct", "calling_min"),
        ("input_pct", "input_min"),
        ("output_pct", "output_min"),
        ("global_pct", "global_min"),
        ("static_pct", "static_min"),
        ("description_pct", "description_min"),
        ("asil_pct", "asil_min"),
        ("related_pct", "related_min"),
    ]

    for field_name, threshold_key in field_mappings:
        val = _safe_float(fields, field_name)
        thresh = thresholds.get(threshold_key)
        metrics.append(_metric(field_name, val, threshold=thresh))

    # Accuracy 메트릭
    accuracy = quality_eval.get("accuracy") or {}
    for acc_key in ["called_pct", "calling_pct"]:
        acc_val = _safe_float(accuracy, acc_key)
        if acc_val > 0:
            metrics.append(_metric(f"accuracy_{acc_key}", acc_val))

    # Gate pass 메트릭
    metrics.append(
        _metric("gate_pass", 100.0 if quality_eval.get("gate_pass") else 0.0),
    )
    metrics.append(
        _metric("confidence_gate_pass", 100.0 if quality_eval.get("confidence_gate_pass") else 0.0),
    )

    return metrics


def evaluate_sts(quality_report: Dict[str, Any]) -> MetricList:
    """generators/sts.py generate_quality_report() 반환 dict -> MetricList.

    Args:
        quality_report: STS 품질 리포트 dict.
    """
    metrics: MetricList = []

    total = _safe_float(quality_report, "total_test_cases")

    # 완성도
    metrics.append(
        _metric("completeness_pct", _safe_float(quality_report, "completeness_pct"), threshold=80.0),
    )

    # 안전 TC 비율
    safety = _safe_float(quality_report, "safety_test_cases")
    safety_pct = round(safety / max(total, 1) * 100, 2)
    metrics.append(_metric("safety_tc_pct", safety_pct))

    # 요구사항 커버리지
    req_cov = quality_report.get("requirement_coverage") or {}
    cov_pct = _safe_float(req_cov, "covered_pct", default=_safe_float(req_cov, "pct"))
    metrics.append(_metric("requirement_coverage_pct", cov_pct, threshold=70.0))

    # 테스트 방법 다양성 (종류 수 / 5, 상한 100%)
    methods = quality_report.get("test_method_distribution") or {}
    method_count = len([k for k in methods if k != "?"])
    diversity_pct = round(min(method_count / 5.0, 1.0) * 100, 2)
    metrics.append(_metric("method_diversity_pct", diversity_pct))

    # 총 TC 수 (참고용)
    metrics.append(_metric("total_test_cases", total))

    return metrics


def evaluate_suts(quality_report: Dict[str, Any]) -> MetricList:
    """generators/suts.py generate_suts_quality_report() 반환 dict -> MetricList.

    Args:
        quality_report: SUTS 품질 리포트 dict.
    """
    metrics: MetricList = []

    total = _safe_float(quality_report, "total_test_cases")

    # 함수 커버리지
    metrics.append(
        _metric("function_coverage_pct", _safe_float(quality_report, "function_coverage_pct"), threshold=80.0),
    )

    # I/O 커버리지
    metrics.append(
        _metric("io_coverage_pct", _safe_float(quality_report, "io_coverage_pct"), threshold=70.0),
    )

    # 시퀀스 충실도 (avg/6 상한 100%)
    avg_seq = _safe_float(quality_report, "avg_sequences_per_tc")
    seq_fidelity = round(min(avg_seq / 6.0, 1.0) * 100, 2)
    metrics.append(_metric("sequence_fidelity_pct", seq_fidelity))

    # 로직 플로우 보유율
    with_logic = _safe_float(quality_report, "with_logic_count")
    logic_pct = round(with_logic / max(total, 1) * 100, 2)
    metrics.append(_metric("logic_flow_pct", logic_pct))

    # 총 TC / 시퀀스 수 (참고용)
    metrics.append(_metric("total_test_cases", total))
    metrics.append(_metric("total_sequences", _safe_float(quality_report, "total_sequences")))

    return metrics


def compute_overall_score(metrics: MetricList) -> float:
    """MetricList -> 종합 점수 (0~100).

    gate_pass가 있는 메트릭만 점수 계산에 포함.
    gate_pass=False 항목은 0.5x 페널티.
    """
    scored = [m for m in metrics if m.get("threshold") is not None]
    if not scored:
        # threshold가 없으면 _pct 메트릭의 value 평균
        vals = [m["value"] for m in metrics if m.get("metric_name", "").endswith("_pct")]
        return round(sum(vals) / max(len(vals), 1), 2)

    total = 0.0
    count = 0
    for m in scored:
        val = float(m.get("value", 0))
        if not m.get("gate_pass"):
            val *= 0.5  # 페널티
        total += val
        count += 1

    return round(total / max(count, 1), 2)
