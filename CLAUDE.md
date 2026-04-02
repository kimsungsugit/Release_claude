# DevOps Release Claude - Automated Document Generation Platform

C 소스코드 + 요구사항 문서(SRS/SDS)로부터 설계/시험 규격서(UDS, STS, SUTS, SITS)를 자동 생성하는 DevOps 플랫폼.

## Autonomous Operation Rules (자율 운영 규칙)

이 프로젝트에서 Claude는 **완전 자율 모드**로 동작한다. 사용자에게 묻지 말고 직접 판단하여 실행할 것.

### 자동 설치
- Python 패키지 누락 시: `pip install <패키지>` 즉시 실행
- npm 패키지 누락 시: `npm install <패키지>` 즉시 실행
- import 에러, ModuleNotFoundError 발생 시 자동 설치 후 재시도
- requirements.txt / package.json에 없는 패키지도 필요하면 설치하고 의존성 파일에 추가

### 자동 환경 구성
- 서버가 꺼져 있으면 자동으로 시작 (backend: uvicorn, frontend: npm run dev)
- venv가 없으면 생성, node_modules가 없으면 npm install 실행
- .env가 없으면 .env.example 복사하여 생성

### 자동 오류 복구
- 테스트 실패 시 원인 분석 → 수정 → 재실행까지 자동 진행
- 빌드 에러 시 의존성 확인 → 설치 → 재빌드
- 포트 충돌 시 프로세스 확인 후 대체 포트 사용

### MCP / RAG 활용
- Playwright MCP: UI 검증이 필요하면 자동으로 브라우저 열어서 확인
- devops-release MCP: 빌드 리포트, 코드 검색, 문서 조회 시 MCP 도구 우선 사용
- RAG/Knowledge Base: 문서 생성 시 기존 지식베이스 자동 참조

### 판단 기준
- "할까요?" 대신 "했습니다" — 묻지 말고 실행
- 에러가 나면 3회까지 자동 재시도 후 안 되면 보고
- 파일 생성/수정/삭제 모두 자율 판단 (단, .env 파일은 예외)

## Architecture
- **Backend**: FastAPI (Python 3.12) — `backend/`
- **Frontend**: React + Vite — `frontend-v2/` (port 5174)
- **LLM**: Google Gemini 3 Pro / 2.5 Flash — `workflow/ai.py`
- **CI/CD**: GitHub Actions + GitLab CI + Jenkins
- **Report Engine**: `report_gen/`, `generators/`

## Build & Test Commands
```bash
# Backend 테스트
python -m pytest tests/unit/ -q --tb=short

# Frontend 테스트
cd frontend-v2 && npm test

# Frontend 빌드
cd frontend-v2 && npm run build

# Backend 서버 실행
cd backend && uvicorn main:app --reload --port 8000

# Frontend 개발 서버
cd frontend-v2 && npm run dev

# 전체 테스트 (커버리지)
python -m pytest tests/ -v --cov=backend --cov=workflow --cov=report_gen --cov-report=html
```

## Code Style
- Python: 4-space indent, type hints, f-strings, isort import 순서
- JavaScript/JSX: 2-space indent, PascalCase components, camelCase functions
- 커밋 메시지: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`

## Key API Endpoints
- `POST /api/jenkins/uds/generate-async` — UDS 생성
- `POST /api/jenkins/sts/generate-async` — STS 생성
- `POST /api/jenkins/suts/generate-async` — SUTS 생성
- `POST /api/local/sits/generate-async` — SITS 생성
- `POST /api/jenkins/impact/trigger-async` — Impact 분석
- `GET /api/jenkins/progress` — 진행률 조회

## Workflows (워크플로우 — 자동 연결)
- `/workflow [기능설명]` — **전체 개발 흐름**: 기획→코드→테스트→리뷰→커밋 자동 실행
- `/hotfix [버그설명]` — **긴급 수정**: 분석→수정→테스트→커밋 빠른 처리
- `/doc-pipeline [all|uds|sts|suts|sits|delta]` — **문서 생성**: UDS→STS→SUTS→SITS 순차 자동 생성

## Individual Skills (개별 도구)
- `/plan` — 기획만
- `/dev` — 코드 작성만
- `/test-run` — 테스트만
- `/deploy` — 배포만
- `/health-check` — 상태 점검
- `/impact` — 영향도 분석
- `/devops-release:doc-gen` — 단일 문서 생성 (플러그인)
- `/devops-release:review` — 코드 리뷰 (플러그인)

## Important Paths
- 요구사항 문서: `D:/Project/devops/260105/docs/`
- 소스코드: `D:/Project/Ados/PDS64_RD/`
- 캐시: `.devops_pro_cache/`
- 환경설정: `.env` (절대 커밋 금지)
