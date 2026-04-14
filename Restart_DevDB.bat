@echo off
title DevDB Restart
echo Restarting DevDB...
echo.

REM ---- 1. Kill uvicorn python processes ----
echo [1/5] Killing uvicorn...
powershell -NoProfile -Command "Get-WmiObject Win32_Process | Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -like '*uvicorn*' } | ForEach-Object { taskkill /F /T /PID $_.ProcessId 2>$null }"

REM ---- 2. Kill port 8765 (backend) ----
echo [2/5] Releasing port 8765...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8765 " 2^>nul') do (
    if not "%%a"=="0" taskkill /F /PID %%a >nul 2>&1
)

REM ---- 3. Kill port 5173 (Vite) ----
echo [3/5] Releasing port 5173...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173 " 2^>nul') do (
    if not "%%a"=="0" taskkill /F /PID %%a >nul 2>&1
)

REM Wait for ports to clear
echo Waiting for ports to clear...
timeout /t 3 /nobreak >nul

REM ---- 4. Start backend and frontend in new windows ----
echo [4/5] Starting backend and frontend...
start "DevDB Backend" cmd /k "cd /d "%~dp0devdb_python" && python -m uvicorn api.main:app --reload --port 8765"
start "DevDB Frontend" cmd /k "cd /d "%~dp0devdb_ui" && npm run dev"

REM ---- Wait for backend (max 30s) ----
echo Waiting for backend on port 8765...
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
REM ---- 5. Open Chrome ----
echo [5/5] Opening Chrome...
start chrome "http://localhost:5173"

echo.
echo DevDB restarted.
pause
