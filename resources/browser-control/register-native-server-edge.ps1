# Native Server Registration Script for Edge Native Messaging
# This script registers the Native Messaging host so Edge Extension can communicate with it

$ErrorActionPreference = "Stop"

# Constants
$HostName = "com.chromemcp.nativehost"
$ExtensionId = "oopmjmifghgbliienphmofbfffhhgcjl"

# Get User Data directory from environment variable (set by Kosmos main process)
# Fallback to default kosmos-app location if not set
$UserDataDir = if ($env:KOSMOS_USER_DATA_DIR) { 
    $env:KOSMOS_USER_DATA_DIR 
} else { 
    Join-Path $env:APPDATA "kosmos-app" 
}

# Paths - native-server is in assets/native-server
$NativeServerDir = Join-Path $UserDataDir "assets\native-server"
$RunHostPath = Join-Path $NativeServerDir "dist\run_host.bat"
$ManifestDir = Join-Path $env:APPDATA "Microsoft\Edge\NativeMessagingHosts"
$ManifestPath = Join-Path $ManifestDir "$HostName.json"

Write-Host "Registering Native Messaging Host for Edge..." -ForegroundColor Cyan
Write-Host "  User Data Directory: $UserDataDir" -ForegroundColor Gray
Write-Host "  Run Host Path: $RunHostPath" -ForegroundColor Gray
Write-Host "  Manifest Path: $ManifestPath" -ForegroundColor Gray

# Verify run_host.bat exists
if (-not (Test-Path $RunHostPath)) {
    Write-Host "ERROR: run_host.bat not found at: $RunHostPath" -ForegroundColor Red
    exit 1
}

# Create manifest content
$Manifest = @{
    name = $HostName
    description = "Node.js Host for Browser Bridge Extension"
    path = $RunHostPath
    type = "stdio"
    allowed_origins = @("chrome-extension://$ExtensionId/")
}

# Ensure manifest directory exists
if (-not (Test-Path $ManifestDir)) {
    New-Item -Path $ManifestDir -ItemType Directory -Force | Out-Null
    Write-Host "  Created manifest directory" -ForegroundColor Green
}

# Write manifest file
$Manifest | ConvertTo-Json -Depth 10 | Out-File -FilePath $ManifestPath -Encoding UTF8
Write-Host "  Manifest file written" -ForegroundColor Green

# Register in Windows Registry (HKCU - user level, no admin required)
# Edge requires a subkey with the host name, and the (Default) value pointing to the manifest
$RegPath = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"

# Ensure parent key exists
$ParentPath = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts"
if (-not (Test-Path $ParentPath)) {
    New-Item -Path $ParentPath -Force | Out-Null
    Write-Host "  Created parent registry key" -ForegroundColor Green
}

# Create registry subkey (this also sets the default value)
New-Item -Path $RegPath -Value $ManifestPath -Force | Out-Null
Write-Host "  Registry subkey created: $RegPath" -ForegroundColor Green

Write-Host ""
Write-Host "Native Messaging Host registered successfully!" -ForegroundColor Green
Write-Host "Restart Edge for changes to take effect." -ForegroundColor Yellow
