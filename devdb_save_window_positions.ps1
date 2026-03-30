param([string]$RepoRoot)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinRect {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
}
"@

function Get-WinBounds($proc) {
    if (-not $proc -or $proc.MainWindowHandle -eq [IntPtr]::Zero) { return $null }
    $r = New-Object WinRect+RECT
    [WinRect]::GetWindowRect($proc.MainWindowHandle, [ref]$r) | Out-Null
    return @{ x = $r.Left; y = $r.Top; w = ($r.Right - $r.Left); h = ($r.Bottom - $r.Top) }
}

$notepadProc = Get-Process "notepad" -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
    Select-Object -First 1

$cmdProc = Get-Process "cmd" -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle -ne "" } |
    Select-Object -First 1

$pos = [ordered]@{
    notepad = [ordered]@{ x = 50;  y = 50;  w = 900;  h = 700 }
    claude  = [ordered]@{ x = 50;  y = 800; w = 1200; h = 800 }
}

$nb = Get-WinBounds $notepadProc
if ($nb) {
    $pos.notepad = [ordered]@{ x = $nb.x; y = $nb.y; w = $nb.w; h = $nb.h }
    Write-Host "Notepad:  $($nb.x),$($nb.y)  $($nb.w)x$($nb.h)"
} else {
    Write-Host "No Notepad window found -- notepad defaults kept."
}

$cb = Get-WinBounds $cmdProc
if ($cb) {
    $pos.claude = [ordered]@{ x = $cb.x; y = $cb.y; w = $cb.w; h = $cb.h }
    Write-Host "Terminal: $($cb.x),$($cb.y)  $($cb.w)x$($cb.h)"
} else {
    Write-Host "No cmd window found -- terminal defaults kept."
}

$out = Join-Path $RepoRoot "devdb_window_positions.json"
$pos | ConvertTo-Json | Set-Content $out
Write-Host ""
Write-Host "Saved to: $out"
