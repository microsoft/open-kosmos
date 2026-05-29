#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const extract = require('extract-zip');

// Log file path
const logFile = path.join(require('os').tmpdir(), 'openkosmos-updater.log');

// Log function
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;

  // Output to console
  console.log(message);

  // Write to log file
  try {
    fs.appendFileSync(logFile, logMessage);
  } catch (err) {
    console.error('Failed to write log:', err);
  }
}

// Recursively copy directory (supports symbolic links)
async function copyDir(src, dest) {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isSymbolicLink()) {
      // Handle symbolic links
      const linkTarget = await fs.promises.readlink(srcPath);
      log(`Creating symlink: ${destPath} -> ${linkTarget}`);
      await fs.promises.symlink(linkTarget, destPath);
    } else if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.promises.copyFile(srcPath, destPath);
      // Copy file permissions
      const stats = await fs.promises.stat(srcPath);
      await fs.promises.chmod(destPath, stats.mode);
    }
  }
}

// Recursively remove directory
async function removeDir(dir) {
  if (!fs.existsSync(dir)) return;
  
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await removeDir(fullPath);
    } else {
      await fs.promises.unlink(fullPath);
    }
  }

  await fs.promises.rmdir(dir);
}

// macOS: Replace application
async function replaceApp(src, dest) {
  log('Replacing macOS application...');

  // Find .app bundle
  const entries = await fs.promises.readdir(src);
  const appName = entries.find(entry => entry.endsWith('.app'));
  
  if (!appName) {
    throw new Error('No .app bundle found in zip');
  }
  
  const srcApp = path.join(src, appName);
  const destApp = dest;
  
  log(`Source app: ${srcApp}`);
  log(`Destination: ${destApp}`);
  
  // Remove old application
  if (fs.existsSync(destApp)) {
    log('Removing old application...');
    await removeDir(destApp);
  }
  
  // Copy new application
  log('Copying new application...');
  await copyDir(srcApp, destApp);
  
  log('macOS application replaced successfully');
}

// Launch application
function launchApp(appPath) {
  log(`Launching macOS application: ${appPath}`);
  
  const child = spawn('open', [appPath], {
    detached: true,
    stdio: 'ignore'
  });
  
  child.unref();
  log('Application launched successfully');
}

// Main function
async function main() {
  log('=== OpenKosmos Updater Started ===');
  log(`Platform: ${process.platform}, Arch: ${process.arch}`);
  log(`Node.js version: ${process.version}`);
  
  // Check platform
  if (process.platform !== 'darwin') {
    log('ERROR: This updater only supports macOS');
    process.exit(1);
  }
  
  // Check arguments
  if (process.argv.length < 4) {
    log('ERROR: Invalid arguments');
    console.error('Usage: updater <zip_path> <install_path>');
    process.exit(1);
  }
  
  const zipPath = process.argv[2];
  const installPath = process.argv[3];
  
  log(`Zip path: ${zipPath}`);
  log(`Install path: ${installPath}`);
  
  try {
    // Validate ZIP file exists
    if (!fs.existsSync(zipPath)) {
      throw new Error(`Zip file does not exist: ${zipPath}`);
    }
    
    // 1. Wait for main application to exit
    log('Waiting for main application to exit...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 2. Extract to temporary directory
    const tempDir = path.join(require('os').tmpdir(), 'openkosmos-update-tmp');
    log(`Extracting to temporary directory: ${tempDir}`);

    // Clean up old temporary directory
    if (fs.existsSync(tempDir)) {
      log('Removing old temporary directory...');
      await removeDir(tempDir);
    }

    // Extract zip file
    log('Extracting zip file...');
    await extract(zipPath, { dir: tempDir });
    log('Extraction completed');
    
    // 3. Replace application (using backup+replace strategy)
    log('Replacing application...');
    const backupPath = installPath + '.backup';
    log(`Creating backup: ${backupPath}`);

    // Remove old backup
    if (fs.existsSync(backupPath)) {
      log('Removing old backup...');
      await removeDir(backupPath);
    }

    // Create backup
    if (fs.existsSync(installPath)) {
      log('Backing up current application...');
      await fs.promises.rename(installPath, backupPath);
    }
    
    try {
      await replaceApp(tempDir, installPath);
    } catch (replaceError) {
      // Attempt to restore backup
      if (fs.existsSync(backupPath)) {
        log('Attempting to restore backup...');
        if (fs.existsSync(installPath)) {
          await removeDir(installPath);
        }
        await fs.promises.rename(backupPath, installPath);
        log('Backup restored successfully');
      }
      throw replaceError;
    }
    
    // Clean up backup
    if (fs.existsSync(backupPath)) {
      await removeDir(backupPath);
    }
    
    log('Application replaced successfully');
    
    // 4. Clean up temporary directory
    log('Cleaning up...');
    if (fs.existsSync(tempDir)) {
      await removeDir(tempDir);
    }
    log('Cleanup completed');
    
    // 5. Restart application
    log('Launching application...');
    launchApp(installPath);
    
    log('=== Update completed successfully! ===');
    log(`Log file saved at: ${logFile}`);
    
    // Wait briefly before exiting to ensure application has started
    await new Promise(resolve => setTimeout(resolve, 1000));
    process.exit(0);
    
  } catch (error) {
    log(`FATAL ERROR: ${error.message}`);
    log(`Stack trace: ${error.stack}`);
    log(`Log file saved at: ${logFile}`);
    process.exit(1);
  }
}

// Run main function
main().catch(error => {
  log(`Unhandled error: ${error.message}`);
  process.exit(1);
});
