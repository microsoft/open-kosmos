# Chrome Extension Auto-Register Script
# Adds extension configurations to both HKLM and HKCU registry

# Load extensions from JSON file
$jsonPath = Join-Path $PSScriptRoot "extensions.json"
if (-not (Test-Path $jsonPath)) {
    Write-Error "extensions.json not found at: $jsonPath"
    exit 1
}

$extensionsData = Get-Content $jsonPath -Raw | ConvertFrom-Json
$extensions = $extensionsData | ForEach-Object {
    @{
        Name = $_.id
        Data = ($_.config | ConvertTo-Json -Compress -Depth 10)
    }
}

# Registry paths
$paths = @(
    "HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionSettings",
    "HKCU:\Software\Policies\Google\Chrome\ExtensionSettings"
)

# Create registry keys if they don't exist and add values
foreach ($path in $paths) {
    Write-Host "Processing: $path" -ForegroundColor Cyan
    
    # Ensure parent keys exist
    if (-not (Test-Path $path)) {
        New-Item -Path $path -Force | Out-Null
        Write-Host "  Created registry key" -ForegroundColor Green
    }
    
    # Add each extension
    foreach ($ext in $extensions) {
        Set-ItemProperty -Path $path -Name $ext.Name -Value $ext.Data -Type String
        Write-Host "  Added: $($ext.Name)" -ForegroundColor Green
    }
}

Write-Host "`nDone! Restart Chrome for changes to take effect." -ForegroundColor Yellow
