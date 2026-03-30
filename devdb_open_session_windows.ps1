param([string]$RepoRoot, [string]$Task)

# %~dp0 ends with \ which escapes the closing quote — strip trailing \ and "
$RepoRoot = $RepoRoot.TrimEnd('\', '"')
$Task     = $Task.TrimEnd('"')

# Copy /start <task> to clipboard — ready to paste as first message in claude
"/start $Task" | Set-Clipboard

Start-Process "wt.exe" -ArgumentList "--window new cmd.exe /k `"cd /d $RepoRoot && claude`""
