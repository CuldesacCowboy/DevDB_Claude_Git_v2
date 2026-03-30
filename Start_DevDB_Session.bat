@echo off
set /p "TASK=What's today's task? "
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0devdb_open_session_windows.ps1" -Task "%TASK%"
