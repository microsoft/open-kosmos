// Poll and wait for Apple notarization to complete
// Standalone script for the notarize-macos job in GitHub Actions

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration constants
const MAX_WAIT_TIME = 2 * 60 * 60 * 1000; // Maximum wait time: 2 hours

// Get configuration from environment variables or command line arguments
function getConfig() {
  const submissionIdFile = process.argv[2] || 'submission-id.txt';
  
  if (!fs.existsSync(submissionIdFile)) {
    throw new Error(`Submission ID file not found: ${submissionIdFile}`);
  }
  
  const submissionId = fs.readFileSync(submissionIdFile, 'utf-8').trim();
  
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  
  if (!appleId || !appleIdPassword || !teamId) {
    throw new Error('Missing required environment variables: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID');
  }
  
  return { submissionId, appleId, appleIdPassword, teamId };
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

// Main flow: use notarytool wait command to wait
async function waitForNotarization() {
  const { submissionId, appleId, appleIdPassword, teamId } = getConfig();
  
  console.log('🍎 Waiting for Apple notarization to complete...');
  console.log(`   Submission ID: ${submissionId}`);
  console.log(`   Team ID: ${teamId}`);
  console.log(`   Apple ID: ${appleId}`);
  console.log(`   Max wait time: ${MAX_WAIT_TIME / 1000 / 60} minutes`);
  
  try {
    // Use notarytool wait command, automatically polls until complete
    // --timeout parameter unit is seconds
    const timeoutSeconds = Math.floor(MAX_WAIT_TIME / 1000);
    
    console.log('⏳ Starting notarytool wait...');
    const result = execSync(
      `xcrun notarytool wait "${submissionId}" \
        --apple-id "${appleId}" \
        --team-id "${teamId}" \
        --password "${appleIdPassword}" \
        --timeout ${timeoutSeconds}`,
      { 
        encoding: 'utf-8', 
        timeout: MAX_WAIT_TIME + 60000, // Give Node.js an extra 1 minute buffer
        stdio: 'inherit' // Output to console in real-time
      }
    );
    
    console.log('✅ Notarization completed successfully!');
    console.log(result);
    
    // Verify status
    const statusResult = execSync(
      `xcrun notarytool info "${submissionId}" \
        --apple-id "${appleId}" \
        --team-id "${teamId}" \
        --password "${appleIdPassword}" \
        --output-format json`,
      { encoding: 'utf-8', timeout: 60000 }
    );
    
    const status = JSON.parse(statusResult);
    console.log(`   Final status: ${status.status}`);
    
    if (status.status === 'Accepted') {
      console.log('✅ Notarization accepted!');
      return 0;
    } else {
      throw new Error(`Notarization failed with status: ${status.status}`);
    }
    
  } catch (error) {
    console.error('❌ Notarization failed');
    console.error(`   Submission ID: ${submissionId}`);
    console.error(`   Error: ${error.message}`);
    
    // Try to get detailed log
    const log = getNotarizationLog(submissionId, appleId, appleIdPassword, teamId);
    if (log) {
      console.error('📜 Notarization log:');
      console.error(log);
    }
    
    console.error('\nℹ️ You can check status manually with:');
    console.error(`xcrun notarytool info "${submissionId}" --apple-id "${appleId}" --team-id "${teamId}" --password "***"`);
    
    process.exit(1);
  }
}

// Execute
waitForNotarization().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
