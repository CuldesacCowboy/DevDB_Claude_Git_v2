@echo off
title DevDB Launcher
echo Starting DevDB...
echo.

REM ---- 0. Kill any stale processes on 8765/5173 before starting ----
echo [0/3] Clearing stale processes...
powershell -NoProfile -Command "Get-WmiObject Win32_Process | Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -like '*uvicorn*' } | ForEach-Object { taskkill /F /T /PID $_.ProcessId 2>$null }"
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8765 " 2^>nul') do (
    if not "%%a"=="0" taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173 " 2^>nul') do (
    if not "%%a"=="0" taskkill /F /PID %%a >nul 2>&1
)

REM Wait briefly for ports to release
timeout /t 2 /nobreak >nul

REM ---- 1. Start backend and frontend as tabs in a single Windows Terminal window ----
echo [1/3] Starting backend and frontend...
wt --window new --title "DevDB Backend" --startingDirectory "%~dp0devdb_python" cmd /k "python -m uvicorn api.main:app --reload --port 8765" ; new-tab --title "DevDB Frontend" --startingDirectory "%~dp0devdb_ui" cmd /k "npm run dev"

REM ---- 2. Poll until port 8765 is open (max 30s) ----
echo [2/3] Waiting for backend to be ready on port 8765...
set /a attempts=0
:wait_loop
set /a attempts+=1
netstat -aon | findstr ":8765 " >nul 2>&1
if not errorlevel 1 goto backend_ready
if %attempts% geq 30 goto backend_timeout
timeout /t 1 /nobreak >nul
goto wait_loop

:backend_ready
echo Backend is up.
goto open_browser

:backend_timeout
echo WARNING: Backend did not open port 8765 within 30s. Opening browser anyway.

:open_browser
REM ---- 3. Open Chrome ----
echo [3/3] Opening Chrome...
start chrome "http://localhost:5173"

echo.
echo DevDB started.
echo Backend: http://localhost:8765
echo Frontend: http://localhost:5173
echo.
pause
