@echo off
REM DevDB database backup script
REM Run daily via Task Scheduler or manually.
REM Backs up both devdb and marks_mirror to timestamped files.

set BACKUP_DIR=C:\DevDB_Backups
set PG_BIN="C:\Program Files\PostgreSQL\16\bin"
set TIMESTAMP=%date:~-4%%date:~4,2%%date:~7,2%_%time:~0,2%%time:~3,2%
set TIMESTAMP=%TIMESTAMP: =0%

if not exist %BACKUP_DIR% mkdir %BACKUP_DIR%

echo Backing up devdb...
%PG_BIN%\pg_dump -U postgres -F c -f "%BACKUP_DIR%\devdb_%TIMESTAMP%.dump" devdb
if %errorlevel% equ 0 (echo   devdb backup OK) else (echo   devdb backup FAILED)

echo Backing up marks_mirror...
%PG_BIN%\pg_dump -U postgres -F c -f "%BACKUP_DIR%\marks_mirror_%TIMESTAMP%.dump" marks_mirror
if %errorlevel% equ 0 (echo   marks_mirror backup OK) else (echo   marks_mirror backup FAILED)

REM Clean up backups older than 30 days
forfiles /p "%BACKUP_DIR%" /s /m *.dump /d -30 /c "cmd /c del @path" 2>nul

echo Done. Backups in %BACKUP_DIR%
