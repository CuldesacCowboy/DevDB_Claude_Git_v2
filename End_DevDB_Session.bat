@echo off
title DevDB Session End
echo.
echo ============================================================
echo  DevDB Claude Code Session End
echo ============================================================
echo.

set /p "DECISIONS=Any decisions or rules to log? (press Enter to skip) "

echo.
echo Writing end-of-session prompt...

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
echo ^(use last 5 commits as a reasonable session window^)
echo.
echo STEP 3 — Update CLAUDE.md.
echo   a^) Update the "Current Build Status" table based on the commit
echo      messages from Step 1. Mark completed items as Complete.
echo   b^) Update the "Last commit" date for every file in the File Manifest
echo      that appears in Step 2's output.
echo   c^) If the new decisions/rules field above is not empty, append each
echo      decision to the Decision Log with the next available D-number.
echo   d^) Update the "Last updated" date and "Next ID" at the top of CLAUDE.md.
echo.
echo STEP 4 — Write DevDB_SessionHandoff.md in the repo root:
echo.
echo # DevDB Session Handoff
echo **Date:** %date%
echo.
echo ## What was completed
echo.
echo.
echo ## Files changed
echo.
echo.
echo ## What is NOT yet working
echo.
echo.
echo ## Recommended next task
echo.
echo.
echo ## Paste this into Claude Desktop to start the next session
echo.
echo.
echo STEP 5 — Commit everything.
echo   git add -A
echo   git commit -m "session end: "
echo   git push
) > "%~dp0devdb_end_prompt.txt"

cd /d "%~dp0devdb_python"
python ..\devdb_run_claude.py ..\devdb_end_prompt.txt

del "%~dp0devdb_end_prompt.txt"

echo.
echo ============================================================
echo  Session closed. Open DevDB_SessionHandoff.md and paste it
echo  into Claude Desktop.
echo ============================================================
echo.
pause
