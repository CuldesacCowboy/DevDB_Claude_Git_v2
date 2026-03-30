@echo off
title DevDB Session End
set REPO_ROOT=%~dp0
echo.
echo ============================================================
echo  DevDB Claude Code Session End
echo ============================================================
echo.

set /p "DECISIONS=Any decisions or rules to log? (press Enter to skip) "

echo.
echo Generating session handoff from git...
python "%~dp0devdb_generate_handoff.py"

echo.
echo Writing CLAUDE.md update prompt...

(
echo SESSION END — CLAUDE CODE
echo.
echo Today's date: %date%
echo New decisions or rules from the user: %DECISIONS%
echo.
echo Do all of the following steps in order. Do not skip any.
echo.
echo STEP 1 — Figure out what was done this session.
echo Run: git log --since="8 hours ago" --oneline
echo Read every commit message. That is what was completed this session.
echo.
echo STEP 2 — Figure out which files changed.
echo Run: git diff --name-only HEAD~5 HEAD
echo.
echo STEP 3 — Update CLAUDE.md.
echo   a^) Update the "Current Build Status" table based on commit messages from Step 1.
echo      Mark completed items as Complete.
echo   b^) Update the "Last commit" date for every file in the File Manifest
echo      that appears in Step 2's output.
echo   c^) If the decisions/rules field above is not empty, append each decision
echo      to the Decision Log with the next available D-number.
echo   d^) Update the "Last updated" date and "Next ID" at the top of CLAUDE.md.
echo.
echo STEP 4 — Commit everything.
echo   git add -A
echo   git commit -m "session end: %COMPLETED%"
echo   git push
) > "%REPO_ROOT%devdb_end_prompt.txt"

echo.
echo Opening prompt in Notepad...
start "" notepad "%~dp0devdb_end_prompt.txt"
start "" notepad "%~dp0DevDB_SessionHandoff.md"

echo Opening Claude Code terminal...
start "" cmd /k "cd /d "%~dp0devdb_python" && claude"

timeout /t 3 /nobreak >nul

echo.
echo ============================================================
echo  NEXT STEP:
echo  1. Copy the prompt from Notepad
echo  2. Paste into the Claude Code terminal
echo  3. When CC is done, close the CC terminal
echo  4. Open DevDB_SessionHandoff.md and paste into Claude Desktop
echo ============================================================
echo.
pause
