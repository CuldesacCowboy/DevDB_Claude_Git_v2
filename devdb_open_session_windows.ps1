param(
    [string]$RepoRoot,
    [string]$PromptFile
)

$posFile = Join-Path $RepoRoot "devdb_window_positions.json"

# Defaults (used if no saved positions file exists yet)
$np_x = 50;  $np_y = 50;  $np_w = 900;  $np_h = 700
$cc_x = 50;  $cc_y = 800; $cc_w = 1200; $cc_h = 800

if (Test-Path $posFile) {
    $pos  = Get-Content $posFile -Raw | ConvertFrom-Json
    $np_x = $pos.notepad.x; $np_y = $pos.notepad.y
    $np_w = $pos.notepad.w; $np_h = $pos.notepad.h
    $cc_x = $pos.claude.x;  $cc_y = $pos.claude.y
    $cc_w = $pos.claude.w;  $cc_h = $pos.claude.h
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinPos {
    [DllImport("user32.dll")]
    public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
}
"@

# --- Notepad ---
$np = Start-Process "notepad.exe" -ArgumentList "`"$PromptFile`"" -PassThru
Start-Sleep -Milliseconds 1000
$np.Refresh()
if ($np.MainWindowHandle -ne [IntPtr]::Zero) {
    [WinPos]::MoveWindow($np.MainWindowHandle, $np_x, $np_y, $np_w, $np_h, $true) | Out-Null
}

# --- Claude Code terminal ---
$claudeDir = Join-Path $RepoRoot "devdb_python"
$p = Start-Process "cmd.exe" -ArgumentList "/k", "cd /d `"$claudeDir`" && claude" -PassThru
Start-Sleep -Milliseconds 1000
$p.Refresh()
if ($p.MainWindowHandle -ne [IntPtr]::Zero) {
    [WinPos]::MoveWindow($p.MainWindowHandle, $cc_x, $cc_y, $cc_w, $cc_h, $true) | Out-Null
}
