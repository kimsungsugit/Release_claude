@echo off
title DevOps Release Server
cd /d "%~dp0\.."
echo ============================================
echo  DevOps Release Server
echo ============================================
echo.
echo Starting on http://0.0.0.0:8000 ...
echo Press Ctrl+C to stop.
echo.
backend\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
pause
