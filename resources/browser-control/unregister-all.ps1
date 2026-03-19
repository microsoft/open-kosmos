# Combined Extension Unregister Script for Chrome and Edge
# Removes extension configurations from both HKLM and HKCU registry for both browsers

# Load extensions from JSON file
$jsonPath = Join-Path $PSScriptRoot "extensions.json"
if (-not (Test-Path $jsonPath)) {
    Write-Error "extensions.json not found at: $jsonPath"
    exit 1
}

$extensionsData = Get-Content $jsonPath -Raw | ConvertFrom-Json
$extensionIds = $extensionsData | ForEach-Object { $_.id }

# Registry paths for both Chrome and Edge
$paths = @(
    # Chrome
    "HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionSettings",
    "HKCU:\Software\Policies\Google\Chrome\ExtensionSettings",
    # Edge
    "HKLM:\SOFTWARE\Policies\Microsoft\Edge\ExtensionSettings",
    "HKCU:\Software\Policies\Microsoft\Edge\ExtensionSettings"
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

Write-Host "`nDone! Restart Chrome and Edge for changes to take effect." -ForegroundColor Yellow
