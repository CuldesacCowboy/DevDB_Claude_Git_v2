param([string]$Task)

# Determine repo root from this script's own location — avoids %~dp0 trailing backslash issues
$RepoRoot = Split-Path -Parent $PSCommandPath

# Copy /start <task> to clipboard — ready to paste as first message in claude
"/start $Task" | Set-Clipboard

Start-Process "wt.exe" -ArgumentList "--window new --startingDirectory `"$RepoRoot`" cmd.exe /k claude"
