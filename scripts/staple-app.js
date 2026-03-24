// Staple notarization ticket to macOS app
// Standalone script for the package-macos job in GitHub Actions

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Staple notarization ticket to the app
function stapleApp(appPath) {
  console.log('🍎 Stapling notarization ticket to app...');
  console.log(`   App path: ${appPath}`);
  
  try {
    execSync(
      `xcrun stapler staple "${appPath}"`,
      { encoding: 'utf-8', timeout: 60000, stdio: 'inherit' }
    );
    console.log('✅ Stapling complete');
    return true;
  } catch (error) {
    console.error('❌ Stapling failed:', error.message);
    throw error;
  }
}

// Verify whether staple was successful
function verifyStaple(appPath) {
  console.log('🔍 Verifying staple...');
  try {
    const result = execSync(
      `xcrun stapler validate "${appPath}"`,
      { encoding: 'utf-8', timeout: 60000 }
    );
    console.log('✅ Staple verification passed');
    console.log(result);
    return true;
  } catch (error) {
    console.warn('⚠️ Staple verification failed:', error.message);
    return false;
  }
}

// Main flow
function main() {
  const appPath = process.argv[2];
  
  if (!appPath) {
    console.error('Usage: node staple-app.js <path-to-app>');
    console.error('Example: node staple-app.js release/mac/OpenKosmos.app');
    process.exit(1);
  }
  
  if (!fs.existsSync(appPath)) {
    console.error(`❌ App not found: ${appPath}`);
    process.exit(1);
  }
  
  try {
    stapleApp(appPath);
    verifyStaple(appPath);
    console.log('✅ Stapling process completed successfully!');
  } catch (error) {
    console.error('❌ Stapling process failed:', error.message);
    process.exit(1);
  }
}

main();
