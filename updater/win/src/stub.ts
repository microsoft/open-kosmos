/**
 * OpenKosmos Windows Updater Stub
 * 
 * Lightweight Windows updater - single file mode
 * PowerShell UI script is embedded and extracted at runtime
 * 
 * Features:
 * - Single exe file, no external dependencies
 * - Not an Electron app, instant startup
 * - Native Windows Forms UI
 * - Progress bar display
 * - Complete logging
 * 
 * Usage: updater <zip_path> <install_path>
 * (Compatible with Go-based updater calling convention)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, execSync } from 'child_process';

// Log file path (same as Go version)
const LOG_FILE = path.join(os.tmpdir(), 'openkosmos-updater.log');

/**
 * Embedded PowerShell UI Script
 * This script is written to a temp file at runtime
 */
const POWERSHELL_UI_SCRIPT = `
# PowerShell Updater UI Script - Embedded Version
# Native Windows Forms Progress Bar Interface

param(
    [Parameter(Mandatory=$true)]
    [string]$ZipPath,
    
    [Parameter(Mandatory=$true)]
    [string]$InstallPath,
    
    [string]$AppName = "OpenKosmos",
    
    [switch]$TestUI
)

# Load Windows Forms
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Set DPI awareness
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class DPIHelper {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
}
'@
[DPIHelper]::SetProcessDPIAware() | Out-Null

# Log file path
$script:logPath = Join-Path $env:TEMP "openkosmos-updater.log"

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] $Message"
    Add-Content -Path $script:logPath -Value $logMessage -ErrorAction SilentlyContinue
    Write-Host $logMessage
}

# Global UI elements
$script:form = $null
$script:statusLabel = $null
$script:progressBar = $null
$script:percentLabel = $null
$script:footerLabel = $null

# Create main window
function Initialize-UpdaterForm {
    $fontFamily = "Segoe UI"
    
    # Layout constants - increased for high DPI support
    $paddingH = 28
    $paddingTop = 24
    $paddingBottom = 28
    $gap = 16
    $contentWidth = 380
    $statusHeight = 32
    $progressHeight = 28
    $percentHeight = 28
    $footerHeight = 28
    
    # Calculate positions
    $statusY = $paddingTop
    $progressY = $statusY + $statusHeight + $gap
    $percentY = $progressY + $progressHeight + $gap
    $footerY = $percentY + $percentHeight + $gap
    
    # Calculate window size
    $windowWidth = $contentWidth + ($paddingH * 2)
    $clientHeight = $footerY + $footerHeight + $paddingBottom
    
    $script:form = New-Object System.Windows.Forms.Form
    $script:form.Text = "$AppName Updater"
    $script:form.ClientSize = New-Object System.Drawing.Size($windowWidth, $clientHeight)
    $script:form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $script:form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
    $script:form.MaximizeBox = $false
    $script:form.MinimizeBox = $false
    $script:form.TopMost = $true
    $script:form.BackColor = [System.Drawing.Color]::White
    $script:form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi
    $script:form.Icon = [System.Drawing.SystemIcons]::Application
    
    # Status label
    $script:statusLabel = New-Object System.Windows.Forms.Label
    $script:statusLabel.Location = New-Object System.Drawing.Point($paddingH, $statusY)
    $script:statusLabel.Size = New-Object System.Drawing.Size($contentWidth, $statusHeight)
    $script:statusLabel.Text = "Preparing..."
    $script:statusLabel.Font = New-Object System.Drawing.Font($fontFamily, 10)
    $script:statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(60, 60, 60)
    $script:statusLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
    $script:statusLabel.AutoSize = $false
    $script:form.Controls.Add($script:statusLabel)
    
    # Progress bar
    $script:progressBar = New-Object System.Windows.Forms.ProgressBar
    $script:progressBar.Location = New-Object System.Drawing.Point($paddingH, $progressY)
    $script:progressBar.Size = New-Object System.Drawing.Size($contentWidth, $progressHeight)
    $script:progressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
    $script:progressBar.Minimum = 0
    $script:progressBar.Maximum = 100
    $script:progressBar.Value = 0
    $script:form.Controls.Add($script:progressBar)
    
    # Percent label
    $script:percentLabel = New-Object System.Windows.Forms.Label
    $script:percentLabel.Location = New-Object System.Drawing.Point($paddingH, $percentY)
    $script:percentLabel.Size = New-Object System.Drawing.Size($contentWidth, $percentHeight)
    $script:percentLabel.Text = "0%"
    $script:percentLabel.Font = New-Object System.Drawing.Font($fontFamily, 9)
    $script:percentLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
    $script:percentLabel.ForeColor = [System.Drawing.Color]::FromArgb(100, 100, 100)
    $script:percentLabel.AutoSize = $false
    $script:form.Controls.Add($script:percentLabel)
    
    # Footer label
    $script:footerLabel = New-Object System.Windows.Forms.Label
    $script:footerLabel.Location = New-Object System.Drawing.Point($paddingH, $footerY)
    $script:footerLabel.Size = New-Object System.Drawing.Size($contentWidth, $footerHeight)
    $script:footerLabel.Text = "Please do not close this window"
    $script:footerLabel.Font = New-Object System.Drawing.Font($fontFamily, 8)
    $script:footerLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
    $script:footerLabel.ForeColor = [System.Drawing.Color]::FromArgb(150, 150, 150)
    $script:footerLabel.AutoSize = $false
    $script:form.Controls.Add($script:footerLabel)
}

# Update progress
function Update-Progress {
    param([int]$Percent, [string]$Status)
    $safePercent = [Math]::Min($Percent, 100)
    $script:progressBar.Value = $safePercent
    $script:percentLabel.Text = "$safePercent%"
    if ($Status) { $script:statusLabel.Text = $Status }
    [System.Windows.Forms.Application]::DoEvents()
}

# Show error dialog
function Show-ErrorDialog {
    param([string]$Message)
    [System.Windows.Forms.MessageBox]::Show($Message, "$AppName Updater - Error", 
        [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
}

# CRITICAL: Convert short path (8.3 format like V-FUCH~1) to long path (v-fuchenyu)
# Windows $env:TEMP often returns short paths, but file operations return long paths
# This mismatch causes path calculations to fail
function Get-LongPath {
    param([string]$Path)
    if ([string]::IsNullOrEmpty($Path)) { return $Path }
    try {
        if (Test-Path $Path) {
            return (Get-Item -LiteralPath $Path).FullName
        }
        # For paths that don't exist yet, resolve the parent and append the leaf
        $parent = Split-Path $Path -Parent
        $leaf = Split-Path $Path -Leaf
        if ($parent -and (Test-Path $parent)) {
            return Join-Path (Get-Item -LiteralPath $parent).FullName $leaf
        }
    } catch { }
    return $Path
}

# Extract ZIP file
function Expand-UpdateZip {
    param([string]$ZipPath, [string]$DestPath)
    # Resolve paths to long format to avoid 8.3 short path issues
    $ZipPath = Get-LongPath $ZipPath
    Write-Log "Starting extraction: $ZipPath -> $DestPath"
    try {
        if (Test-Path $DestPath) { Remove-Item -Path $DestPath -Recurse -Force -ErrorAction SilentlyContinue }
        New-Item -ItemType Directory -Path $DestPath -Force | Out-Null
        # After creating, resolve to long path
        $DestPath = Get-LongPath $DestPath
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
        $totalEntries = $zip.Entries.Count
        $processedEntries = 0
        foreach ($entry in $zip.Entries) {
            $destFilePath = Join-Path $DestPath $entry.FullName
            if ($entry.FullName.EndsWith('/')) {
                if (-not (Test-Path $destFilePath)) { New-Item -ItemType Directory -Path $destFilePath -Force | Out-Null }
            } else {
                $destDir = Split-Path $destFilePath -Parent
                if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
                [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destFilePath, $true)
            }
            $processedEntries++
            $percent = [Math]::Floor(($processedEntries / $totalEntries) * 40) + 10
            Update-Progress -Percent $percent -Status "Extracting: $($entry.Name)"
        }
        $zip.Dispose()
        Write-Log "Extraction completed"
        return $true
    } catch {
        Write-Log "Extraction failed: $_"
        return $false
    }
}

# Copy files
function Copy-UpdateFiles {
    param([string]$SourcePath, [string]$DestPath)
    Write-Log "Starting file copy: $SourcePath -> $DestPath"
    try {
        # CRITICAL: Resolve to long path to avoid short path (8.3) vs long path mismatch
        # $env:TEMP may return short path like "V-FUCH~1" but Get-ChildItem returns long path "v-fuchenyu"
        # This mismatch causes Substring() to calculate wrong relative paths
        $SourcePath = (Get-LongPath $SourcePath).TrimEnd('\\')
        $DestPath = Get-LongPath $DestPath
        
        $files = Get-ChildItem -Path $SourcePath -Recurse -File
        $totalFiles = $files.Count
        $processedFiles = 0
        foreach ($file in $files) {
            $relativePath = $file.FullName.Substring($SourcePath.Length + 1)
            $destFilePath = Join-Path $DestPath $relativePath
            $destDir = Split-Path $destFilePath -Parent
            if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
            try {
                Copy-Item -Path $file.FullName -Destination $destFilePath -Force
            } catch {
                $backupPath = "$destFilePath.old"
                if (Test-Path $destFilePath) { Move-Item -Path $destFilePath -Destination $backupPath -Force -ErrorAction SilentlyContinue }
                Copy-Item -Path $file.FullName -Destination $destFilePath -Force
            }
            $processedFiles++
            $percent = [Math]::Floor(($processedFiles / $totalFiles) * 40) + 50
            if ($processedFiles % 10 -eq 0 -or $processedFiles -eq $totalFiles) {
                Update-Progress -Percent $percent -Status "Copying: $relativePath"
            }
        }
        Write-Log "File copy completed"
        return $true
    } catch {
        Write-Log "File copy failed: $_"
        return $false
    }
}

# Clean up temporary files
function Remove-TempFiles {
    param([string]$TempPath)
    Update-Progress -Percent 95 -Status "Cleaning up temporary files..."
    try {
        # Resolve to long path for consistent operations
        $TempPath = Get-LongPath $TempPath
        $resolvedInstallPath = Get-LongPath $InstallPath
        if (Test-Path $TempPath) { Remove-Item -LiteralPath $TempPath -Recurse -Force -ErrorAction SilentlyContinue }
        Get-ChildItem -Path $resolvedInstallPath -Filter "*.old" -Recurse -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
        Write-Log "Temporary files cleaned up"
    } catch {
        Write-Log "Temporary file cleanup failed (non-fatal): $_"
    }
}

# Launch application
function Start-UpdatedApp {
    param([string]$InstallPath, [string]$AppName)
    Write-Log "Attempting to launch application..."
    # Resolve to long path
    $InstallPath = Get-LongPath $InstallPath
    $exePatterns = @("$AppName.exe", "*.exe")
    foreach ($pattern in $exePatterns) {
        $exeFiles = Get-ChildItem -Path $InstallPath -Filter $pattern -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch "Uninstall|unins" }
        if ($exeFiles) {
            $exePath = $exeFiles[0].FullName
            Write-Log "Launching: $exePath"
            Start-Process -FilePath $exePath
            return $true
        }
    }
    Write-Log "Executable not found"
    return $false
}

# Main update process
function Start-UpdateProcess {
    Write-Log "=========================================="
    Write-Log "Starting update process"
    Write-Log "ZIP: $ZipPath"
    Write-Log "Install path: $InstallPath"
    Write-Log "=========================================="
    
    Update-Progress -Percent 5 -Status "Validating update package..."
    if (-not (Test-Path $ZipPath)) {
        Write-Log "Error: ZIP file does not exist"
        Show-ErrorDialog "Update package not found: $ZipPath"
        return $false
    }
    
    # CRITICAL: Resolve TEMP to long path to avoid 8.3 short path issues
    $tempBase = Get-LongPath $env:TEMP
    $tempDir = Join-Path $tempBase "openkosmos-update-$(Get-Date -Format 'yyyyMMddHHmmss')"
    Update-Progress -Percent 10 -Status "Preparing update environment..."
    
    try {
        $extractResult = Expand-UpdateZip -ZipPath $ZipPath -DestPath $tempDir
        if (-not $extractResult) { Show-ErrorDialog "Failed to extract update package"; return $false }
        
        Update-Progress -Percent 50 -Status "Waiting for application to exit..."
        Start-Sleep -Seconds 2
        
        $copyResult = Copy-UpdateFiles -SourcePath $tempDir -DestPath $InstallPath
        if (-not $copyResult) { Show-ErrorDialog "Failed to copy update files"; return $false }
        
        Remove-TempFiles -TempPath $tempDir
        Update-Progress -Percent 100 -Status "Update completed!"
        Write-Log "Update process completed"
        return $true
    } catch {
        Write-Log "Update failed: $_"
        Show-ErrorDialog "Update failed: $_"
        if (Test-Path $tempDir) { Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue }
        return $false
    }
}

# ==================== Main Entry Point ====================
Write-Log "Updater UI starting"
Write-Log "Parameters: ZipPath=$ZipPath, InstallPath=$InstallPath, TestUI=$TestUI"

Initialize-UpdaterForm

$script:form.Add_Shown({
    $script:form.Activate()
    [System.Windows.Forms.Application]::DoEvents()
    
    if ($TestUI) {
        @(
            @{ Percent = 10; Status = "Validating update package..." },
            @{ Percent = 30; Status = "Extracting: app.asar" },
            @{ Percent = 50; Status = "Waiting for application to exit..." },
            @{ Percent = 70; Status = "Copying: resources/app.asar" },
            @{ Percent = 90; Status = "Cleaning up temporary files..." },
            @{ Percent = 100; Status = "Update completed!" }
        ) | ForEach-Object { Update-Progress -Percent $_.Percent -Status $_.Status; Start-Sleep -Milliseconds 800 }
        Start-Sleep -Seconds 1
    } else {
        $result = Start-UpdateProcess
        if ($result) {
            Update-Progress -Percent 100 -Status "Launching $AppName..."
            $script:footerLabel.Text = "Application will start shortly"
            [System.Windows.Forms.Application]::DoEvents()
            Start-Sleep -Milliseconds 500
            $script:form.Close()
            Start-UpdatedApp -InstallPath $InstallPath -AppName $AppName
            return
        }
    }
    $script:form.Close()
})

[void]$script:form.ShowDialog()
Write-Log "Updater UI exiting"
exit 0
`;

/**
 * Write log (only to file, no console output to avoid creating console window)
 */
function log(message: string): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  
  // Do not use console.log to avoid creating a console window in GUI mode
  // console.log(logMessage);
  
  try {
    fs.appendFileSync(LOG_FILE, logMessage + '\n');
  } catch (err) {
    // Ignore log write errors
  }
}

/**
 * Get embedded script as temp file
 */
function getEmbeddedScriptPath(): string {
  const tempScriptPath = path.join(os.tmpdir(), 'openkosmos-updater-ui.ps1');
  
  try {
    // Write embedded script to temp file
    fs.writeFileSync(tempScriptPath, POWERSHELL_UI_SCRIPT, { encoding: 'utf8' });
    log(`Embedded script written to: ${tempScriptPath}`);
    return tempScriptPath;
  } catch (err) {
    throw new Error(`Failed to write embedded script: ${err}`);
  }
}

/**
 * Clean up temp script file
 */
function cleanupTempScript(scriptPath: string): void {
  try {
    if (fs.existsSync(scriptPath)) {
      fs.unlinkSync(scriptPath);
      log(`Temp script cleaned up: ${scriptPath}`);
    }
  } catch (err) {
    log(`Warning: Failed to cleanup temp script: ${err}`);
  }
}

/**
 * Check if PowerShell is available
 */
function checkPowerShell(): boolean {
  try {
    execSync('powershell -Command "exit 0"', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Update options (internal use)
 */
interface UpdateOptions {
  appName?: string;
  testUI?: boolean;
}

/**
 * Run PowerShell updater script using VBScript launcher (completely hidden console)
 */
function runPowerShellUpdater(zipPath: string, installPath: string, options: UpdateOptions = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    // Get embedded script as temp file
    const scriptPath = getEmbeddedScriptPath();
    log(`Using embedded script: ${scriptPath}`);
    
    // Build PowerShell argument string
    let psArgs = `-ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File "${scriptPath}" -ZipPath "${zipPath}" -InstallPath "${installPath}"`;
    if (options.appName) {
      psArgs += ` -AppName "${options.appName}"`;
    }
    if (options.testUI) {
      psArgs += ' -TestUI';
    }
    
    log(`Running PowerShell updater with args: ${psArgs}`);
    
    // Use VBScript as the launcher to completely hide the console window
    // VBScript's Run method: second parameter 0 = hidden window
    const vbsPath = path.join(os.tmpdir(), 'openkosmos-updater-launcher.vbs');
    const vbsContent = `
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe ${psArgs.replace(/"/g, '""')}", 0, True
`;
    
    try {
      fs.writeFileSync(vbsPath, vbsContent, { encoding: 'utf8' });
      log(`VBS launcher written to: ${vbsPath}`);
    } catch (err) {
      log(`Failed to write VBS launcher: ${err}`);
      reject(err);
      return;
    }
    
    // Use wscript to execute VBS (wscript itself does not show a console)
    const wscript = spawn('wscript.exe', [vbsPath], {
      stdio: 'ignore',
      windowsHide: true,
      detached: true,
    });
    
    wscript.unref();
    
    wscript.on('error', (err) => {
      log(`WScript error: ${err.message}`);
      cleanupTempScript(scriptPath);
      // Clean up VBS file
      try { fs.unlinkSync(vbsPath); } catch {}
      reject(err);
    });

    wscript.on('close', (code) => {
      log(`WScript exited with code: ${code}`);
      cleanupTempScript(scriptPath);
      // Clean up VBS file
      try { fs.unlinkSync(vbsPath); } catch {}
      resolve(code || 0);
    });
  });
}

/**
 * Run silent update using built-in Node.js logic (no UI)
 */
async function runSilentUpdate(zipPath: string, installPath: string): Promise<boolean> {
  const extractZip = require('extract-zip');
  
  log('Running silent update...');
  
  try {
    // Validate ZIP file
    if (!fs.existsSync(zipPath)) {
      throw new Error(`ZIP file not found: ${zipPath}`);
    }
    
    // Create temporary directory
    const tempDir = path.join(os.tmpdir(), `openkosmos-update-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    log(`Extracting to: ${tempDir}`);
    
    // Extract
    await extractZip(zipPath, { dir: tempDir });
    
    log('Extraction complete');
    
    // Wait for main app to exit
    await sleep(2000);
    
    // Copy files
    log(`Copying files to: ${installPath}`);
    await copyDirectory(tempDir, installPath);
    
    // Cleanup
    log('Cleaning up...');
    fs.rmSync(tempDir, { recursive: true, force: true });
    
    log('Silent update complete');
    return true;
  } catch (err) {
    log(`Silent update failed: ${err}`);
    return false;
  }
}

/**
 * Recursively copy directory
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
  // Ensure destination exists
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch (err) {
        // Try renaming old file first
        const backupPath = destPath + '.old';
        try {
          if (fs.existsSync(destPath)) {
            fs.renameSync(destPath, backupPath);
          }
          fs.copyFileSync(srcPath, destPath);
        } catch (innerErr) {
          log(`Warning: Could not copy ${entry.name}: ${innerErr}`);
        }
      }
    }
  }
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Launch updated application
 */
function launchApp(installPath: string, appName: string = 'OpenKosmos'): void {
  try {
    const files = fs.readdirSync(installPath);
    const possibleExes = [
      path.join(installPath, `${appName}.exe`),
      ...files
        .filter(f => f.endsWith('.exe') && !f.toLowerCase().includes('uninstall'))
        .map(f => path.join(installPath, f))
    ];
    
    for (const exePath of possibleExes) {
      if (fs.existsSync(exePath)) {
        log(`Launching: ${exePath}`);
        spawn(exePath, [], {
          detached: true,
          stdio: 'ignore',
        }).unref();
        return;
      }
    }
  } catch (err) {
    log(`Warning: Could not list directory: ${err}`);
  }
  
  log('Warning: Could not find executable to launch');
}

/**
 * Detect application name from install path
 */
function detectAppName(installPath: string): string {
  // Try to detect from path
  const dirName = path.basename(installPath).toLowerCase();
  
    return 'OpenKosmos';
  }
  if (dirName.includes('openkosmos')) {
    return 'OpenKosmos';
  }
  
  // Default
  return 'OpenKosmos';
}

/**
 * Main function
 *
 * Usage: updater <zip_path> <install_path>
 * (Compatible with Go-based updater)
 *
 * To avoid console window flicker, stub.exe immediately creates a VBScript launcher and exits.
 * VBScript launches the PowerShell script in hidden-window mode.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  // Simple argument parsing (compatible with Go updater)
  // Usage: updater <zip_path> <install_path>
  if (args.length < 2) {
    console.error('Usage: updater <zip_path> <install_path>');
    console.error('');
    console.error('Arguments:');
    console.error('  zip_path      Path to the update ZIP file');
    console.error('  install_path  Path to the installation directory');
    process.exit(1);
  }
  
  const zipPath = args[0];
  const installPath = args[1];
  
  // Write to log (do not use console.log to avoid console output)
  log('==========================================');
  log('OpenKosmos Updater Starting (Single-File Mode)');
  log(`Platform: ${os.platform()} ${os.arch()}`);
  log(`Node: ${process.version}`);
  log(`Args: ${process.argv.slice(2).join(' ')}`);
  log('==========================================');
  
  // Detect app name from install path
  const appName = detectAppName(installPath);
  log(`Detected app name: ${appName}`);
  
  // Validate ZIP file
  if (!fs.existsSync(zipPath)) {
    log(`Error: ZIP file not found: ${zipPath}`);
    process.exit(1);
  }
  
  try {
    // Write PowerShell script to a temp file
    const scriptPath = getEmbeddedScriptPath();
    log(`PowerShell script written to: ${scriptPath}`);

    // Build PowerShell arguments
    const psArgs = `-ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File "${scriptPath}" -ZipPath "${zipPath}" -InstallPath "${installPath}" -AppName "${appName}"`;

    // Create VBScript launcher
    // WshShell.Run parameters: command, window-style (0=hidden), wait (True=wait for completion)
    const vbsPath = path.join(os.tmpdir(), `openkosmos-updater-${Date.now()}.vbs`);
    const vbsContent = `Set WshShell = CreateObject("WScript.Shell")\r\nWshShell.Run "powershell.exe ${psArgs.replace(/"/g, '""')}", 0, True\r\n' Cleanup\r\nSet fso = CreateObject("Scripting.FileSystemObject")\r\nfso.DeleteFile "${scriptPath.replace(/\\/g, '\\\\')}", True\r\nfso.DeleteFile WScript.ScriptFullName, True`;
    
    fs.writeFileSync(vbsPath, vbsContent, { encoding: 'utf8' });
    log(`VBS launcher written to: ${vbsPath}`);
    
    // Use wscript to execute VBS (no console window at all)
    // detached + unref lets wscript run independently; stub.exe exits immediately
    const wscript = spawn('wscript.exe', [vbsPath], {
      stdio: 'ignore',
      windowsHide: true,
      detached: true,
    });
    
    wscript.unref();
    
    log('VBS launcher started, stub exiting immediately');

    // Exit immediately to minimize console window presence time
    process.exit(0);
  } catch (err) {
    log(`Fatal error: ${err}`);
    process.exit(1);
  }
}

// Run main function
main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
