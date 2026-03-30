@echo off
title DevDB Launcher
echo Starting DevDB...
echo.

REM Start the FastAPI backend in its own window
start "DevDB Backend" cmd /k "cd /d ""%~dp0devdb_python"" && python -m uvicorn api.main:app --reload --port 8765"

REM Wait 3 seconds for backend to initialize
timeout /t 3 /nobreak >nul

REM Start the Vite frontend in its own window
start "DevDB Frontend" cmd /k "cd /d ""%~dp0devdb_ui"" && npm run dev"

REM Wait 4 seconds for Vite to start
timeout /t 4 /nobreak >nul

REM Open Chrome to the app
start chrome "http://localhost:5173"

echo.
echo DevDB is starting. Two terminal windows have opened.
echo Backend: http://localhost:8765
echo Frontend: http://localhost:5173
echo.
echo If the browser opened too early, refresh after a few seconds.
pause
