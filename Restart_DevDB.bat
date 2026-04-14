@echo off
title DevDB Restart
echo Restarting DevDB...
echo.
call "%~dp0Stop_DevDB.bat"
call "%~dp0Start_DevDB.bat"
