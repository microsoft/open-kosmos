# Combined Native Server Registration Script for Chrome and Edge
# This script registers the Native Messaging host so both Chrome and Edge extensions can communicate with it

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

Write-Host "Registering Native Messaging Host for Chrome and Edge..." -ForegroundColor Cyan
Write-Host "  User Data Directory: $UserDataDir" -ForegroundColor Gray
Write-Host "  Run Host Path: $RunHostPath" -ForegroundColor Gray

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
    Write-Host "  Manifest Path: $ManifestPath" -ForegroundColor Gray
    
    # Ensure manifest directory exists
    if (-not (Test-Path $browser.ManifestDir)) {
        New-Item -Path $browser.ManifestDir -ItemType Directory -Force | Out-Null
        Write-Host "  Created manifest directory" -ForegroundColor Green
    }
    
    # Write manifest file
    $Manifest | ConvertTo-Json -Depth 10 | Out-File -FilePath $ManifestPath -Encoding UTF8
    Write-Host "  Manifest file written" -ForegroundColor Green
    
    # Ensure parent key exists
    $ParentPath = Split-Path $browser.RegPath -Parent
    if (-not (Test-Path $ParentPath)) {
        New-Item -Path $ParentPath -Force | Out-Null
        Write-Host "  Created parent registry key" -ForegroundColor Green
    }
    
    # Create registry subkey (this also sets the default value)
    New-Item -Path $browser.RegPath -Value $ManifestPath -Force | Out-Null
    Write-Host "  Registry subkey created: $($browser.RegPath)" -ForegroundColor Green
}

Write-Host ""
Write-Host "Native Messaging Host registered successfully for Chrome and Edge!" -ForegroundColor Green
Write-Host "Restart browsers for changes to take effect." -ForegroundColor Yellow
