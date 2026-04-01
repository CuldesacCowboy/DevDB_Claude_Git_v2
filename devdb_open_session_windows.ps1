param([string]$Task)

$RepoRoot = Split-Path -Parent $PSCommandPath

# -----------------------------------------------------------------------
# 1. Kill any stale backend / frontend processes
# -----------------------------------------------------------------------
Write-Host "Clearing stale processes on ports 8765 and 5173..."

Get-WmiObject Win32_Process | Where-Object {
    $_.Name -eq 'python.exe' -and $_.CommandLine -like '*uvicorn*'
} | ForEach-Object { taskkill /F /T /PID $_.ProcessId 2>$null }

foreach ($port in @(8765, 5173)) {
    $lines = netstat -aon 2>$null | Select-String ":$port\s"
    foreach ($line in $lines) {
        $parts = ($line.Line.Trim() -split '\s+')
        $procId = $parts[-1]
        if ($procId -match '^\d+$' -and $procId -ne '0') {
            taskkill /F /PID $procId 2>$null | Out-Null
        }
    }
}

Start-Sleep -Milliseconds 600

# -----------------------------------------------------------------------
# 2. Start backend and frontend in minimized cmd windows
#    (minimized = out of the way; Stop_DevDB.bat can still find them)
# -----------------------------------------------------------------------
Write-Host "Starting backend (port 8765)..."
Start-Process "cmd.exe" `
    -ArgumentList "/k python -m uvicorn api.main:app --reload --port 8765" `
    -WorkingDirectory "$RepoRoot\devdb_python" `
    -WindowStyle Minimized

Write-Host "Starting frontend (port 5173)..."
Start-Process "cmd.exe" `
    -ArgumentList "/k npm run dev" `
    -WorkingDirectory "$RepoRoot\devdb_ui" `
    -WindowStyle Minimized

# -----------------------------------------------------------------------
# 3. Poll until the backend TCP port is open (max 30 seconds)
# -----------------------------------------------------------------------
Write-Host "Waiting for backend to be ready..."
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect("localhost", 8765)
        $tcp.Close()
        $ready = $true
        break
    } catch {}
}

if ($ready) {
    Write-Host "Backend is up. Opening Chrome..."
} else {
    Write-Host "Backend did not respond within 30s — opening Chrome anyway."
}

# -----------------------------------------------------------------------
# 4. Open Chrome
# -----------------------------------------------------------------------
Start-Process "chrome" "http://localhost:5173"

# -----------------------------------------------------------------------
# 5. Copy /start <task> to clipboard
# -----------------------------------------------------------------------
"/start $Task" | Set-Clipboard
Write-Host "'/start $Task' copied to clipboard."

# -----------------------------------------------------------------------
# 6. Open Claude in a new WT window, positioned on right half of right screen
# -----------------------------------------------------------------------
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

$screens  = [System.Windows.Forms.Screen]::AllScreens
$rightScr = ($screens | Sort-Object { $_.Bounds.X } | Select-Object -Last 1)
$snapX    = $rightScr.Bounds.X + [int]($rightScr.Bounds.Width  / 2)
$snapY    = $rightScr.Bounds.Y
$snapW    = [int]($rightScr.Bounds.Width  / 2)
$snapH    = $rightScr.Bounds.Height

$beforeHandles = [WinPos]::FindWindowsByClass("CASCADIA_HOSTING_WINDOW_CLASS")

Start-Process "wt.exe" -ArgumentList "--window new --startingDirectory `"$RepoRoot`" cmd.exe /k claude"

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

if ($newHwnd -ne [IntPtr]::Zero) {
    Start-Sleep -Milliseconds 400
    [WinPos]::MoveWindow($newHwnd, $snapX, $snapY, $snapW, $snapH, $true) | Out-Null
}

Write-Host "Done. Paste the clipboard into Claude to start your session."
