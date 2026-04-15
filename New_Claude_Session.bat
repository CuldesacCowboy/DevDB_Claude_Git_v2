@echo off
title New Claude Session

REM Copy orientation prompt to clipboard
powershell -NoProfile -Command "'Please read CLAUDE.md to orient yourself.' | Set-Clipboard"
echo Prompt copied to clipboard. Paste it into Claude when it opens.
echo.

REM Open claude as a new tab in the existing WT window (--window 0 = most recently
REM focused WT window; falls back to a new window if none is open)
start wt.exe --window 0 new-tab --startingDirectory "%~dp0" cmd.exe /k claude

echo Done. Paste the clipboard into Claude to get started.
timeout /t 2 /nobreak >nul
