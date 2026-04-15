@echo off
title New Claude Session

REM Copy orientation prompt to clipboard
powershell -NoProfile -Command "'Please read CLAUDE.md to orient yourself.' | Set-Clipboard"
echo Prompt copied to clipboard. Paste it into Claude when it opens.
echo.

REM Open a new Windows Terminal window running claude in the repo root
start wt.exe --window new --startingDirectory "%~dp0" cmd.exe /k claude

echo Done. Paste the clipboard into Claude to get started.
timeout /t 2 /nobreak >nul
