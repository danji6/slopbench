@echo off
setlocal
cd /d "%~dp0"

where bun >nul 2>nul
if errorlevel 1 (
  echo bun was not found on PATH. Install it from https://bun.sh and retry.
  exit /b 1
)

bun scripts\runner.ts dev %*
exit /b %ERRORLEVEL%
