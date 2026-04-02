"""MCP stdio server — exposes project MCP tools to Claude Code.

Run: python -m backend.mcp.stdio_server
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# Ensure project root is on sys.path
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from mcp.server.fastmcp import FastMCP

from backend.mcp import (
    get_code_search_mcp_server,
    get_docs_mcp_server,
    get_git_mcp_server,
    get_jenkins_mcp_server,
    get_report_mcp_server,
)

mcp = FastMCP("devops-release")

# ── Report tools ──────────────────────────────────────────────────────
_report = get_report_mcp_server()


@mcp.tool()
def report_summary(report_dir: str) -> str:
    """Get build/test report summary from a report directory."""
    return json.dumps(_report.call_tool("get_report_summary", report_dir=report_dir), ensure_ascii=False, default=str)


@mcp.tool()
def report_findings(report_dir: str) -> str:
    """Get findings (warnings, errors) from a report directory."""
    return json.dumps(_report.call_tool("get_findings", report_dir=report_dir), ensure_ascii=False, default=str)


@mcp.tool()
def report_coverage(report_dir: str) -> str:
    """Get code coverage data from a report directory."""
    return json.dumps(_report.call_tool("get_coverage", report_dir=report_dir), ensure_ascii=False, default=str)


@mcp.tool()
def report_log(report_dir: str, log_name: str = "system", max_bytes: int = 98304) -> str:
    """Read log excerpt from a report directory."""
    return json.dumps(_report.call_tool("get_log_excerpt", report_dir=report_dir, log_name=log_name, max_bytes=max_bytes), ensure_ascii=False, default=str)


# ── Git tools ─────────────────────────────────────────────────────────
_git = get_git_mcp_server()


@mcp.tool()
def git_status(project_root: str) -> str:
    """Get git status of the project."""
    return json.dumps(_git.call_tool("git_status", project_root=project_root), ensure_ascii=False, default=str)


@mcp.tool()
def git_diff(project_root: str, path: str = "") -> str:
    """Get git diff of the project."""
    return json.dumps(_git.call_tool("git_diff", project_root=project_root, path=path), ensure_ascii=False, default=str)


@mcp.tool()
def git_log(project_root: str, max_count: int = 30) -> str:
    """Get recent git log entries."""
    return json.dumps(_git.call_tool("git_log", project_root=project_root, max_count=max_count), ensure_ascii=False, default=str)


@mcp.tool()
def git_changed_files(project_root: str) -> str:
    """List files changed in the working tree."""
    return json.dumps(_git.call_tool("list_changed_files", project_root=project_root), ensure_ascii=False, default=str)


# ── Code search tools ────────────────────────────────────────────────
_code = get_code_search_mcp_server()


@mcp.tool()
def search_code(query: str, root: str = "", max_results: int = 20) -> str:
    """Search for code patterns in the source tree."""
    return json.dumps(_code.call_tool("search_code", query=query, root=root, max_results=max_results), ensure_ascii=False, default=str)


@mcp.tool()
def read_source_file(path: str, start_line: int = 0, end_line: int = 0) -> str:
    """Read a source file (optionally a specific line range)."""
    return json.dumps(_code.call_tool("read_file", path=path, start_line=start_line, end_line=end_line), ensure_ascii=False, default=str)


# ── Docs tools ────────────────────────────────────────────────────────
_docs = get_docs_mcp_server()


@mcp.tool()
def list_docs(query: str = "") -> str:
    """List available documentation files, optionally filtered by query."""
    return json.dumps(_docs.call_tool("list_docs", query=query), ensure_ascii=False, default=str)


@mcp.tool()
def search_docs(query: str) -> str:
    """Search documentation content."""
    return json.dumps(_docs.call_tool("search_docs", query=query), ensure_ascii=False, default=str)


@mcp.tool()
def read_doc(path: str) -> str:
    """Read a documentation file."""
    return json.dumps(_docs.call_tool("read_doc", path=path), ensure_ascii=False, default=str)


# ── Jenkins tools ─────────────────────────────────────────────────────
_jenkins = get_jenkins_mcp_server()


@mcp.tool()
def jenkins_build_summary(job_url: str, cache_root: str = ".devops_pro_cache", build_selector: str = "lastSuccessfulBuild") -> str:
    """Get Jenkins build report summary."""
    return json.dumps(_jenkins.call_tool("get_build_report_summary", job_url=job_url, cache_root=cache_root, build_selector=build_selector), ensure_ascii=False, default=str)


@mcp.tool()
def jenkins_build_status(job_url: str, cache_root: str = ".devops_pro_cache", build_selector: str = "lastSuccessfulBuild") -> str:
    """Get Jenkins build status."""
    return json.dumps(_jenkins.call_tool("get_build_report_status", job_url=job_url, cache_root=cache_root, build_selector=build_selector), ensure_ascii=False, default=str)


if __name__ == "__main__":
    mcp.run(transport="stdio")
