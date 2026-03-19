# Chrome Extension Auto-Unregister Script
# Removes extension configurations from both HKLM and HKCU registry

# Load extensions from JSON file
$jsonPath = Join-Path $PSScriptRoot "extensions.json"
if (-not (Test-Path $jsonPath)) {
    Write-Error "extensions.json not found at: $jsonPath"
    exit 1
}

$extensionsData = Get-Content $jsonPath -Raw | ConvertFrom-Json
$extensionIds = $extensionsData | ForEach-Object { $_.id }

# Registry paths
$paths = @(
    "HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionSettings",
    "HKCU:\Software\Policies\Google\Chrome\ExtensionSettings"
)

# Remove extension values from registry
foreach ($path in $paths) {
    Write-Host "Processing: $path" -ForegroundColor Cyan
    
    if (Test-Path $path) {
        foreach ($extId in $extensionIds) {
            try {
                Remove-ItemProperty -Path $path -Name $extId -ErrorAction SilentlyContinue
                Write-Host "  Removed: $extId" -ForegroundColor Green
            } catch {
                Write-Host "  Not found or already removed: $extId" -ForegroundColor Yellow
            }
        }
    } else {
        Write-Host "  Registry key does not exist, skipping" -ForegroundColor Yellow
    }
}

Write-Host "`nDone! Restart Chrome for changes to take effect." -ForegroundColor Yellow
