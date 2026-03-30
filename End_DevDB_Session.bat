@echo off
title DevDB Session End
echo.
echo ============================================================
echo  DevDB Claude Code Session End
echo ============================================================
echo.

set /p "COMPLETED=What was completed this session? "
echo.
set /p "DECISIONS=Any decisions or rules to log? (press Enter to skip) "

echo.
echo Writing end-of-session prompt...

(
echo SESSION END — CLAUDE CODE
echo.
echo Today's date: %date%
echo Completed this session: %COMPLETED%
echo New decisions/rules: %DECISIONS%
echo.
echo Do all of the following in order:
echo.
echo 1. Update the "Current Build Status" table in CLAUDE.md to reflect
echo    what was completed. Mark completed items as Complete.
echo.
echo 2. If the new decisions/rules field above is not empty, append each
echo    decision to the Decision Log section of CLAUDE.md with the next
echo    available D-number.
echo.
echo 3. Update the "Last commit" date for every file in the File Manifest
echo    that was modified this session. Run:
echo      git diff --name-only HEAD~1
echo    to find which files changed.
echo.
echo 4. Write a session handoff file called DevDB_SessionHandoff.md in the
echo    repo root with this structure:
echo.
echo # DevDB Session Handoff
echo **Date:** %date%
echo **Completed:** %COMPLETED%
echo.
echo ## What was built
echo.
echo.
echo ## Current state
echo.
echo.
echo ## Next task
echo.
echo.
echo ## Files changed this session
echo.
echo.
echo 5. git add -A
echo    git commit -m "session end: %COMPLETED%"
echo    git push
) > "%~dp0devdb_end_prompt.txt"

cd /d "%~dp0devdb_python"
claude < ..\devdb_end_prompt.txt

del "%~dp0devdb_end_prompt.txt"

echo.
echo ============================================================
echo  Session closed. Handoff written to DevDB_SessionHandoff.md
echo ============================================================
echo.
pause
