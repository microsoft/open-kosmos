#!/usr/bin/env node

/**
 * Update check debug tool
 * Used to diagnose CDN update check hang issues
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env.local file
try {
  const envPath = path.resolve(__dirname, '../.env.local');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    let loadedVars = 0;
    
    envContent.split('\n').forEach(line => {
      // Skip comment lines and blank lines
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        return;
      }
      
      // Parse key=value
      const equalIndex = trimmedLine.indexOf('=');
      if (equalIndex > 0) {
        const key = trimmedLine.substring(0, equalIndex).trim();
        const value = trimmedLine.substring(equalIndex + 1).trim();
        
        if (key && value && !process.env[key]) {
          process.env[key] = value;
          loadedVars++;
          
          if (key === 'RELEASE_CDN_URL') {
            console.log(`✅ CDN config found: ${key}=${value}`);
          }
        }
      }
    });
    
    console.log(`✅ Loaded .env.local file (${loadedVars} variables)`);
  } else {
    console.log('⚠️  .env.local file not found');
  }
} catch (error) {
  console.log('⚠️  Failed to load .env.local file:', error.message);
}

// Read CDN URL from environment variable or argument
const CDN_URL = process.env.RELEASE_CDN_URL || process.argv[2];

if (!CDN_URL) {
  console.error('❌ CDN URL missing');
  console.log('Usage:');
  console.log('  1. Set environment variable: RELEASE_CDN_URL=https://your-cdn.com/releases');
  console.log('  2. Or pass as argument: node debug-update-check.js https://your-cdn.com/releases');
  process.exit(1);
}

console.log('🔍 Starting CDN update check debug');
console.log('=' .repeat(60));
console.log(`CDN URL: ${CDN_URL}`);
console.log(`Current version: ${require('../package.json').version}`);
console.log(`Platform: ${process.platform}-${process.arch}`);
console.log('=' .repeat(60));

/**
 * Detailed HTTP/HTTPS request function
 */
function httpGetDetailed(url, step) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    console.log(`\n📡 Step ${step}: Sending ${isHttps ? 'HTTPS' : 'HTTP'} request`);
    console.log(`   URL: ${url}`);
    console.log(`   Protocol: ${urlObj.protocol}`);
    
    const startTime = Date.now();
    
    const request = httpModule.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': `OpenKosmos-Debug/${require('../package.json').version}`,
        'Accept': 'application/json, text/plain, */*',
        'Cache-Control': 'no-cache'
      }
    }, (res) => {
      const responseTime = Date.now() - startTime;
      
      console.log(`   ✅ Connection established (${responseTime}ms)`);
      console.log(`   Status: ${res.statusCode} ${res.statusMessage}`);
      console.log(`   Response headers:`, {
        'content-type': res.headers['content-type'],
        'content-length': res.headers['content-length'],
        'cache-control': res.headers['cache-control'],
        'server': res.headers['server'],
        'date': res.headers['date']
      });

      let data = '';
      let receivedBytes = 0;
      
      res.on('data', (chunk) => {
        data += chunk;
        receivedBytes += chunk.length;
        
        if (receivedBytes <= 1024) { // Only show progress for the first 1KB
          console.log(`   📥 Received data: ${receivedBytes} bytes`);
        }
      });
      
      res.on('end', () => {
        const totalTime = Date.now() - startTime;
        console.log(`   ✅ Response complete (total time: ${totalTime}ms, data: ${receivedBytes} bytes)`);
        
        if (res.statusCode === 200) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: data,
            responseTime: totalTime,
            size: receivedBytes
          });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}\nResponse body: ${data}`));
        }
      });
    });

    request.on('error', (error) => {
      const totalTime = Date.now() - startTime;
      console.log(`   ❌ Request error (${totalTime}ms):`, {
        message: error.message,
        code: error.code,
        errno: error.errno,
        syscall: error.syscall,
        hostname: error.hostname
      });
      reject(error);
    });

    request.on('timeout', () => {
      console.log(`   ⏰ Request timed out (15s)`);
      request.destroy();
      reject(new Error('Request timed out'));
    });

    // Show progress
    setTimeout(() => {
      console.log(`   ⏳ Waiting for response... (5s)`);
    }, 5000);

    setTimeout(() => {
      console.log(`   ⏳ Still waiting... (10s)`);
    }, 10000);
  });
}

/**
 * Test network connectivity
 */
async function testNetworkConnectivity() {
  console.log('\n🌐 Testing network connectivity');
  
  const testUrls = [
    'https://www.google.com',
    'https://www.baidu.com',
    'https://github.com'
  ];

  for (const url of testUrls) {
    try {
      console.log(`   Testing: ${url}`);
      const startTime = Date.now();
      
      await new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const httpModule = urlObj.protocol === 'https:' ? https : http;
        
        const request = httpModule.get(url, { timeout: 5000 }, (res) => {
          const time = Date.now() - startTime;
          console.log(`   ✅ ${url} reachable (${time}ms, HTTP ${res.statusCode})`);
          resolve();
        });
        
        request.on('error', reject);
        request.on('timeout', () => {
          request.destroy();
          reject(new Error('Timed out'));
        });
      });
      
    } catch (error) {
      console.log(`   ❌ ${url} unreachable: ${error.message}`);
    }
  }
}

/**
 * Test CDN DNS resolution
 */
async function testDnsResolution() {
  console.log('\n🔍 Testing CDN DNS resolution');
  
  try {
    const url = new URL(CDN_URL);
    const hostname = url.hostname;
    
    console.log(`   Hostname: ${hostname}`);

    // Use Node.js built-in DNS resolution
    const dns = require('dns');
    
    const addresses = await new Promise((resolve, reject) => {
      dns.resolve4(hostname, (err, addresses) => {
        if (err) reject(err);
        else resolve(addresses);
      });
    });
    
    console.log(`   ✅ DNS resolution succeeded: ${addresses.join(', ')}`);

  } catch (error) {
    console.log(`   ❌ DNS resolution failed: ${error.message}`);
  }
}

/**
 * Main debug flow
 */
async function runDebug() {
  try {
    // 1. Test network connectivity
    await testNetworkConnectivity();
    
    // 2. Test DNS resolution
    await testDnsResolution();
    
    // 3. Test latest.json access
    const latestUrl = `${CDN_URL}/latest.json`;
    const response = await httpGetDetailed(latestUrl, 3);
    
    console.log('\n📄 latest.json content analysis:');
    console.log(`   Size: ${response.size} bytes`);
    console.log(`   Response time: ${response.responseTime}ms`);

    // 4. Parse JSON
    console.log('\n🔧 Parsing JSON content:');
    try {
      const data = JSON.parse(response.data);
      console.log('   ✅ JSON parsed successfully');
      console.log('   Content:', JSON.stringify(data, null, 2));

      // 5. Validate format
      console.log('\n✅ Format validation:');
      
      if (!data.latest) {
        console.log('   ❌ Missing "latest" field');
        return;
      }
      console.log(`   ✅ Version: ${data.latest}`);

      if (!data.downloadUrls) {
        console.log('   ❌ Missing "downloadUrls" field');
        return;
      }
      
      const platforms = Object.keys(data.downloadUrls);
      console.log(`   ✅ Supported platforms: ${platforms.join(', ')}`);
      
      const currentPlatform = `${process.platform}-${process.arch}`;
      if (data.downloadUrls[currentPlatform]) {
        console.log(`   ✅ Current platform ${currentPlatform} is supported`);

        // 6. Test file availability
        const fileName = data.downloadUrls[currentPlatform];
        const downloadUrl = `${CDN_URL}/${fileName}`;
        console.log(`\n📦 Testing file availability: ${fileName}`);
        
        try {
          await httpGetDetailed(downloadUrl, 6);
          console.log('   ✅ File is downloadable');
        } catch (error) {
          console.log(`   ❌ File not available: ${error.message}`);
        }

      } else {
        console.log(`   ⚠️  Current platform ${currentPlatform} is not supported`);
      }

    } catch (parseError) {
      console.log('   ❌ JSON parse failed:', parseError.message);
      console.log('   Raw content (first 500 chars):');
      console.log(response.data.substring(0, 500));
    }
    
    console.log('\n🎉 Debug complete');
    
  } catch (error) {
    console.error('\n💥 Error during debug:');
    console.error('Error message:', error.message);
    if (error.stack) {
      console.error('Error stack:', error.stack);
    }
    process.exit(1);
  }
}

// Run debug
if (require.main === module) {
  runDebug();
}

module.exports = {
  httpGetDetailed,
  testNetworkConnectivity,
  testDnsResolution
};