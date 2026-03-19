# Native Server Unregistration Script
# Removes the Native Messaging host registration

$ErrorActionPreference = "Stop"

# Constants
$HostName = "com.chromemcp.nativehost"

# Paths
$ManifestDir = Join-Path $env:APPDATA "Google\Chrome\NativeMessagingHosts"
$ManifestPath = Join-Path $ManifestDir "$HostName.json"
$RegPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts"

Write-Host "Unregistering Native Messaging Host..." -ForegroundColor Cyan

# Remove manifest file
if (Test-Path $ManifestPath) {
    Remove-Item -Path $ManifestPath -Force
    Write-Host "  Manifest file removed" -ForegroundColor Green
} else {
    Write-Host "  Manifest file not found (already removed)" -ForegroundColor Yellow
}

# Remove registry subkey
$RegSubkeyPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
try {
    if (Test-Path $RegSubkeyPath) {
        Remove-Item -Path $RegSubkeyPath -Force
        Write-Host "  Registry subkey removed" -ForegroundColor Green
    } else {
        Write-Host "  Registry subkey not found (already removed)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  Failed to remove registry subkey: $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Native Messaging Host unregistered successfully!" -ForegroundColor Green
Write-Host "Restart Chrome for changes to take effect." -ForegroundColor Yellow
