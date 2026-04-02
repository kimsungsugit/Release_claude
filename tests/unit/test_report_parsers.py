"""Report Parser 단위 테스트"""
from pathlib import Path
import pytest

from backend.services.report_parsers import (
    _clean_text,
    _parse_number,
    parse_html_report,
    read_text_safe,
)

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


class TestCleanText:
    def test_basic(self):
        assert _clean_text("  hello   world  ") == "hello world"

    def test_none(self):
        assert _clean_text(None) == ""

    def test_newlines(self):
        assert _clean_text("a\n  b\n  c") == "a b c"


class TestParseNumber:
    def test_integer(self):
        assert _parse_number("42") == 42.0

    def test_float(self):
        assert _parse_number("3.14") == 3.14

    def test_percentage(self):
        assert _parse_number("85%") == 85.0

    def test_comma(self):
        assert _parse_number("1,234") == 1234.0

    def test_none(self):
        assert _parse_number(None) is None

    def test_invalid(self):
        assert _parse_number("abc") is None


class TestReadTextSafe:
    def test_read_existing_file(self, tmp_path):
        f = tmp_path / "test.txt"
        f.write_text("hello world", encoding="utf-8")
        assert read_text_safe(f) == "hello world"

    def test_read_nonexistent(self, tmp_path):
        f = tmp_path / "missing.txt"
        assert read_text_safe(f) == ""

    def test_size_limit(self, tmp_path):
        f = tmp_path / "big.txt"
        f.write_text("x" * 1000, encoding="utf-8")
        result = read_text_safe(f, max_bytes=100)
        assert len(result) == 100


class TestParseHtmlReport:
    def test_parse_qac_fixture(self):
        path = FIXTURES / "qac_his_new.html"
        if not path.exists():
            pytest.skip("fixture missing")
        result = parse_html_report(path)
        assert result["title"] is not None
        assert "error" not in result

    def test_parse_missing_file(self):
        result = parse_html_report(Path("/nonexistent.html"))
        assert result.get("error") == "missing_file"

    def test_parse_vcast_fixture(self):
        path = FIXTURES / "vcast_metrics.html"
        if not path.exists():
            pytest.skip("fixture missing")
        result = parse_html_report(path)
        assert result["title"] is not None
        assert len(result["tables"]) > 0
