param([string]$RepoRoot)

# %~dp0 ends with \ which escapes the closing quote — strip trailing \ and "
$RepoRoot = $RepoRoot.TrimEnd('\', '"')

$claudeDir = Join-Path $RepoRoot "devdb_python"
Start-Process "wt.exe" -ArgumentList "--window new cmd.exe /k `"cd /d $claudeDir && claude`""
