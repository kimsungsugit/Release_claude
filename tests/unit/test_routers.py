"""Unit tests for backend routers (health, exports, code, config).

Uses starlette TestClient to exercise FastAPI endpoints without a running server.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import types
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from starlette.testclient import TestClient

# Ensure repo root is on sys.path so backend/config can be imported
_repo_root = Path(__file__).resolve().parents[2]
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

# Stub optional dependencies that may not be installed in the test environment
# so that importing backend.main does not fail.
for _mod_name in [
    "langchain_core",
    "langchain_core.tools",
    "langchain_mcp_adapters",
    "langchain_mcp_adapters.tools",
    "mcp",
    "mcp.client",
    "mcp.client.stdio",
]:
    if _mod_name not in sys.modules:
        _stub = types.ModuleType(_mod_name)
        # Provide minimal class stubs that routers may reference at import time
        _stub.BaseTool = MagicMock       # type: ignore[attr-defined]
        _stub.StructuredTool = MagicMock  # type: ignore[attr-defined]
        sys.modules[_mod_name] = _stub

from backend.main import app  # noqa: E402

client = TestClient(app, raise_server_exceptions=False)


# ═══════════════════════════════════════════════════════════════════
# Health Router
# ═══════════════════════════════════════════════════════════════════
class TestHealthRouter:
    """Tests for /api/health and related health endpoints."""

    def test_health_check_status_200(self):
        r = client.get("/api/health")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "ok"

    def test_health_check_has_version(self):
        r = client.get("/api/health")
        data = r.json()
        assert "version" in data
        assert isinstance(data["version"], str)

    def test_health_check_has_engine(self):
        r = client.get("/api/health")
        data = r.json()
        assert "engine" in data
        assert isinstance(data["engine"], str)

    def test_health_check_has_file_mode(self):
        r = client.get("/api/health")
        data = r.json()
        assert "file_mode" in data
        assert data["file_mode"] in ("local", "cloudium")

    def test_file_mode_get(self):
        r = client.get("/api/file-mode")
        assert r.status_code == 200
        data = r.json()
        assert "mode" in data

    def test_preview_excel_missing_path(self):
        """POST /api/preview-excel with empty path returns 400."""
        r = client.post("/api/preview-excel", json={"path": ""})
        assert r.status_code == 400

    def test_preview_excel_nonexistent_file(self):
        """POST /api/preview-excel with nonexistent file returns 404."""
        r = client.post(
            "/api/preview-excel",
            json={"path": "/nonexistent/path/file.xlsx"},
        )
        assert r.status_code == 404

    def test_preview_excel_unsupported_format(self):
        """POST /api/preview-excel with unsupported extension returns 400."""
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(b"dummy")
            tmp_path = f.name
        try:
            r = client.post("/api/preview-excel", json={"path": tmp_path})
            assert r.status_code == 400
        finally:
            os.unlink(tmp_path)

    def test_preview_excel_txt_file(self):
        """POST /api/preview-excel with a .txt file returns content."""
        with tempfile.NamedTemporaryFile(
            suffix=".txt", delete=False, mode="w", encoding="utf-8"
        ) as f:
            f.write("line1\nline2\nline3\n")
            tmp_path = f.name
        try:
            r = client.post("/api/preview-excel", json={"path": tmp_path})
            assert r.status_code == 200
            data = r.json()
            assert data["ok"] is True
            assert len(data["sheets"]) == 1
            assert data["sheets"][0]["name"] == "Content"
            assert len(data["sheets"][0]["rows"]) == 3
        finally:
            os.unlink(tmp_path)

    def test_preview_image_nonexistent(self):
        """GET /api/preview-image with nonexistent docx returns 404."""
        r = client.get(
            "/api/preview-image",
            params={"path": "/nonexistent/doc.docx", "image_id": "rId1"},
        )
        assert r.status_code == 404

    def test_check_access_no_body(self):
        """POST /api/file-mode/check-access with empty body returns ok."""
        r = client.post("/api/file-mode/check-access", json={})
        assert r.status_code == 200
        data = r.json()
        assert "mode" in data

    def test_check_access_with_nonexistent_path(self):
        """POST /api/file-mode/check-access with nonexistent path."""
        r = client.post(
            "/api/file-mode/check-access",
            json={"path": "/nonexistent/test/path"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("accessible") is False


# ═══════════════════════════════════════════════════════════════════
# Exports Router
# ═══════════════════════════════════════════════════════════════════
class TestExportsRouter:
    """Tests for /api/exports endpoints."""

    def test_list_exports_returns_list(self):
        """GET /api/exports returns a JSON list."""
        r = client.get("/api/exports")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)

    def test_list_exports_with_nonexistent_base(self):
        """GET /api/exports with a nonexistent base dir returns empty or error."""
        r = client.get("/api/exports", params={"base": "/nonexistent/base/dir"})
        # Server may return 200 (empty list), 400, or 403 (forbidden path)
        assert r.status_code in (200, 400, 403)

    def test_list_exports_with_session_filter(self):
        """GET /api/exports with session_id filter still returns a list."""
        r = client.get(
            "/api/exports",
            params={"session_id": "nonexistent_session_xyz"},
        )
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_delete_export_nonexistent(self):
        """DELETE /api/exports/<filename> with nonexistent file returns 404."""
        r = client.delete("/api/exports/nonexistent_file.zip")
        assert r.status_code == 404

    def test_restore_export_nonexistent(self):
        """POST /api/exports/restore/<filename> with nonexistent returns 404."""
        r = client.post("/api/exports/restore/nonexistent_file.zip")
        assert r.status_code == 404

    def test_download_export_nonexistent(self):
        """GET /api/exports/download/<filename> with nonexistent returns 404."""
        r = client.get("/api/exports/download/nonexistent_file.zip")
        assert r.status_code == 404

    def test_pdf_convert_nonexistent_source(self):
        """POST /api/exports/pdf/convert with nonexistent file returns error."""
        r = client.post(
            "/api/exports/pdf/convert",
            json={"source_path": "/nonexistent/file.docx"},
        )
        # Should get 404 (FileNotFoundError) or 500
        assert r.status_code in (404, 500)

    def test_pdf_convert_unsupported_extension(self):
        """POST /api/exports/pdf/convert with unsupported ext returns error."""
        with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as f:
            f.write(b"dummy")
            tmp_path = f.name
        try:
            r = client.post(
                "/api/exports/pdf/convert",
                json={"source_path": tmp_path},
            )
            # 400 (HTTPException) or 500 (APIError caught by generic handler)
            assert r.status_code in (400, 500)
        finally:
            os.unlink(tmp_path)

    def test_pdf_convert_missing_source_path(self):
        """POST /api/exports/pdf/convert without source_path returns 422."""
        r = client.post("/api/exports/pdf/convert", json={})
        assert r.status_code == 422

    def test_pdf_report_missing_fields(self):
        """POST /api/exports/pdf/report without required fields returns 422."""
        r = client.post("/api/exports/pdf/report", json={})
        assert r.status_code == 422

    def test_pdf_report_with_sections(self):
        """POST /api/exports/pdf/report with temp output path generates PDF."""
        with tempfile.TemporaryDirectory() as tmpdir:
            out_path = str(Path(tmpdir) / "test_report.pdf")
            r = client.post(
                "/api/exports/pdf/report",
                json={
                    "title": "Test Report",
                    "sections": [
                        {"heading": "Section 1", "content": "Hello world"},
                        {"heading": "Section 2", "content": "Test content"},
                    ],
                    "output_path": out_path,
                },
            )
            # Might succeed (200) or fail (500) depending on PDF libs installed
            if r.status_code == 200:
                data = r.json()
                assert data["ok"] is True
                assert "pdf_path" in data
                assert "size_mb" in data
            else:
                # PDF generation library may not be available in test env
                assert r.status_code == 500

    def test_cleanup_exports_returns_deleted_count(self):
        """POST /api/exports/cleanup returns deleted count."""
        r = client.post("/api/exports/cleanup", params={"days": 1})
        assert r.status_code == 200
        data = r.json()
        assert "deleted" in data
        assert isinstance(data["deleted"], int)


# ═══════════════════════════════════════════════════════════════════
# Code Router
# ═══════════════════════════════════════════════════════════════════
class TestCodeRouter:
    """Tests for /api/code endpoints."""

    def test_preview_function_missing_params(self):
        """GET /api/code/preview/function without required params returns 422."""
        r = client.get("/api/code/preview/function")
        assert r.status_code == 422

    def test_preview_function_missing_function_name(self):
        """GET /api/code/preview/function without function_name returns 422."""
        r = client.get(
            "/api/code/preview/function",
            params={"source_root": "/some/path"},
        )
        assert r.status_code == 422

    def test_preview_function_empty_function_name(self):
        """GET /api/code/preview/function with empty function_name returns 400."""
        r = client.get(
            "/api/code/preview/function",
            params={"source_root": "/some/path", "function_name": ""},
        )
        assert r.status_code == 400

    def test_call_graph_missing_source_root(self):
        """GET /api/code/call-graph without source_root returns 422."""
        r = client.get("/api/code/call-graph")
        assert r.status_code == 422

    def test_call_graph_invalid_depth(self):
        """GET /api/code/call-graph with depth out of range returns 422."""
        r = client.get(
            "/api/code/call-graph",
            params={"source_root": "/tmp", "depth": 99},
        )
        assert r.status_code == 422

    def test_call_graph_nonexistent_source(self):
        """GET /api/code/call-graph with nonexistent source_root returns error."""
        r = client.get(
            "/api/code/call-graph",
            params={"source_root": "/nonexistent/src/root"},
        )
        # May return 200 (empty graph), 400 (bad path), or 500
        assert r.status_code in (200, 400, 500)

    def test_dependency_map_missing_source_root(self):
        """GET /api/code/dependency-map without source_root returns 422."""
        r = client.get("/api/code/dependency-map")
        assert r.status_code == 422

    def test_globals_missing_source_root(self):
        """GET /api/code/globals without source_root returns 422."""
        r = client.get("/api/code/globals")
        assert r.status_code == 422

    def test_globals_nonexistent_source(self):
        """GET /api/code/globals with nonexistent source returns error."""
        r = client.get(
            "/api/code/globals",
            params={"source_root": "/nonexistent/code/root"},
        )
        # Returns 200 (empty globals), 400 (bad path), or 500
        assert r.status_code in (200, 400, 500)

    def test_call_graph_max_files_boundaries(self):
        """GET /api/code/call-graph validates max_files range."""
        # Below minimum
        r = client.get(
            "/api/code/call-graph",
            params={"source_root": "/tmp", "max_files": 50},
        )
        assert r.status_code == 422

        # Above maximum
        r = client.get(
            "/api/code/call-graph",
            params={"source_root": "/tmp", "max_files": 9999},
        )
        assert r.status_code == 422


# ═══════════════════════════════════════════════════════════════════
# Config Router
# ═══════════════════════════════════════════════════════════════════
class TestConfigRouter:
    """Tests for /api/config endpoints."""

    def test_config_defaults_returns_200(self):
        """GET /api/config/defaults returns config data."""
        r = client.get("/api/config/defaults")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, dict)

    def test_config_defaults_has_required_keys(self):
        """Config defaults contains essential configuration fields."""
        r = client.get("/api/config/defaults")
        data = r.json()
        required_keys = [
            "project_root",
            "report_dir",
            "targets_glob",
            "include_paths",
            "quality_preset",
            "do_build",
            "do_coverage",
        ]
        for key in required_keys:
            assert key in data, f"Missing config key: {key}"

    def test_config_defaults_types(self):
        """Config defaults values have correct types."""
        r = client.get("/api/config/defaults")
        data = r.json()
        assert isinstance(data["project_root"], str)
        assert isinstance(data["report_dir"], str)
        assert isinstance(data["include_paths"], list)
        assert isinstance(data["do_build"], bool)
        assert isinstance(data["do_coverage"], bool)
        assert isinstance(data["quality_preset"], str)

    def test_config_options_returns_200(self):
        """GET /api/config/options returns options data."""
        r = client.get("/api/config/options")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, dict)

    def test_config_options_has_presets(self):
        """Config options includes quality presets."""
        r = client.get("/api/config/options")
        data = r.json()
        assert "quality_presets" in data
        assert isinstance(data["quality_presets"], list)
        assert len(data["quality_presets"]) > 0

    def test_config_options_has_strategy(self):
        """Config options includes build strategy and fallback options."""
        r = client.get("/api/config/options")
        data = r.json()
        assert "build_strategy_options" in data
        assert "build_fallback_options" in data


# ═══════════════════════════════════════════════════════════════════
# General API behavior
# ═══════════════════════════════════════════════════════════════════
class TestGeneralAPI:
    """Tests for cross-cutting API behavior."""

    def test_nonexistent_api_route(self):
        """Unmatched /api/* route returns 404."""
        r = client.get("/api/this-endpoint-does-not-exist")
        assert r.status_code == 404

    def test_cors_headers_present(self):
        """CORS middleware adds Access-Control-Allow-Origin header."""
        r = client.get(
            "/api/health",
            headers={"Origin": "http://localhost:3000"},
        )
        assert r.status_code == 200
        assert "access-control-allow-origin" in r.headers

    def test_options_preflight(self):
        """OPTIONS preflight request is handled by CORS middleware."""
        r = client.options(
            "/api/health",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert r.status_code == 200
        assert "access-control-allow-origin" in r.headers
