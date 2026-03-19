// Apple Notarization Script for macOS distribution signing
// Uses notarytool directly to avoid the hang issue with @electron/notarize
const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');

// Configuration constants
const POLL_INTERVAL = 30 * 1000; // Poll every 30 seconds
const MAX_POLL_TIME = 30 * 60 * 1000; // Maximum polling time: 30 minutes
const CODESIGN_TIMEOUT = 60 * 1000; // 1 minute timeout

// Verify codesign signature
function verifyCodesign(appPath) {
  console.log('🔏 Verifying codesign...');
  try {
    execSync(
      `codesign --verify --deep --strict --verbose=2 "${appPath}"`,
      { encoding: 'utf-8', timeout: CODESIGN_TIMEOUT, stdio: 'inherit' }
    );
    console.log('✓ Codesign verification passed');
    return true;
  } catch (error) {
    console.error('❌ Codesign verification failed:', error.message);
    return false;
  }
}

// Compress .app to .zip (notarytool only accepts zip/dmg/pkg)
function zipApp(appPath) {
  const zipPath = `${appPath}.zip`;
  console.log(`📦 Creating zip archive: ${zipPath}`);
  
  // Delete existing zip if present
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }
  
  const appDir = path.dirname(appPath);
  const appName = path.basename(appPath);
  
  execSync(
    `ditto -c -k --keepParent "${appName}" "${appName}.zip"`,
    { cwd: appDir, encoding: 'utf-8', timeout: 5 * 60 * 1000, stdio: 'inherit' }
  );
  
  console.log('✓ Zip archive created');
  return zipPath;
}

// Submit to Apple notarization service (without waiting)
function submitNotarization(zipPath, appleId, appleIdPassword, teamId) {
  console.log('📤 Submitting to Apple notarization service...');
  
  try {
    // Do not use --wait, return submission-id immediately
    const result = execSync(
      `xcrun notarytool submit "${zipPath}" \
        --apple-id "${appleId}" \
        --team-id "${teamId}" \
        --password "${appleIdPassword}" \
        --output-format json`,
      { 
        encoding: 'utf-8', 
        timeout: 5 * 60 * 1000, // submit itself should be fast, 5 minutes is enough
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      }
    );
    
    // Parse JSON result
    const jsonResult = JSON.parse(result);
    console.log(`✓ Submission successful`);
    console.log(`   Submission ID: ${jsonResult.id}`);
    console.log(`   Status: ${jsonResult.status}`);
    
    return jsonResult.id;
  } catch (error) {
    const output = error.stdout || error.stderr || error.message;
    console.error('❌ Submission failed:', output);
    throw new Error(`Failed to submit for notarization: ${output}`);
  }
}

// Poll notarization status
function pollNotarizationStatus(submissionId, appleId, appleIdPassword, teamId) {
  console.log('⏳ Polling notarization status...');
  console.log(`   Interval: ${POLL_INTERVAL / 1000}s`);
  console.log(`   Max wait time: ${MAX_POLL_TIME / 1000 / 60} minutes`);
  
  const startTime = Date.now();
  let pollCount = 0;
  
  while (true) {
    pollCount++;
    const elapsedTime = Date.now() - startTime;
    
    // Check if maximum wait time has been exceeded
    if (elapsedTime > MAX_POLL_TIME) {
      throw new Error(`Notarization polling timeout after ${MAX_POLL_TIME / 1000 / 60} minutes. Submission ID: ${submissionId}`);
    }
    
    try {
      console.log(`   [Poll ${pollCount}] Checking status... (${Math.floor(elapsedTime / 1000)}s elapsed)`);
      
      const result = execSync(
        `xcrun notarytool info "${submissionId}" \
          --apple-id "${appleId}" \
          --team-id "${teamId}" \
          --password "${appleIdPassword}" \
          --output-format json`,
        { encoding: 'utf-8', timeout: 60000 }
      );
      
      const jsonResult = JSON.parse(result);
      const status = jsonResult.status;
      
      console.log(`   Status: ${status}`);
      
      // Terminal states
      if (status === 'Accepted') {
        console.log(`✅ Notarization accepted! (after ${Math.floor(elapsedTime / 1000)}s)`);
        return { success: true, status };
      } else if (status === 'Invalid') {
        console.error('❌ Notarization rejected');
        return { success: false, status, submissionId };
      } else if (status === 'Rejected') {
        console.error('❌ Notarization rejected');
        return { success: false, status, submissionId };
      }
      
      // Continue waiting state: In Progress
      // Wait for next poll
      const sleepTime = POLL_INTERVAL;
      console.log(`   Waiting ${sleepTime / 1000}s before next poll...`);
      
      // Node.js has no sleep, use execSync sleep
      execSync(`sleep ${sleepTime / 1000}`, { stdio: 'ignore' });
      
    } catch (error) {
      const output = error.stdout || error.stderr || error.message;
      console.error(`⚠️ Error checking status (poll ${pollCount}):`, output);
      
      // If it's a network issue, wait and retry
      if (elapsedTime < MAX_POLL_TIME) {
        console.log('   Retrying in 30s...');
        execSync(`sleep 30`, { stdio: 'ignore' });
        continue;
      } else {
        throw error;
      }
    }
  }
}

// Get detailed notarization log (called on failure)
function getNotarizationLog(submissionId, appleId, appleIdPassword, teamId) {
  console.log(`📜 Fetching notarization log for submission: ${submissionId}`);
  try {
    const log = execSync(
      `xcrun notarytool log "${submissionId}" \
        --apple-id "${appleId}" \
        --team-id "${teamId}" \
        --password "${appleIdPassword}"`,
      { encoding: 'utf-8', timeout: 60000 }
    );
    return log;
  } catch (error) {
    console.warn('⚠️ Could not fetch notarization log:', error.message);
    return null;
  }
}

// Staple notarization ticket to the app
function stapleApp(appPath) {
  console.log('📎 Stapling notarization ticket...');
  try {
    execSync(
      `xcrun stapler staple "${appPath}"`,
      { encoding: 'utf-8', timeout: 60000, stdio: 'inherit' }
    );
    console.log('✓ Stapling complete');
    return true;
  } catch (error) {
    console.warn('⚠️ Stapling failed (non-fatal):', error.message);
    return false;
  }
}

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  
  if (electronPlatformName !== 'darwin') {
    console.log('Skipping notarization - not building for macOS');
    return;
  }

  // Check if we're in CI environment and have the required credentials
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  
  // Check if we need to wait for notarization to complete
  const shouldWait = process.env.APPLE_NOTARIZE_WAIT !== 'false';

  if (!appleId || !appleIdPassword || !teamId) {
    console.log('⚠️ Skipping notarization - missing Apple credentials');
    console.log('Required environment variables:');
    console.log('  - APPLE_ID:', appleId ? '✓ set' : '✗ missing');
    console.log('  - APPLE_APP_SPECIFIC_PASSWORD:', appleIdPassword ? '✓ set' : '✗ missing');
    console.log('  - APPLE_TEAM_ID:', teamId ? '✓ set' : '✗ missing');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log('🍎 Starting macOS notarization (using notarytool with polling)...');
  console.log(`   App: ${appPath}`);
  console.log(`   Team ID: ${teamId}`);
  console.log(`   Apple ID: ${appleId}`);
  console.log(`   Wait for completion: ${shouldWait ? 'YES (max ' + MAX_POLL_TIME / 1000 / 60 + ' minutes)' : 'NO (submit only)'}`);

  // Step 1: Verify codesign before submitting
  if (!verifyCodesign(appPath)) {
    throw new Error('Codesign verification failed. Please ensure the app is properly signed before notarization.');
  }

  // Step 2: Create zip archive for notarytool
  const appZipPath = zipApp(appPath);
  
  let submissionId = null;
  
  try {
    // Step 3: Submit to Apple
    submissionId = submitNotarization(appZipPath, appleId, appleIdPassword, teamId);
    
    if (!shouldWait) {
      // Save submission-id to file for subsequent jobs
      const submissionIdFile = path.join(appOutDir, 'submission-id.txt');
      fs.writeFileSync(submissionIdFile, submissionId, 'utf-8');
      
      console.log('⏭️ Skipping wait for notarization completion (APPLE_NOTARIZE_WAIT=false)');
      console.log(`   Submission ID: ${submissionId}`);
      console.log(`   Saved to: ${submissionIdFile}`);
      console.log('ℹ️ Notarization will continue in the background');
      console.log('ℹ️ Check status with: xcrun notarytool info "${submissionId}" --apple-id "${appleId}" --team-id "${teamId}" --password "***"');
      console.log('✅ Notarization submitted successfully!');
      return; // Don't wait, return immediately
    }
    
    // Step 4: Poll for status (only when shouldWait=true)
    const result = pollNotarizationStatus(submissionId, appleId, appleIdPassword, teamId);
    
    if (result.success) {
      console.log('✅ Notarization accepted!');
      
      // Step 5: Staple the ticket to the app
      stapleApp(appPath);
      
      console.log('✅ Notarization complete!');
    } else {
      console.error('❌ Notarization failed');
      console.error(`   Submission ID: ${submissionId}`);
      console.error(`   Status: ${result.status}`);
      
      // Get detailed log
      const log = getNotarizationLog(submissionId, appleId, appleIdPassword, teamId);
      if (log) {
        console.error('📜 Notarization log:');
        console.error(log);
      }
      
      throw new Error(`Notarization failed with status: ${result.status}. Check logs above for details.`);
    }
  } catch (error) {
    if (submissionId) {
      console.error(`❌ Error during notarization process`);
      console.error(`   Submission ID: ${submissionId}`);
      console.error(`   You can check status manually with:`);
      console.error(`   xcrun notarytool info "${submissionId}" --apple-id "${appleId}" --team-id "${teamId}" --password "***"`);
    }
    throw error;
  } finally {
    // Cleanup: remove temporary zip file (only delete in wait mode)
    if (shouldWait && fs.existsSync(appZipPath)) {
      console.log('🧹 Cleaning up temporary zip file...');
      fs.unlinkSync(appZipPath);
    } else if (!shouldWait) {
      console.log('ℹ️ Keeping zip file for verification: ' + appZipPath);
    }
  }
};