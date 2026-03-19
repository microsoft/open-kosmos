#!/usr/bin/env node

/**
 * Test Script - Call the GitHub Copilot Chat Model List API
 * Based on the vscode-copilot-chat project implementation
 */

const https = require('https');
const crypto = require('crypto');
const path = require('path');
const { getTokens, validateTokens, printTokenInfo } = require('./lib/loadTokens');

// Load tokens
let TOKENS;
try {
    TOKENS = getTokens();
    validateTokens(TOKENS);
} catch (error) {
    console.error('❌ Failed to load authentication info:', error.message);
    process.exit(1);
}

// GitHub Copilot API endpoint - based on CAPI client implementation
const COPILOT_CAPI_BASE = 'https://api.githubcopilot.com';
const MODELS_ENDPOINT = '/models';

/**
 * Generate request ID
 */
function generateRequestId() {
  return crypto.randomUUID();
}

/**
 * Generate request HMAC (if needed)
 * Based on the vscode-copilot-chat implementation
 */
function createRequestHMAC(secret) {
  if (!secret) return undefined;
  const timestamp = Date.now().toString();
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(timestamp);
  return hmac.digest('hex');
}

/**
 * Send HTTPS request
 */
function makeHttpsRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = data ? JSON.parse(data) : {};
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: jsonData,
            rawData: data
          });
        } catch (error) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: null,
            rawData: data
          });
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    if (postData) {
      req.write(postData);
    }
    
    req.end();
  });
}

/**
 * Get Copilot model list
 * Based on the ModelMetadataFetcher implementation
 */
async function fetchCopilotModels() {
  const requestId = generateRequestId();
  const hmac = createRequestHMAC(process.env.HMAC_SECRET);
  
  console.log('📋 Starting to fetch GitHub Copilot model list...');
  console.log(`🔗 Request ID: ${requestId}`);
  
  // Build request headers, based on the CAPI client's _mixinHeaders implementation
  const headers = {
    'Authorization': `Bearer ${TOKENS.access}`,
    'X-Request-Id': requestId,
    'X-Interaction-Type': 'model-access',
    'OpenAI-Intent': 'model-access',
    'X-GitHub-Api-Version': '2025-05-01',
    'User-Agent': 'VSCode-Copilot-Chat-Test-Script/1.0.0',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    // Required headers for the CAPI client
    'VScode-SessionId': 'test-session-' + Date.now(),
    'VScode-MachineId': 'test-machine-' + Date.now(),
    'Editor-Plugin-Version': 'copilot-chat/1.0.0',
    'Editor-Version': 'vscode/1.93.0',
    'Copilot-Integration-Id': 'vscode-chat'
  };
  
  // Add HMAC if present
  if (hmac) {
    headers['X-Request-HMAC'] = hmac;
  }
  
  const options = {
    hostname: 'api.githubcopilot.com',
    port: 443,
    path: MODELS_ENDPOINT,
    method: 'GET',
    headers: headers,
    timeout: 30000 // 30 second timeout
  };
  
  try {
    console.log('🚀 Sending request to:', `${COPILOT_CAPI_BASE}${MODELS_ENDPOINT}`);
    const response = await makeHttpsRequest(options);
    
    console.log(`📊 Response status code: ${response.statusCode}`);
    console.log('📋 Response headers:', JSON.stringify(response.headers, null, 2));
    
    if (response.statusCode >= 200 && response.statusCode < 300) {
      console.log('✅ Successfully fetched model list!\n');
      
      if (response.data && response.data.data) {
        const models = response.data.data;
        console.log(`🎯 Found ${models.length} models:\n`);
        
        // Group and display by model family
        const modelsByFamily = {};
        
        models.forEach(model => {
          const family = model.capabilities?.family || 'Unknown';
          if (!modelsByFamily[family]) {
            modelsByFamily[family] = [];
          }
          modelsByFamily[family].push(model);
        });
        
        // Display model details
        for (const [family, familyModels] of Object.entries(modelsByFamily)) {
          console.log(`📂 Model family: ${family}`);
          familyModels.forEach(model => {
            console.log(`  🤖 ${model.name} (${model.id})`);
            console.log(`     Version: ${model.version || 'N/A'}`);
            console.log(`     Type: ${model.capabilities?.type || 'N/A'}`);
            console.log(`     Max prompt tokens: ${model.capabilities?.limits?.max_prompt_tokens || 'N/A'}`);
            console.log(`     Max output tokens: ${model.capabilities?.limits?.max_output_tokens || 'N/A'}`);
            console.log(`     Supports tool calls: ${model.capabilities?.supports_tool_calls ? 'Yes' : 'No'}`);
            console.log(`     Supports vision: ${model.capabilities?.supports_vision ? 'Yes' : 'No'}`);
            console.log(`     Preview: ${model.preview ? 'Yes' : 'No'}`);
            if (model.is_chat_fallback) {
              console.log(`     🔄 Fallback model: Yes`);
            }
            console.log('');
          });
        }
        
        // Save to file
        const fs = require('fs');
        const outputFile = path.join(__dirname, 'github-copilot-models.json');
        fs.writeFileSync(outputFile, JSON.stringify(response.data, null, 2));
        console.log(`💾 Full model data saved to: ${outputFile}`);
        
      } else {
        console.log('⚠️ Response data format does not match expectations');
        console.log('Raw response:', response.rawData);
      }
      
    } else if (response.statusCode === 401) {
      console.error('❌ Authentication failed - please check if the access token is valid');
    } else if (response.statusCode === 403) {
      console.error('❌ Insufficient permissions - may need different permissions or the token has expired');
    } else if (response.statusCode === 429) {
      console.error('❌ Too many requests - please try again later');
    } else {
      console.error(`❌ Request failed, status code: ${response.statusCode}`);
      console.error('Response content:', response.rawData);
    }
    
  } catch (error) {
    console.error('❌ Request error:', error.message);
    
    // Provide troubleshooting suggestions
    console.log('\n🔍 Troubleshooting suggestions:');
    console.log('1. Check network connection');
    console.log('2. Verify the access token is valid and not expired');
    console.log('3. Confirm the token has permission to access the Copilot API');
    console.log('4. Check if the API endpoint is correct');
  }
}


/**
 * Main function
 */
async function main() {
  console.log('🚀 GitHub Copilot Model List Fetch Test Script');
  console.log('===================================\n');
  
  printTokenInfo(TOKENS);
  await fetchCopilotModels();
}

// Run script
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Script execution failed:', error);
    process.exit(1);
  });
}

module.exports = {
  fetchCopilotModels,
  TOKENS
};