@echo off
title Save DevDB Window Positions
echo.
echo ============================================================
echo  Save DevDB Window Positions
echo ============================================================
echo.
echo Position these windows exactly where you want them:
echo   1. Any Notepad window       (for devdb_cc_prompt.txt)
echo   2. Any cmd/terminal window  (for the Claude Code session)
echo.
echo Then press any key here to capture their positions.
pause >nul
echo.
echo Capturing positions...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0devdb_save_window_positions.ps1" -RepoRoot "%~dp0"
echo.
pause
