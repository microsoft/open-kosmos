# Move Chrome window to specified display position
# Parameters: -targetX <x> -targetY <y>
param(
    [int]$targetX = 0,
    [int]$targetY = 0
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {
    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, 
                                           int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
    
    public const uint SWP_NOSIZE = 0x0001;
    public const uint SWP_NOZORDER = 0x0004;
    public const int SW_RESTORE = 9;
    public const int SW_SHOW = 5;
}
"@

# Wait a bit for Chrome window to be ready
Start-Sleep -Milliseconds 50

# Find Chrome main window (the one with a window title)
$maxRetries = 10
$retryCount = 0
$chrome = $null

while ($retryCount -lt $maxRetries) {
    $chrome = Get-Process chrome -ErrorAction SilentlyContinue | 
              Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' } | 
              Select-Object -First 1
    
    if ($chrome) {
        break
    }
    
    Start-Sleep -Milliseconds 50
    $retryCount++
}

if ($chrome) {
    $hwnd = $chrome.MainWindowHandle
    
    # Check if minimized and restore first
    if ([WinAPI]::IsIconic($hwnd)) {
        [WinAPI]::ShowWindow($hwnd, [WinAPI]::SW_RESTORE)
        Start-Sleep -Milliseconds 100
    }
    
    # Ensure window is visible
    [WinAPI]::ShowWindow($hwnd, [WinAPI]::SW_SHOW)
    
    # Move Chrome window to target display position (don't change size)
    $flags = [WinAPI]::SWP_NOSIZE -bor [WinAPI]::SWP_NOZORDER
    [WinAPI]::SetWindowPos($hwnd, [IntPtr]::Zero, $targetX, $targetY, 0, 0, $flags)
    
    # Bring Chrome to foreground
    [WinAPI]::SetForegroundWindow($hwnd)
    
    Write-Host "Chrome moved to ($targetX, $targetY)"
} else {
    Write-Host "Chrome window not found"
    exit 1
}
