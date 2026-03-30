@echo off
title DevDB Stop
echo Stopping DevDB...
echo.

REM ---- 1. Close titled terminal windows (PowerShell MainWindowTitle is reliable; taskkill WINDOWTITLE filter is not) ----
echo [1/4] Closing DevDB terminal windows...
powershell -NoProfile -Command "Get-Process -Name cmd -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq 'DevDB Backend' -or $_.MainWindowTitle -eq 'DevDB Frontend' } | Stop-Process -Force -ErrorAction SilentlyContinue"

REM ---- 2. Kill any process holding port 8765 (uvicorn backend) ----
echo [2/4] Releasing port 8765 (backend)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8765 " 2^>nul') do (
    if not "%%a"=="0" taskkill /F /PID %%a >nul 2>&1
)

REM ---- 3. Kill any process holding port 5173 (Vite dev server) ----
echo [3/4] Releasing port 5173 (frontend)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173 " 2^>nul') do (
    if not "%%a"=="0" taskkill /F /PID %%a >nul 2>&1
)

REM ---- 4. Close Chrome windows showing DevDB (page title is "devdb_ui") ----
echo [4/4] Closing Chrome DevDB windows...
powershell -NoProfile -Command "Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*devdb_ui*' } | Stop-Process -Force -ErrorAction SilentlyContinue"

echo.
echo Done. DevDB stopped.
timeout /t 2 /nobreak >nul
