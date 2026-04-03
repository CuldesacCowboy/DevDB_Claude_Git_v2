@echo off
title DevDB Stop
echo Stopping DevDB...
echo.

REM ---- 1. Close cmd.exe windows running uvicorn or npm run dev ----
echo [1/4] Closing DevDB terminal windows...
powershell -NoProfile -Command "Get-WmiObject Win32_Process | Where-Object { $_.Name -eq 'cmd.exe' -and ($_.CommandLine -like '*uvicorn*' -or $_.CommandLine -like '*8765*' -or $_.CommandLine -like '*npm run dev*' -or $_.CommandLine -like '*Start_DevDB*') } | ForEach-Object { taskkill /F /T /PID $_.ProcessId 2>$null }"

REM ---- 1b. Kill detached python.exe uvicorn processes ----
powershell -NoProfile -Command "Get-WmiObject Win32_Process | Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -like '*uvicorn*' } | ForEach-Object { taskkill /F /T /PID $_.ProcessId 2>$null }"

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

REM ---- 4. Close Chrome windows showing DevDB ----
echo [4/4] Closing Chrome DevDB windows...
powershell -NoProfile -Command "Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*devdb_ui*' } | Stop-Process -Force -ErrorAction SilentlyContinue"

REM ---- 5. Wait until port 8765 is confirmed free (max 15s) ----
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
goto done

:port_timeout
echo WARNING: Port 8765 may still be in use. Proceeding anyway.

:done
echo.
echo Done. DevDB stopped.
timeout /t 1 /nobreak >nul
