param([string]$Task)

# Determine repo root from this script's own location — avoids %~dp0 trailing backslash issues
$RepoRoot = Split-Path -Parent $PSCommandPath

# Copy /start <task> to clipboard — ready to paste as first message in claude
"/start $Task" | Set-Clipboard

# --- Win32 helpers for window positioning ---
Add-Type -AssemblyName System.Windows.Forms

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class WinPos {
    [DllImport("user32.dll")]
    public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    public static List<IntPtr> FindWindowsByClass(string className) {
        var list = new List<IntPtr>();
        EnumWindows((hwnd, lp) => {
            var sb = new StringBuilder(256);
            GetClassName(hwnd, sb, 256);
            if (sb.ToString() == className && IsWindowVisible(hwnd))
                list.Add(hwnd);
            return true;
        }, IntPtr.Zero);
        return list;
    }
}
"@

# --- Compute right half of rightmost screen ---
$screens  = [System.Windows.Forms.Screen]::AllScreens
$rightScr = ($screens | Sort-Object { $_.Bounds.X } | Select-Object -Last 1)
$snapX    = $rightScr.Bounds.X + [int]($rightScr.Bounds.Width  / 2)
$snapY    = $rightScr.Bounds.Y
$snapW    = [int]($rightScr.Bounds.Width  / 2)
$snapH    = $rightScr.Bounds.Height

# --- Snapshot existing Windows Terminal windows before launch ---
$beforeHandles = [WinPos]::FindWindowsByClass("CASCADIA_HOSTING_WINDOW_CLASS")

# --- Launch new Windows Terminal window with claude ---
Start-Process "wt.exe" -ArgumentList "--window new --startingDirectory `"$RepoRoot`" cmd.exe /k claude"

# --- Poll for the new window handle (up to 6 seconds) ---
$newHwnd = [IntPtr]::Zero
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 300
    $afterHandles = [WinPos]::FindWindowsByClass("CASCADIA_HOSTING_WINDOW_CLASS")
    $newHandles   = $afterHandles | Where-Object { $beforeHandles -notcontains $_ }
    if ($newHandles) {
        $newHwnd = $newHandles[0]
        break
    }
}

# --- Move and resize to right half of right screen ---
if ($newHwnd -ne [IntPtr]::Zero) {
    Start-Sleep -Milliseconds 400   # let WT finish rendering before repositioning
    [WinPos]::MoveWindow($newHwnd, $snapX, $snapY, $snapW, $snapH, $true) | Out-Null
}
