"""Hybrid search engine for RAG Knowledge Base.

Combines keyword (FTS) and semantic (vector) search using
Reciprocal Rank Fusion (RRF).
"""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

_logger = logging.getLogger("workflow.rag.searcher")


def _get_config_float(name: str, default: float) -> float:
    try:
        import config
        return float(getattr(config, name, default))
    except Exception:
        return default


def _get_config_int(name: str, default: int) -> int:
    try:
        import config
        return int(getattr(config, name, default))
    except Exception:
        return default


# ==============================================================
# Keyword Search
# ==============================================================

def keyword_search(
    data: List[Dict[str, Any]],
    query: str,
    top_k: int = 20,
    *,
    categories: Optional[List[str]] = None,
    role: Optional[str] = None,
    stage: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """키워드 기반 검색 (in-memory).

    각 엔트리의 error_raw, error_clean, fix, context 필드에서
    쿼리 토큰 매칭 (BM25-like 단순 스코어링).

    Returns:
        score가 추가된 dict 리스트 (내림차순)
    """
    if not query or not data:
        return []

    # 쿼리 토큰화
    tokens = _tokenize(query)
    if not tokens:
        return []

    results: List[Dict[str, Any]] = []

    for idx, ent in enumerate(data):
        # 카테고리/역할/스테이지 필터
        if categories:
            ent_cat = str(ent.get("category") or "")
            if ent_cat not in categories:
                continue
        if role and ent.get("role") != role:
            continue
        if stage and ent.get("stage") != stage:
            continue

        # 검색 대상 텍스트 결합
        haystack = " ".join([
            str(ent.get("error_raw") or ""),
            str(ent.get("error_clean") or ""),
            str(ent.get("fix") or ""),
            str(ent.get("context") or ""),
        ]).lower()

        # 토큰 매칭 스코어
        score = 0.0
        matched_tokens = 0
        for token in tokens:
            count = haystack.count(token)
            if count > 0:
                matched_tokens += 1
                # BM25-inspired: diminishing returns for repeated matches
                score += min(count, 5) * (1.0 / (1.0 + 0.5 * count))

        if matched_tokens == 0:
            continue

        # 토큰 커버리지 보너스
        coverage = matched_tokens / len(tokens)
        score *= (0.5 + 0.5 * coverage)

        item = dict(ent)
        item["index"] = idx
        item["score"] = score
        item["_search_type"] = "keyword"
        results.append(item)

    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:top_k]


def _tokenize(text: str) -> List[str]:
    """쿼리 텍스트를 검색 토큰으로 분리."""
    text = text.lower().strip()
    # 특수문자 기준 분리, 2글자 이상만
    tokens = re.findall(r"[a-z0-9가-힣_]{2,}", text)
    # 중복 제거하되 순서 유지
    seen: set = set()
    unique: List[str] = []
    for t in tokens:
        if t not in seen:
            seen.add(t)
            unique.append(t)
    return unique


# ==============================================================
# Semantic Search
# ==============================================================

def semantic_search(
    data: List[Dict[str, Any]],
    query: str,
    top_k: int = 20,
    *,
    categories: Optional[List[str]] = None,
    role: Optional[str] = None,
    stage: Optional[str] = None,
    tags: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """벡터 유사도 기반 시맨틱 검색.

    기존 KnowledgeBase.search() 로직을 분리한 것.
    """
    if not query or not data:
        return []

    from workflow.rag.embedder import get_embedding, cosine_similarity

    q_vec = get_embedding(query)
    if not q_vec:
        return []

    norm_tags = [str(t) for t in (tags or []) if str(t).strip()]

    results: List[Dict[str, Any]] = []

    for idx, ent in enumerate(data):
        # 필터
        if categories:
            ent_cat = str(ent.get("category") or "")
            if ent_cat not in categories:
                continue
        if role and ent.get("role") != role:
            continue
        if stage and ent.get("stage") != stage:
            continue

        v = ent.get("vector") or []
        if not v:
            continue

        score = cosine_similarity(q_vec, v) * float(ent.get("weight", 1.0))

        # 태그 매칭 부스트
        if norm_tags:
            ent_tags = set(ent.get("tags") or [])
            hit = len(ent_tags.intersection(norm_tags))
            if hit:
                score += 0.05 * hit

        if score <= 0.0:
            continue

        item = dict(ent)
        item["index"] = idx
        item["score"] = score
        item["_search_type"] = "semantic"
        results.append(item)

    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:top_k]


# ==============================================================
# RRF (Reciprocal Rank Fusion)
# ==============================================================

def _rrf_merge(
    ranked_lists: List[List[Dict[str, Any]]],
    *,
    k: int = 60,
    top_k: int = 10,
) -> List[Dict[str, Any]]:
    """Reciprocal Rank Fusion으로 여러 랭킹 리스트 병합.

    score = sum( 1/(k + rank_i) ) for each list
    """
    scores: Dict[str, float] = {}
    items: Dict[str, Dict[str, Any]] = {}

    for ranked_list in ranked_lists:
        for rank, item in enumerate(ranked_list):
            item_id = str(item.get("id") or item.get("index", rank))
            rrf_score = 1.0 / (k + rank + 1)  # rank is 0-based, +1 for 1-based
            scores[item_id] = scores.get(item_id, 0.0) + rrf_score
            if item_id not in items:
                items[item_id] = item

    # 최종 스코어 할당
    merged = []
    for item_id, score in sorted(scores.items(), key=lambda x: x[1], reverse=True):
        item = dict(items[item_id])
        item["score"] = score
        item["_search_type"] = "hybrid"
        merged.append(item)

    return merged[:top_k]


# ==============================================================
# Boost (기존 부스팅 로직 통합)
# ==============================================================

def _apply_boosts(
    results: List[Dict[str, Any]],
    query: str,
    *,
    role: Optional[str] = None,
    stage: Optional[str] = None,
    req_ids: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """기존 부스팅 로직 적용 (role, stage, recency, project, exact match)."""
    project_boost = _get_config_float("RAG_PROJECT_BOOST", 0.0)
    recency_days = _get_config_float("RAG_RECENCY_DAYS", 0)
    recency_boost = _get_config_float("RAG_RECENCY_BOOST", 0.0)
    apply_boost = _get_config_float("RAG_APPLY_COUNT_BOOST", 0.0)
    error_boost = _get_config_float("RAG_ERROR_COUNT_BOOST", 0.0)
    exact_boost = _get_config_float("RAG_EXACT_MATCH_BOOST", 0.4)

    for item in results:
        score = float(item.get("score", 0.0))

        # Role/Stage boost
        if role and item.get("role") == role:
            score += 0.15
        if stage and item.get("stage") == stage:
            score += 0.1

        # Recency boost
        if recency_days > 0 and item.get("timestamp"):
            try:
                ts = datetime.fromisoformat(str(item["timestamp"]))
                delta_days = (datetime.utcnow() - ts).total_seconds() / 86400.0
                if delta_days < recency_days:
                    score += recency_boost * (1.0 - (delta_days / recency_days))
            except Exception:
                pass

        # Project boost
        if project_boost > 0 and item.get("project_root"):
            if str(item["project_root"]) in query:
                score += project_boost

        # Apply count boost
        if apply_boost > 0:
            score += apply_boost * float(item.get("apply_count", 0))

        # Error count boost
        if error_boost > 0:
            score += error_boost * float(item.get("error_count", 0))

        # Exact match (req_id)
        if req_ids:
            hay = " ".join([
                str(item.get("error_raw") or ""),
                str(item.get("error_clean") or ""),
                str(item.get("context") or ""),
                str(item.get("source_file") or ""),
                json.dumps(item.get("metadata") or {}, ensure_ascii=False),
            ])
            if any(rid in hay for rid in req_ids):
                score += exact_boost

        item["score"] = score

    results.sort(key=lambda x: x["score"], reverse=True)
    return results


# ==============================================================
# Hybrid Search (Public API)
# ==============================================================

def hybrid_search(
    data: List[Dict[str, Any]],
    query: str,
    top_k: int = 3,
    *,
    tags: Optional[List[str]] = None,
    role: Optional[str] = None,
    stage: Optional[str] = None,
    categories: Optional[List[str]] = None,
    alpha: Optional[float] = None,
) -> List[Dict[str, Any]]:
    """Hybrid 검색: keyword + semantic + RRF 병합.

    Args:
        data: KB 엔트리 리스트
        query: 검색 쿼리
        top_k: 반환할 결과 수
        tags: 태그 필터
        role: 역할 필터
        stage: 스테이지 필터
        categories: 카테고리 필터
        alpha: keyword/semantic 가중치 (0.0=keyword only, 1.0=semantic only, None=RRF)

    Returns:
        score 포함된 결과 리스트
    """
    if not query or not data:
        return []

    # alpha 결정
    if alpha is None:
        alpha = _get_config_float("RAG_HYBRID_ALPHA", 0.5)
    alpha = max(0.0, min(1.0, alpha))

    rrf_k = _get_config_int("RAG_RRF_K", 60)

    # 내부 검색에서 더 많은 후보 확보
    internal_top_k = max(top_k * 5, 20)

    from workflow.rag.chunker import _extract_req_ids_from_text
    req_ids = _extract_req_ids_from_text(query)

    if alpha == 0.0:
        # Keyword only
        results = keyword_search(data, query, internal_top_k,
                                 categories=categories, role=role, stage=stage)
    elif alpha == 1.0:
        # Semantic only
        results = semantic_search(data, query, internal_top_k,
                                  categories=categories, role=role, stage=stage, tags=tags)
    else:
        # Hybrid: RRF merge
        kw_results = keyword_search(data, query, internal_top_k,
                                    categories=categories, role=role, stage=stage)
        sem_results = semantic_search(data, query, internal_top_k,
                                     categories=categories, role=role, stage=stage, tags=tags)
        results = _rrf_merge([kw_results, sem_results], k=rrf_k, top_k=internal_top_k)

    # 부스팅 적용
    results = _apply_boosts(results, query, role=role, stage=stage, req_ids=req_ids)

    return results[:top_k]
