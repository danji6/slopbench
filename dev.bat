@echo off
setlocal enabledelayedexpansion
rem The call and the exit share one line on purpose. cmd resumes reading this
rem file by byte offset, and a self-update rewrites it while it runs.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1" %* & exit /b !ERRORLEVEL!
