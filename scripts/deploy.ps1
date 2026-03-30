# DevOps Release - 내부망 배포 스크립트
# 사용법: powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1

param(
    [string]$Port = "8000",
    [string]$ServiceName = "DevOpsRelease",
    [switch]$SkipBuild,
    [switch]$InstallService
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ProjectRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " DevOps Release - Deployment Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Project Root: $ProjectRoot"
Write-Host "Port: $Port"
Write-Host ""

# 1. Python 환경 확인
Write-Host "[1/5] Python 환경 확인..." -ForegroundColor Yellow
$VenvPython = Join-Path $ProjectRoot "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $VenvPython)) {
    Write-Host "  backend\.venv 없음, 생성 중..." -ForegroundColor Gray
    python -m venv backend\.venv
    & $VenvPython -m pip install --upgrade pip
    & $VenvPython -m pip install -r requirements.txt
}
Write-Host "  OK: $VenvPython" -ForegroundColor Green

# 2. Node.js 환경 확인
Write-Host "[2/5] Node.js 환경 확인..." -ForegroundColor Yellow
$NodeModules = Join-Path $ProjectRoot "frontend-v2\node_modules"
if (-not (Test-Path $NodeModules)) {
    Write-Host "  node_modules 없음, npm install 실행..." -ForegroundColor Gray
    Push-Location (Join-Path $ProjectRoot "frontend-v2")
    npm install
    Pop-Location
}
Write-Host "  OK" -ForegroundColor Green

# 3. 프론트엔드 빌드
if (-not $SkipBuild) {
    Write-Host "[3/5] 프론트엔드 빌드..." -ForegroundColor Yellow
    Push-Location (Join-Path $ProjectRoot "frontend-v2")
    npm run build
    Pop-Location
    $DistIndex = Join-Path $ProjectRoot "frontend-v2\dist\index.html"
    if (Test-Path $DistIndex) {
        Write-Host "  OK: dist/index.html 생성 확인" -ForegroundColor Green
    } else {
        Write-Host "  ERROR: 빌드 실패" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "[3/5] 빌드 건너뜀 (-SkipBuild)" -ForegroundColor Gray
}

# 4. 테스트 실행
Write-Host "[4/5] 백엔드 헬스 체크 테스트..." -ForegroundColor Yellow
$TestProc = Start-Process -FilePath $VenvPython -ArgumentList "-m uvicorn backend.main:app --host 127.0.0.1 --port $Port" -WorkingDirectory $ProjectRoot -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 5

try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -Method Get -TimeoutSec 10
    Write-Host "  OK: Backend v$($response.version) - $($response.engine)" -ForegroundColor Green

    # 프론트엔드 서빙 확인
    $frontResp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -Method Get -TimeoutSec 5 -UseBasicParsing
    if ($frontResp.StatusCode -eq 200) {
        Write-Host "  OK: Frontend 서빙 확인 (HTTP 200)" -ForegroundColor Green
    }
} catch {
    Write-Host "  WARNING: 헬스 체크 실패 - $_" -ForegroundColor Yellow
} finally {
    Stop-Process -Id $TestProc.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# 5. 서비스 등록 (선택)
if ($InstallService) {
    Write-Host "[5/5] Windows 서비스 등록..." -ForegroundColor Yellow

    $NssmPath = Get-Command nssm -ErrorAction SilentlyContinue
    if (-not $NssmPath) {
        Write-Host "  NSSM이 설치되어 있지 않습니다." -ForegroundColor Red
        Write-Host "  https://nssm.cc/download 에서 다운로드 후 PATH에 추가하세요." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  수동 실행: scripts\start.bat" -ForegroundColor Cyan
    } else {
        # 기존 서비스 제거
        & nssm stop $ServiceName 2>$null
        & nssm remove $ServiceName confirm 2>$null

        # 서비스 등록
        & nssm install $ServiceName $VenvPython "-m uvicorn backend.main:app --host 0.0.0.0 --port $Port"
        & nssm set $ServiceName AppDirectory $ProjectRoot
        & nssm set $ServiceName AppRestartDelay 5000
        & nssm set $ServiceName DisplayName "DevOps Release Server"
        & nssm set $ServiceName Description "DevOps Release - Jenkins Pipeline Analysis Tool"
        & nssm set $ServiceName Start SERVICE_AUTO_START

        # 서비스 시작
        & nssm start $ServiceName
        Write-Host "  OK: 서비스 '$ServiceName' 등록 및 시작 완료" -ForegroundColor Green
    }
} else {
    Write-Host "[5/5] 서비스 등록 건너뜀 (-InstallService 옵션으로 활성화)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " 배포 완료!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
$IP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.PrefixOrigin -ne "WellKnown" } | Select-Object -First 1).IPAddress
Write-Host "접속 주소: http://${IP}:${Port}" -ForegroundColor Cyan
Write-Host "수동 실행: scripts\start.bat" -ForegroundColor Gray
Write-Host ""
