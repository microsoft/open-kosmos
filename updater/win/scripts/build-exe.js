/**
 * Build script for OpenKosmos Updater Stub
 * 
 * Compiles TypeScript and packages into standalone Windows executables
 * Output files: updater-win-x64.exe, updater-win-arm64.exe
 * Output location: resources/updater/ (same as Go version)
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const RELEASE_DIR = path.join(ROOT_DIR, 'release');
const SCRIPTS_DIR = path.join(ROOT_DIR, 'scripts');
const RESOURCES_DIR = path.join(ROOT_DIR, '..', 'resources', 'updater');

// Colored output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function exec(command, options = {}) {
  log(`> ${command}`, 'cyan');
  return execSync(command, { 
    stdio: 'inherit', 
    cwd: ROOT_DIR,
    ...options 
  });
}

async function build() {
  log('\n========================================', 'green');
  log('  OpenKosmos Updater Stub Build Script', 'green');
  log('========================================\n', 'green');

  // 1. Ensure directories exist
  log('Creating directories...', 'yellow');
  [DIST_DIR, RELEASE_DIR, RESOURCES_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  // 2. Compile TypeScript
  log('\nCompiling TypeScript...', 'yellow');
  exec('npx tsc');

  // 3. Single-file mode - PowerShell script is embedded in TypeScript code, no copy needed
  log('\nSingle-file mode: PowerShell script is embedded', 'yellow');

  // 4. Check if pkg is installed
  let hasPkg = false;
  try {
    execSync('npx pkg --version', { stdio: 'pipe' });
    hasPkg = true;
  } catch {
    log('\nInstalling pkg...', 'yellow');
    exec('npm install -g pkg');
    hasPkg = true;
  }

  if (hasPkg) {
    // 5. Package with pkg
    log('\nPackaging with pkg...', 'yellow');
    
    const targets = [
      { target: 'node18-win-x64', output: 'updater-win-x64.exe' },
      { target: 'node18-win-arm64', output: 'updater-win-arm64.exe' },
    ];

    for (const { target, output } of targets) {
      log(`\nBuilding ${output}...`, 'yellow');
      
      const outputPath = path.join(RELEASE_DIR, output);
      
      try {
        exec(`npx pkg dist/stub.js --target ${target} --output "${outputPath}"`);
        
        // 6. Change exe subsystem from Console to Windows GUI (hides console window)
        log(`Converting ${output} to Windows GUI subsystem...`, 'yellow');
        try {
          // Use PowerShell to modify the Subsystem field in the PE header
          // Subsystem offset is in the PE header; value 3 = CONSOLE, value 2 = WINDOWS GUI
          const patchScript = `
            $exePath = '${outputPath.replace(/\\/g, '\\\\')}';
            $bytes = [System.IO.File]::ReadAllBytes($exePath);
            # Find PE signature offset (PE header offset stored at 0x3C)
            $peOffset = [BitConverter]::ToInt32($bytes, 0x3C);
            # Subsystem is at PE header + 0x5C (for PE32+/64-bit) or + 0x44 (for PE32/32-bit)
            # Optional header size magic is at PE + 0x18
            $optionalHeaderOffset = $peOffset + 0x18;
            $magic = [BitConverter]::ToUInt16($bytes, $optionalHeaderOffset);
            if ($magic -eq 0x20b) {
              # PE32+ (64-bit)
              $subsystemOffset = $peOffset + 0x5C;
            } else {
              # PE32 (32-bit)
              $subsystemOffset = $peOffset + 0x44 + 0x14;
            }
            # Check current value
            $currentSubsystem = [BitConverter]::ToUInt16($bytes, $subsystemOffset);
            Write-Host "Current subsystem: $currentSubsystem (3=CONSOLE, 2=GUI)";
            # Change to Windows GUI (2)
            $bytes[$subsystemOffset] = 2;
            $bytes[$subsystemOffset + 1] = 0;
            [System.IO.File]::WriteAllBytes($exePath, $bytes);
            Write-Host "Changed to GUI subsystem (2)";
          `;
          execSync(`powershell -Command "${patchScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, { 
            stdio: 'inherit',
            cwd: ROOT_DIR 
          });
          log(`✅ ${output} converted to GUI subsystem`, 'green');
        } catch (patchErr) {
          log(`⚠️ Failed to patch subsystem (console window may appear): ${patchErr.message}`, 'yellow');
        }
        
        // Copy to resources directory
        const resourcePath = path.join(RESOURCES_DIR, output);
        fs.copyFileSync(outputPath, resourcePath);
        
        log(`✅ ${output} built successfully`, 'green');
      } catch (err) {
        log(`❌ Failed to build ${output}: ${err.message}`, 'red');
      }
    }

    // Single-file mode: no need to copy scripts
    log('\nSingle-file mode: no external scripts needed', 'yellow');
  }

  // 7. Create standalone package (Node.js + script)
  log('\nCreating standalone package...', 'yellow');
  
  const standaloneDir = path.join(RELEASE_DIR, 'standalone');
  if (!fs.existsSync(standaloneDir)) {
    fs.mkdirSync(standaloneDir, { recursive: true });
  }
  
  // Copy dist files
  fs.cpSync(DIST_DIR, path.join(standaloneDir, 'dist'), { recursive: true });

  // Create run.bat
  const runBat = `@echo off
REM OpenKosmos Updater Stub Runner
REM Requires Node.js to be installed on the system

if "%~1"=="" (
    echo Usage: run.bat ^<zip_path^> ^<install_path^> [options]
    echo.
    echo Options:
    echo   --silent      Run without UI
    echo   --test-ui     Test UI mode
    exit /b 1
)

node "%~dp0dist\\stub.js" %*
`;
  fs.writeFileSync(path.join(standaloneDir, 'run.bat'), runBat);
  
  // Create run.ps1
  const runPs1 = `# OpenKosmos Updater Stub Runner
# Requires Node.js to be installed on the system

param(
    [Parameter(Position=0)]
    [string]$ZipPath,
    
    [Parameter(Position=1)]
    [string]$InstallPath,
    
    [switch]$Silent,
    [switch]$TestUI
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$stubJs = Join-Path $scriptDir "dist\\stub.js"

$args = @($stubJs)
if ($ZipPath) { $args += $ZipPath }
if ($InstallPath) { $args += $InstallPath }
if ($Silent) { $args += "--silent" }
if ($TestUI) { $args += "--test-ui" }

& node @args
`;
  fs.writeFileSync(path.join(standaloneDir, 'run.ps1'), runPs1);

  log('\n========================================', 'green');
  log('  Build Complete!', 'green');
  log('========================================', 'green');
  
  log('\nOutput files:', 'yellow');
  log(`  Release: ${RELEASE_DIR}`, 'cyan');
  log(`  Resources: ${RESOURCES_DIR}`, 'cyan');
  
  // List generated files
  if (fs.existsSync(RELEASE_DIR)) {
    log('\nRelease files:', 'yellow');
    fs.readdirSync(RELEASE_DIR).forEach(file => {
      const filePath = path.join(RELEASE_DIR, file);
      const stats = fs.statSync(filePath);
      if (stats.isFile()) {
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        log(`  ${file} (${sizeMB} MB)`, 'cyan');
      }
    });
  }
}

// Run build
build().catch(err => {
  log(`\n❌ Build failed: ${err.message}`, 'red');
  process.exit(1);
});
