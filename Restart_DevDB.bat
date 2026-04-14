@echo off
title DevDB Restart
echo Restarting DevDB...
echo.

REM ---- 1. Close cmd.exe windows running uvicorn or npm run dev ----
echo [1/6] Closing DevDB terminal windows...
powershell -NoProfile -Command "Get-WmiObject Win32_Process | Where-Object { $_.Name -eq 'cmd.exe' -and ($_.CommandLine -like '*uvicorn*' -or $_.CommandLine -like '*8765*' -or $_.CommandLine -like '*npm run dev*' -or $_.CommandLine -like '*Start_DevDB*') } | ForEach-Object { taskkill /F /T /PID $_.ProcessId 2>$null }"

REM ---- 1b. Kill detached python.exe uvicorn processes ----
powershell -NoProfile -Command "Get-WmiObject Win32_Process | Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -like '*uvicorn*' } | ForEach-Object { taskkill /F /T /PID $_.ProcessId 2>$null }"

REM ---- 2. Kill any process holding port 8765 (uvicorn backend) ----
echo [2/6] Releasing port 8765 (backend)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8765 " 2^>nul') do (
    if not "%%a"=="0" taskkill /F /PID %%a >nul 2>&1
)

REM ---- 3. Kill any process holding port 5173 (Vite dev server) ----
echo [3/6] Releasing port 5173 (frontend)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173 " 2^>nul') do (
    if not "%%a"=="0" taskkill /F /PID %%a >nul 2>&1
)

REM ---- 4. Close Chrome windows showing DevDB ----
echo [4/6] Closing Chrome DevDB windows...
powershell -NoProfile -Command "Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*devdb_ui*' } | Stop-Process -Force -ErrorAction SilentlyContinue"

REM ---- Wait until port 8765 is confirmed free (max 15s) ----
echo Waiting for port 8765 to be released...
set /a attempts=0
:wait_loop
set /a attempts+=1
netstat -aon | findstr ":8765 " | findstr "LISTENING" >nul 2>&1
if errorlevel 1 goto port_free
if %attempts% geq 30 goto port_timeout
timeout /t 1 /nobreak >nul
goto wait_loop

:port_free
echo Port 8765 is free.
goto start

:port_timeout
echo WARNING: Port 8765 may still be in use. Proceeding anyway.

:start
echo.
echo --- Starting DevDB ---
echo.

REM ---- 5. Start backend and frontend as tabs in a single Windows Terminal window ----
echo [5/6] Starting backend and frontend...
wt --window new --title "DevDB Backend" --startingDirectory "%~dp0devdb_python" cmd /k "python -m uvicorn api.main:app --reload --port 8765" ; new-tab --title "DevDB Frontend" --startingDirectory "%~dp0devdb_ui" cmd /k "npm run dev"

REM ---- Poll until port 8765 is open (max 30s) ----
echo Waiting for backend to be ready on port 8765...
set /a attempts=0
:wait_backend
set /a attempts+=1
netstat -aon | findstr ":8765 " >nul 2>&1
if not errorlevel 1 goto backend_ready
if %attempts% geq 30 goto backend_timeout
timeout /t 1 /nobreak >nul
goto wait_backend

:backend_ready
echo Backend is up.
goto open_browser

:backend_timeout
echo WARNING: Backend did not open port 8765 within 30s. Opening browser anyway.

:open_browser
REM ---- 6. Open Chrome ----
echo [6/6] Opening Chrome...
start chrome "http://localhost:5173"

echo.
echo DevDB restarted.
echo Backend: http://localhost:8765
echo Frontend: http://localhost:5173
echo.
pause
