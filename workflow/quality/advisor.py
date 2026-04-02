"""Quality advisor -- analyzes low scores and suggests improvements."""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

_logger = logging.getLogger("workflow.quality.advisor")

# 메트릭별 개선 제안 규칙
_UDS_ADVICE = {
    "called_pct": {
        "label": "Called Functions 커버리지",
        "low_advice": "콜 트리 분석 결과가 누락되었을 수 있습니다. include 경로를 확인하고, 외부 함수 매핑(CALL_TREE_EXTERNAL_MAP)을 추가하세요.",
        "threshold": 95.0,
    },
    "calling_pct": {
        "label": "Calling Functions 커버리지",
        "low_advice": "호출 관계가 불완전합니다. 소스 파일 glob 패턴(DEFAULT_TARGETS_GLOB)을 확장하거나, 헤더 파일 경로를 추가하세요.",
        "threshold": 95.0,
    },
    "description_pct": {
        "label": "함수 설명 완성도",
        "low_advice": "함수 설명이 부족합니다. 소스 코드에 Doxygen 주석을 추가하거나, SDS 문서 경로를 지정하여 AI가 참조하도록 하세요. ref_suds_path 설정을 확인하세요.",
        "threshold": 90.0,
    },
    "asil_pct": {
        "label": "ASIL 레벨 지정율",
        "low_advice": "ASIL 레벨이 TBD인 함수가 많습니다. SDS/SRS 문서에서 안전 요구사항을 매핑하거나, project_config에 기본 ASIL 레벨을 설정하세요.",
        "threshold": 50.0,
    },
    "related_pct": {
        "label": "요구사항 추적성",
        "low_advice": "SRS/SDS 요구사항 ID 연결이 부족합니다. req_docs_paths에 요구사항 문서를 추가하고, RAG KB에 요구사항을 ingest하세요.",
        "threshold": 70.0,
    },
    "input_pct": {
        "label": "입력 파라미터 완성도",
        "low_advice": "함수 입력 파라미터 정보가 누락되었습니다. 소스 코드의 함수 프로토타입이 정확한지 확인하세요.",
        "threshold": 90.0,
    },
    "output_pct": {
        "label": "출력 파라미터 완성도",
        "low_advice": "함수 출력/반환값 정보가 누락되었습니다. void 함수의 포인터 출력 파라미터를 확인하세요.",
        "threshold": 90.0,
    },
}

_STS_ADVICE = {
    "completeness_pct": {
        "label": "테스트 케이스 완성도",
        "low_advice": "테스트 스텝이 2개 미만인 TC가 많습니다. AI 향상(ai_config.enable=true)을 활성화하거나, SDS 문서를 제공하여 더 상세한 스텝을 생성하세요.",
        "threshold": 80.0,
    },
    "requirement_coverage_pct": {
        "label": "요구사항 커버리지",
        "low_advice": "요구사항 ID와 연결되지 않은 TC가 많습니다. SRS 문서 경로(srs_docx_path)를 지정하고, 요구사항 매핑 규칙을 확인하세요.",
        "threshold": 70.0,
    },
    "method_diversity_pct": {
        "label": "테스트 방법 다양성",
        "low_advice": "테스트 방법이 단조롭습니다(Boundary/Normal만 사용). Error Guessing, Stress, State Transition 등 다양한 방법론을 포함하도록 AI 프롬프트를 조정하세요.",
        "threshold": 60.0,
    },
    "safety_tc_pct": {
        "label": "안전 관련 TC 비율",
        "low_advice": "안전 관련(safety_related=X) TC가 부족합니다. ASIL 레벨이 지정된 함수에 대해 안전 TC를 추가 생성하세요.",
        "threshold": 10.0,
    },
}

_SUTS_ADVICE = {
    "function_coverage_pct": {
        "label": "함수 커버리지",
        "low_advice": "소스 코드 함수 대비 TC 수가 부족합니다. target_function_names 필터를 제거하거나, 소스 파싱 범위를 확장하세요.",
        "threshold": 80.0,
    },
    "io_coverage_pct": {
        "label": "I/O 커버리지",
        "low_advice": "입출력 변수가 없는 TC가 많습니다. 글로벌 변수 맵(globals_info_map)이 올바르게 파싱되었는지 확인하고, 소스의 extern 선언을 점검하세요.",
        "threshold": 70.0,
    },
    "sequence_fidelity_pct": {
        "label": "시퀀스 충실도",
        "low_advice": "TC당 시퀀스 수가 적습니다. max_sequences 파라미터를 늘리거나, AI 향상을 활성화하세요.",
        "threshold": 50.0,
    },
    "logic_flow_pct": {
        "label": "로직 플로우 보유율",
        "low_advice": "로직 플로우(if/switch/loop)가 추출되지 않은 함수가 많습니다. 소스 코드가 복잡도가 낮은 단순 함수일 수 있으며, 이 경우 정상입니다.",
        "threshold": 40.0,
    },
}


def suggest_improvements(
    run_id: int,
    *,
    db_path=None,
) -> Dict[str, Any]:
    """특정 실행의 품질 점수를 분석하여 개선 제안을 반환.

    Returns:
        {
            "run_id": int,
            "doc_type": str,
            "overall_score": float,
            "gate_pass": bool,
            "suggestions": [
                {"metric": str, "label": str, "value": float, "threshold": float, "advice": str, "priority": str}
            ],
            "summary": str,
        }
    """
    from workflow.quality.db import init_db, get_session
    from workflow.quality.models import GenerationRun, QualityScore, QualitySummary

    init_db(db_path)

    with get_session(db_path) as session:
        run = session.query(GenerationRun).filter_by(id=run_id).first()
        if not run:
            return {"error": f"run_id {run_id} not found"}

        scores = {s.metric_name: s for s in (run.scores or [])}
        summary = run.summary
        doc_type = run.doc_type

        # 메트릭별 advice 규칙 선택
        if doc_type == "uds":
            advice_rules = _UDS_ADVICE
        elif doc_type == "sts":
            advice_rules = _STS_ADVICE
        elif doc_type == "suts":
            advice_rules = _SUTS_ADVICE
        else:
            advice_rules = {}

        suggestions: List[Dict[str, Any]] = []
        for metric_name, rule in advice_rules.items():
            score_obj = scores.get(metric_name)
            if not score_obj:
                continue

            value = score_obj.value
            threshold = rule["threshold"]

            if value < threshold:
                gap = threshold - value
                if gap > 30:
                    priority = "high"
                elif gap > 10:
                    priority = "medium"
                else:
                    priority = "low"

                suggestions.append({
                    "metric": metric_name,
                    "label": rule["label"],
                    "value": round(value, 1),
                    "threshold": threshold,
                    "gap": round(gap, 1),
                    "advice": rule["low_advice"],
                    "priority": priority,
                })

        # 우선순위 정렬 (high > medium > low, gap 큰 순)
        priority_order = {"high": 0, "medium": 1, "low": 2}
        suggestions.sort(key=lambda x: (priority_order.get(x["priority"], 9), -x["gap"]))

        # 요약 메시지
        overall = summary.overall_score if summary else 0.0
        gate = summary.gate_pass if summary else False
        high_count = sum(1 for s in suggestions if s["priority"] == "high")

        if not suggestions:
            summary_text = f"품질 점수 {overall:.1f}/100 -- 모든 항목이 임계값을 통과했습니다."
        elif gate:
            summary_text = f"품질 점수 {overall:.1f}/100 -- 게이트 통과. {len(suggestions)}개 항목 개선 가능."
        else:
            summary_text = f"품질 점수 {overall:.1f}/100 -- 게이트 미통과. {high_count}개 긴급 개선 필요."

        return {
            "run_id": run_id,
            "doc_type": doc_type,
            "overall_score": overall,
            "gate_pass": gate,
            "suggestions": suggestions,
            "suggestion_count": len(suggestions),
            "summary": summary_text,
        }
