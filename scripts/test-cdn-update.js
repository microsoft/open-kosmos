#!/usr/bin/env node

/**
 * CDN update system test script.
 * Verifies that the CDN update check feature works correctly.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Test configuration
const TEST_CONFIG = {
  // Test CDN URL (replace with the actual CDN address)
  cdnUrl: 'https://your-cdn-domain.com/releases',
  // Current version (read from package.json)
  currentVersion: require('../package.json').version,
  // Test timeout
  timeout: 10000
};

console.log('🚀 Starting CDN update system test');
console.log('Configuration:', TEST_CONFIG);
console.log('=' .repeat(50));

/**
 * HTTPS GET request.
 */
function httpsGet(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      timeout,
      headers: {
        'User-Agent': `OpenKosmos-Test/${TEST_CONFIG.currentVersion}`,
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: data
          });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
      });
    });
    
    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

/**
 * HTTPS HEAD request.
 */
function httpsHead(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'HEAD',
      timeout,
      headers: {
        'User-Agent': `OpenKosmos-Test/${TEST_CONFIG.currentVersion}`
      }
    }, (res) => {
      if (res.statusCode === 200) {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers
        });
      } else {
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
      }
    });
    
    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Request timed out'));
    });
    
    request.end();
  });
}

/**
 * Compare version numbers
 */
function compareVersions(version1, version2) {
  const v1Parts = version1.replace(/^v/, '').split('.').map(Number);
  const v2Parts = version2.replace(/^v/, '').split('.').map(Number);

  const maxLength = Math.max(v1Parts.length, v2Parts.length);

  for (let i = 0; i < maxLength; i++) {
    const v1Part = v1Parts[i] || 0;
    const v2Part = v2Parts[i] || 0;

    if (v1Part > v2Part) return 1;
    if (v1Part < v2Part) return -1;
  }

  return 0;
}

/**
 * Get the platform identifier for the current platform.
 */
function getCurrentPlatformKey() {
  const platform = process.platform;
  const arch = process.arch;
  return `${platform}-${arch}`;
}

/**
 * Get the filename for the current platform.
 */
function getPlatformFileName(latestInfo) {
  const platformKey = getCurrentPlatformKey();

  if (!latestInfo.downloadUrls || !latestInfo.downloadUrls[platformKey]) {
    throw new Error(`Unsupported platform combination: ${platformKey}`);
  }
  
  return latestInfo.downloadUrls[platformKey];
}

/**
 * Test 1: Check if latest.json is accessible.
 */
async function testLatestJsonAccess() {
  console.log('📋 Test 1: Check latest.json accessibility');
  
  try {
    const latestUrl = `${TEST_CONFIG.cdnUrl}/latest.json`;
    console.log(`  Request URL: ${latestUrl}`);
    
    const response = await httpsGet(latestUrl, TEST_CONFIG.timeout);
    
    console.log(`  ✅ Accessible (HTTP ${response.statusCode})`);
    console.log(`  📊 Response headers:`, {
      'content-type': response.headers['content-type'],
      'content-length': response.headers['content-length'],
      'cache-control': response.headers['cache-control']
    });
    
    return JSON.parse(response.data);
  } catch (error) {
    console.log(`  ❌ Access failed: ${error.message}`);
    return null;
  }
}

/**
 * Test 2: Validate latest.json format.
 */
function testLatestJsonFormat(latestInfo) {
  console.log('\n📋 Test 2: Validate latest.json format');

  if (!latestInfo) {
    console.log('  ❌ No data to validate');
    return false;
  }
  
  console.log('  📄 Content:', JSON.stringify(latestInfo, null, 2));
  
  // Check required fields
  const requiredFields = ['latest'];
  const missingFields = requiredFields.filter(field => !latestInfo[field]);
  
  if (missingFields.length > 0) {
    console.log(`  ❌ Missing required fields: ${missingFields.join(', ')}`);
    return false;
  }
  
  // Check version format
  const versionRegex = /^\d+\.\d+\.\d+$/;
  if (!versionRegex.test(latestInfo.latest)) {
    console.log(`  ❌ Invalid version format: ${latestInfo.latest}`);
    return false;
  }
  
  // Check downloadUrls field
  if (!latestInfo.downloadUrls || typeof latestInfo.downloadUrls !== 'object') {
    console.log('  ❌ Missing or invalid downloadUrls field');
    return false;
  }
  
  // Check platform key format
  const platformKeys = Object.keys(latestInfo.downloadUrls);
  const validPlatformRegex = /^(darwin|win32|linux)-(x64|arm64)$/;
  const invalidKeys = platformKeys.filter(key => !validPlatformRegex.test(key));
  
  if (invalidKeys.length > 0) {
    console.log(`  ❌ Invalid platform key format: ${invalidKeys.join(', ')}`);
    console.log('  💡 Correct format: darwin-arm64, win32-x64, etc.');
    return false;
  }
  
  console.log(`  ✅ Format validation passed (${platformKeys.length} platforms supported)`);
  return true;
}

/**
 * Test 3: Version comparison.
 */
function testVersionComparison(latestInfo) {
  console.log('\n📋 Test 3: Version comparison');

  if (!latestInfo) {
    console.log('  ❌ No version information');
    return false;
  }
  
  const currentVersion = TEST_CONFIG.currentVersion;
  const latestVersion = latestInfo.latest;
  const comparison = compareVersions(latestVersion, currentVersion);
  
  console.log(`  Current version: ${currentVersion}`);
  console.log(`  Latest version: ${latestVersion}`);
  
  if (comparison > 0) {
    console.log('  ✅ New version detected');
    return true;
  } else if (comparison === 0) {
    console.log('  📝 Same version');
    return true;
  } else {
    console.log('  ⚠️  Latest version is older than current version');
    return true;
  }
}

/**
 * Test 4: Check download file availability.
 */
async function testDownloadAvailability(latestInfo) {
  console.log('\n📋 Test 4: Check download file availability');

  if (!latestInfo) {
    console.log('  ❌ No version information');
    return false;
  }
  
  try {
    const platformKey = getCurrentPlatformKey();
    console.log(`  Current platform: ${platformKey}`);
    console.log(`  Available platforms: ${Object.keys(latestInfo.downloadUrls || {}).join(', ')}`);
    
    // Check if current platform is supported
    if (!latestInfo.downloadUrls || !latestInfo.downloadUrls[platformKey]) {
      console.log(`  ⚠️  Current platform ${platformKey} does not support auto-update`);
      return true; // Not an error, just unsupported
    }
    
    const fileName = getPlatformFileName(latestInfo);
    const downloadUrl = `${TEST_CONFIG.cdnUrl}/${fileName}`;
    
    console.log(`  File name: ${fileName}`);
    console.log(`  Download URL: ${downloadUrl}`);
    
    const response = await httpsHead(downloadUrl, TEST_CONFIG.timeout);
    
    console.log(`  ✅ File available (HTTP ${response.statusCode})`);
    
    const contentLength = response.headers['content-length'];
    if (contentLength) {
      const sizeMB = (parseInt(contentLength) / 1024 / 1024).toFixed(2);
      console.log(`  📊 File size: ${sizeMB} MB`);
    }
    
    return true;
  } catch (error) {
    console.log(`  ❌ File not available: ${error.message}`);
    return false;
  }
}

/**
 * Test 5: Network connection performance.
 */
async function testNetworkPerformance() {
  console.log('\n📋 Test 5: Network connection performance');
  
  try {
    const startTime = Date.now();
    await httpsGet(`${TEST_CONFIG.cdnUrl}/latest.json`, TEST_CONFIG.timeout);
    const endTime = Date.now();
    
    const responseTime = endTime - startTime;
    console.log(`  ⏱️  Response time: ${responseTime}ms`);

    if (responseTime < 1000) {
      console.log('  ✅ Network performance is good');
    } else if (responseTime < 3000) {
      console.log('  ⚠️  Network performance is average');
    } else {
      console.log('  ❌ Network performance is poor');
    }
    
    return true;
  } catch (error) {
    console.log(`  ❌ Network test failed: ${error.message}`);
    return false;
  }
}

/**
 * Main test function.
 */
async function runTests() {
  const results = {
    passed: 0,
    failed: 0,
    total: 5
  };
  
  try {
    // Test 1: Check latest.json accessibility
    const latestInfo = await testLatestJsonAccess();
    if (latestInfo) results.passed++; else results.failed++;
    
    // Test 2: Validate format
    const formatValid = testLatestJsonFormat(latestInfo);
    if (formatValid) results.passed++; else results.failed++;
    
    // Test 3: Version comparison
    const versionValid = testVersionComparison(latestInfo);
    if (versionValid) results.passed++; else results.failed++;
    
    // Test 4: Download file availability
    const downloadValid = await testDownloadAvailability(latestInfo);
    if (downloadValid) results.passed++; else results.failed++;
    
    // Test 5: Network performance
    const performanceValid = await testNetworkPerformance();
    if (performanceValid) results.passed++; else results.failed++;
    
  } catch (error) {
    console.error('\n❌ Error during test:', error.message);
    results.failed++;
  }
  
  // Print results
  console.log('\n' + '='.repeat(50));
  console.log('📊 Test result summary:');
  console.log(`  Passed: ${results.passed}/${results.total}`);
  console.log(`  Failed: ${results.failed}/${results.total}`);
  
  if (results.failed === 0) {
    console.log('  🎉 All tests passed! CDN update system is working correctly');
    process.exit(0);
  } else {
    console.log('  ⚠️  Some tests failed, please check the CDN configuration');
    process.exit(1);
  }
}

/**
 * Handle command line arguments.
 */
function handleArgs() {
  const args = process.argv.slice(2);
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--cdn-url' && i + 1 < args.length) {
      TEST_CONFIG.cdnUrl = args[i + 1];
      i++;
    } else if (arg === '--timeout' && i + 1 < args.length) {
      TEST_CONFIG.timeout = parseInt(args[i + 1]);
      i++;
    } else if (arg === '--help' || arg === '-h') {
      console.log('CDN update system test script');
      console.log('');
      console.log('Usage: node test-cdn-update.js [options]');
      console.log('');
      console.log('Options:');
      console.log('  --cdn-url <url>    Specify CDN base URL');
      console.log('  --timeout <ms>     Set request timeout');
      console.log('  --help, -h         Show help');
      console.log('');
      console.log('Example:');
      console.log('  node test-cdn-update.js --cdn-url https://cdn.example.com/releases');
      process.exit(0);
    }
  }
}

// Main entry point
if (require.main === module) {
  handleArgs();
  runTests();
}

module.exports = {
  httpsGet,
  httpsHead,
  compareVersions,
  getCurrentPlatformKey,
  getPlatformFileName
};