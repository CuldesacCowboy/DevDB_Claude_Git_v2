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
echo.
echo Using the File Manifest, identify every file relevant to today's task.
echo Paste the COMPLETE contents of each file — no summaries, no truncation.
echo.
echo After pasting all files, write a file called DevDB_SessionBrief.md in
echo the repo root with this structure:
echo.
echo # DevDB Session Brief
echo **Date:**
echo **Task:** %TASK%
echo.
echo ## Files loaded
echo.
echo.
echo ## Relevant API endpoints
echo.
echo.
echo ## Current state summary
echo ^<2-3 sentences on current build status relevant to today's task^>
echo.
echo ## Ready to work
echo Paste this entire file into Claude Desktop before starting work.
) > "%REPO_ROOT%devdb_cc_prompt.txt"

echo.
echo Opening prompt in Notepad...
start notepad "%REPO_ROOT%devdb_cc_prompt.txt"

echo Opening Claude Code terminal...
start cmd /k "cd /d "%REPO_ROOT%devdb_python" && claude"

echo.
echo ============================================================
echo  NEXT STEP:
echo  1. Copy the prompt from Notepad
echo  2. Paste into the Claude Code terminal
echo  3. When CC writes DevDB_SessionBrief.md, paste it into Claude Desktop
echo ============================================================
echo.
pause
