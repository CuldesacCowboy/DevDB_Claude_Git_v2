@echo off
title DevDB Launcher
echo Starting DevDB...
echo.

REM Open backend and frontend as tabs in a single Windows Terminal window
wt --window new --title "DevDB Backend" --startingDirectory "%~dp0devdb_python" cmd /k "python -m uvicorn api.main:app --reload --port 8765" ; new-tab --title "DevDB Frontend" --startingDirectory "%~dp0devdb_ui" cmd /k "npm run dev"

REM Wait 7 seconds for both services to initialize
timeout /t 7 /nobreak >nul

REM Open Chrome to the app
start chrome "http://localhost:5173"

echo.
echo DevDB started. Backend and frontend are tabs in one terminal window.
echo Backend: http://localhost:8765
echo Frontend: http://localhost:5173
echo.
echo If the browser opened too early, refresh after a few seconds.
pause
