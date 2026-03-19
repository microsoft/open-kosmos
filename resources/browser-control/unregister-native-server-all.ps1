# Combined Native Server Unregistration Script for Chrome and Edge
# Removes the Native Messaging host registration from both browsers

$ErrorActionPreference = "Stop"

# Constants
$HostName = "com.chromemcp.nativehost"

Write-Host "Unregistering Native Messaging Host for Chrome and Edge..." -ForegroundColor Cyan

# Browser configurations
$browsers = @(
    @{
        Name = "Chrome"
        ManifestDir = Join-Path $env:APPDATA "Google\Chrome\NativeMessagingHosts"
        RegPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
    },
    @{
        Name = "Edge"
        ManifestDir = Join-Path $env:APPDATA "Microsoft\Edge\NativeMessagingHosts"
        RegPath = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
    }
)

foreach ($browser in $browsers) {
    Write-Host ""
    Write-Host "Processing $($browser.Name)..." -ForegroundColor Cyan
    
    $ManifestPath = Join-Path $browser.ManifestDir "$HostName.json"
    
    # Remove manifest file
    if (Test-Path $ManifestPath) {
        Remove-Item -Path $ManifestPath -Force
        Write-Host "  Manifest file removed" -ForegroundColor Green
    } else {
        Write-Host "  Manifest file not found (already removed)" -ForegroundColor Yellow
    }
    
    # Remove registry subkey
    try {
        if (Test-Path $browser.RegPath) {
            Remove-Item -Path $browser.RegPath -Force
            Write-Host "  Registry subkey removed" -ForegroundColor Green
        } else {
            Write-Host "  Registry subkey not found (already removed)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  Failed to remove registry subkey: $_" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Native Messaging Host unregistered successfully for Chrome and Edge!" -ForegroundColor Green
Write-Host "Restart browsers for changes to take effect." -ForegroundColor Yellow
