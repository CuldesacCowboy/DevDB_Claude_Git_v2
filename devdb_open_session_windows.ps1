param([string]$RepoRoot)

# %~dp0 ends with \ which escapes the closing quote — strip trailing \ and "
$RepoRoot = $RepoRoot.TrimEnd('\', '"')

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
    [WinPos]::MoveWindow($p.MainWindowHandle, 2885, -1, 970, 1037, $true) | Out-Null
}
