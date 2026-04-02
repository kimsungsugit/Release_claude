"""AI Validator 단위 테스트"""
import pytest

from workflow.ai_validator import (
    ValidationResult,
    validate_llm_response,
    validate_function_description,
    validate_test_case,
    retry_with_validation,
)


class TestValidationResult:
    def test_default_valid(self):
        r = ValidationResult()
        assert r.valid is True
        assert r.errors == []

    def test_add_error_invalidates(self):
        r = ValidationResult()
        r.add_error("test error")
        assert r.valid is False
        assert len(r.errors) == 1

    def test_add_warning_stays_valid(self):
        r = ValidationResult()
        r.add_warning("test warning")
        assert r.valid is True
        assert len(r.warnings) == 1


class TestValidateLlmResponse:
    def test_none_response(self):
        r = validate_llm_response(None)
        assert r.valid is False
        assert "비어있습니다" in r.errors[0]

    def test_empty_response(self):
        r = validate_llm_response("")
        assert r.valid is False

    def test_too_short(self):
        r = validate_llm_response("hi", min_length=10)
        assert r.valid is False
        assert "짧습니다" in r.errors[0]

    def test_too_long_truncated(self):
        text = "x" * 1000
        r = validate_llm_response(text, max_length=100)
        assert r.valid is True
        assert len(r.cleaned_text) == 100
        assert len(r.warnings) > 0

    def test_valid_text(self):
        r = validate_llm_response("이 함수는 버저 컨트롤 초기화를 수행합니다.", min_length=5)
        assert r.valid is True

    def test_json_format_valid(self):
        r = validate_llm_response('{"key": "value"}', expected_format="json")
        assert r.valid is True

    def test_json_format_invalid(self):
        r = validate_llm_response('not json {', expected_format="json")
        assert r.valid is False
        assert "JSON" in r.errors[0]

    def test_json_with_code_fences(self):
        r = validate_llm_response('```json\n{"a": 1}\n```', expected_format="json")
        assert r.valid is True
        assert r.cleaned_text == '{"a": 1}'

    def test_json_required_fields(self):
        r = validate_llm_response(
            '{"a": 1}',
            expected_format="json",
            required_fields=["a", "b"],
            min_length=1,
        )
        assert r.valid is False
        assert any("b" in e for e in r.errors)

    def test_code_format(self):
        r = validate_llm_response('```c\nvoid main() { return; }\n```', expected_format="code")
        assert r.valid is True
        assert "```" not in r.cleaned_text

    def test_banned_patterns(self):
        r = validate_llm_response(
            "I cannot help with that request",
            min_length=5,
            banned_patterns=[r"(?i)I cannot"],
        )
        assert r.valid is False

    def test_hallucination_warning_url(self):
        r = validate_llm_response(
            "참고: https://example.com/docs 에서 확인하세요. 이 함수는 초기화를 수행합니다.",
            min_length=5,
        )
        assert any("URL" in w for w in r.warnings)

    def test_safety_warning_api_key(self):
        r = validate_llm_response(
            "설정에서 api_key = 'sk-1234567890abcdefghijklmn' 값을 사용합니다.",
            min_length=5,
        )
        assert any("API" in w or "키" in w or "key" in w.lower() for w in r.warnings)

    def test_context_keywords(self):
        r = validate_llm_response(
            "완전히 관계없는 내용입니다.",
            min_length=5,
            context_keywords=["buzzer", "motor", "init", "control", "PDS"],
        )
        assert any("키워드" in w for w in r.warnings)


class TestValidateFunctionDescription:
    def test_valid_description(self):
        r = validate_function_description(
            "이 함수는 버저 컨트롤 모듈을 초기화하고 기본 주파수를 설정합니다.",
            "Ap_BuzzerCtrl_Init",
        )
        assert r.valid is True

    def test_too_short(self):
        r = validate_function_description("짧음", "Func")
        assert r.valid is False

    def test_ai_refusal(self):
        r = validate_function_description(
            "I'm sorry, I cannot generate a description for this function.",
            "Func",
        )
        assert r.valid is False


class TestValidateTestCase:
    def test_valid_test_case(self):
        tc = '{"test_name": "test_init", "inputs": {"x": 0}, "expected": {"ret": 1}}'
        r = validate_test_case(tc)
        assert r.valid is True

    def test_missing_fields(self):
        tc = '{"only_key": "value"}'
        r = validate_test_case(tc)
        assert r.valid is False

    def test_empty_test_name(self):
        tc = '{"test_name": "", "inputs": {}, "expected": {}}'
        r = validate_test_case(tc)
        assert r.valid is False


class TestRetryWithValidation:
    def test_success_first_try(self):
        def mock_llm(**kw):
            return "정상 응답입니다. 충분히 긴 텍스트를 반환합니다."

        text, result = retry_with_validation(
            mock_llm,
            lambda r: validate_llm_response(r, min_length=10),
        )
        assert result.valid is True
        assert len(text) > 0

    def test_success_after_retry(self):
        call_count = {"n": 0}

        def flaky_llm(**kw):
            call_count["n"] += 1
            if call_count["n"] < 2:
                return "짧"  # too short
            return "충분히 긴 정상 응답 텍스트입니다."

        text, result = retry_with_validation(
            flaky_llm,
            lambda r: validate_llm_response(r, min_length=10),
            max_retries=2,
        )
        assert result.valid is True
        assert call_count["n"] == 2

    def test_all_retries_fail(self):
        def bad_llm(**kw):
            return None

        text, result = retry_with_validation(
            bad_llm,
            lambda r: validate_llm_response(r, min_length=10),
            max_retries=1,
        )
        assert result.valid is False
        assert text == ""
