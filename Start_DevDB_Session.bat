@echo off
title DevDB Session Startup
set REPO_ROOT=%~dp0
echo.
echo ============================================================
echo  DevDB Claude Code Session Startup
echo ============================================================
echo.

set /p "TASK=What is today's task? "

echo.
echo Writing session prompt...

(
echo SESSION STARTUP — CLAUDE CODE
echo.
echo Read CLAUDE.md in full. Pay attention to:
echo   - Current Build Status table
echo   - API Contract section
echo   - File Manifest section
echo   - Pill Sizing Rule
echo   - Rules for Claude Code Sessions
echo.
echo Today's task: %TASK%
) > "%REPO_ROOT%devdb_cc_prompt.txt"

echo.
echo Opening windows...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0devdb_open_session_windows.ps1" -RepoRoot "%~dp0" -PromptFile "%~dp0devdb_cc_prompt.txt"
