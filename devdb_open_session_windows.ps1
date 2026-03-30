param([string]$RepoRoot)

# %~dp0 ends with \ which escapes the closing quote — strip trailing \ and "
$RepoRoot = $RepoRoot.TrimEnd('\', '"')

$posFile = Join-Path $RepoRoot "devdb_window_positions.json"

$cc_x = 50; $cc_y = 50; $cc_w = 1200; $cc_h = 800

if (Test-Path $posFile) {
    $pos  = Get-Content $posFile -Raw | ConvertFrom-Json
    $cc_x = $pos.claude.x; $cc_y = $pos.claude.y
    $cc_w = $pos.claude.w; $cc_h = $pos.claude.h
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinPos {
    [DllImport("user32.dll")]
    public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
}
"@

$claudeDir = Join-Path $RepoRoot "devdb_python"
$p = Start-Process "cmd.exe" -ArgumentList "/k", "cd /d `"$claudeDir`" && claude" -PassThru
Start-Sleep -Milliseconds 1000
$p.Refresh()
if ($p.MainWindowHandle -ne [IntPtr]::Zero) {
    [WinPos]::MoveWindow($p.MainWindowHandle, $cc_x, $cc_y, $cc_w, $cc_h, $true) | Out-Null
}
