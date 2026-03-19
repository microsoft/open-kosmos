# Focus Kosmos and snap window to left using Win + Left + Esc (press together, release in reverse)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
    public const byte VK_LWIN = 0x5B;
    public const byte VK_LEFT = 0x25;
    public const byte VK_ESCAPE = 0x1B;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const int SW_RESTORE = 9;
    public const int SW_SHOW = 5;
}
"@

# Find and restore Kosmos window first
$kosmos = Get-Process -ErrorAction SilentlyContinue | 
          Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like '*Kosmos*' } | 
          Select-Object -First 1
if ($kosmos) {
    $hwnd = $kosmos.MainWindowHandle
    # Always restore first to clear any snap/maximize state
    [Win32]::ShowWindow($hwnd, [Win32]::SW_RESTORE)
    Start-Sleep -Milliseconds 150
    # Bring to foreground
    [Win32]::ShowWindow($hwnd, [Win32]::SW_SHOW)
    [Win32]::SetForegroundWindow($hwnd)
    Start-Sleep -Milliseconds 100
}

# Press Win + Left + Esc (in order)
[Win32]::keybd_event([Win32]::VK_LWIN, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[Win32]::keybd_event([Win32]::VK_LEFT, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[Win32]::keybd_event([Win32]::VK_ESCAPE, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50

# Release in reverse order: Esc, Left, Win
[Win32]::keybd_event([Win32]::VK_ESCAPE, 0, [Win32]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[Win32]::keybd_event([Win32]::VK_LEFT, 0, [Win32]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[Win32]::keybd_event([Win32]::VK_LWIN, 0, [Win32]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
