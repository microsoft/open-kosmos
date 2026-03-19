#!/usr/bin/env node

/**
 * GitHub Copilot GPT-5-Codex Model Call Test Script
 * Test model ID: gpt-5-codex
 */

const https = require('https');
const crypto = require('crypto');
const { getTokens, validateTokens, printTokenInfo } = require('./lib/loadTokens');

// Load tokens
let TOKENS;
try {
    TOKENS = getTokens();
    validateTokens(TOKENS);
} catch (error) {
    console.error('❌ Failed to load authentication info:', error.message);
    console.error('\n💡 Please ensure tokens are configured using one of the following methods:');
    console.error('1. Log in with the Kosmos app (recommended)');
    console.error('2. Set environment variables:');
    console.error('   export GITHUB_COPILOT_REFRESH_TOKEN="your_refresh_token"');
    console.error('   export GITHUB_COPILOT_ACCESS_TOKEN="your_access_token"');
    process.exit(1);
}

// Model ID
const MODEL_ID = 'gpt-5-codex';
const MODEL_NAME = 'GPT-5-Codex (Preview)';

// CAPI endpoint configuration
const CAPI_BASE_URL = 'api.githubcopilot.com';
const RESPONSES_ENDPOINT = '/responses';  // ✅ GPT-5-Codex uses the /responses endpoint

/**
 * Generate request ID
 */
function generateRequestId() {
    return crypto.randomUUID();
}

/**
 * Send chat request
 */
function sendChatRequest(messages, options = {}) {
    return new Promise((resolve, reject) => {
        const requestId = generateRequestId();
        const sessionId = 'test-session-' + Date.now();
        const machineId = 'test-machine-' + Date.now();
        
        // ✅ /responses endpoint uses a different request format: input string instead of messages array
        const lastUserMessage = messages.filter(m => m.role === 'user').pop();
        if (!lastUserMessage) {
            reject(new Error('No user message found'));
            return;
        }
        
        const requestBody = {
            model: MODEL_ID,
            input: lastUserMessage.content,  // ✅ Use the input field
            max_tokens: options.max_tokens || 4096,
            stream: options.stream || false
            // ❌ /responses endpoint does not support the temperature parameter
        };
        
        const postData = JSON.stringify(requestBody);
        
        const requestOptions = {
            hostname: CAPI_BASE_URL,
            port: 443,
            path: RESPONSES_ENDPOINT,  // ✅ Use the correct endpoint
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${TOKENS.access}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'Accept': 'application/json',
                'User-Agent': 'GitHubCopilotChat/1.0.0',
                'Editor-Version': 'vscode/1.95.0',
                'Editor-Plugin-Version': 'copilot-chat/1.0.0',
                'VScode-SessionId': sessionId,
                'VScode-MachineId': machineId,
                'X-Request-Id': requestId,
                'Copilot-Integration-Id': 'vscode-chat',
                'Openai-Intent': 'conversation-panel'
            },
            timeout: 30000
        };

        const req = https.request(requestOptions, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const jsonResponse = JSON.parse(data);
                        resolve({
                            statusCode: res.statusCode,
                            headers: res.headers,
                            data: jsonResponse
                        });
                    } catch (parseError) {
                        reject(new Error(`JSON parse error: ${parseError.message}`));
                    }
                } else {
                    reject(new Error(`Request failed: HTTP ${res.statusCode}\nResponse content: ${data}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });
        
        req.write(postData);
        req.end();
    });
}

/**
 * Main test function
 */
async function testGPT5Codex() {
    console.log('🚀 GitHub Copilot Model Test');
    console.log('='.repeat(60));
    console.log(`📋 Model name: ${MODEL_NAME}`);
    console.log(`🆔 Model ID: ${MODEL_ID}`);
    console.log('='.repeat(60));
    console.log();
    
    try {
        // Print token info
        printTokenInfo(TOKENS);

        // Test message - code-related tasks are more suitable for the Codex model
        const messages = [
            {
                role: "user",
                content: "Hello! Please briefly introduce yourself, especially your capabilities in code generation and programming tasks."
            }
        ];

        console.log('📝 Test message:', JSON.stringify(messages, null, 2));
        console.log();
        console.log('⏳ Sending request...');
        console.log();

        // Send request
        const response = await sendChatRequest(messages, {
            max_tokens: 2048,
            temperature: 0.7
        });

        console.log('✅ Request successful!');
        console.log(`📊 HTTP status code: ${response.statusCode}`);
        console.log();

        // Extract and display reply content
        if (response.data.choices && response.data.choices.length > 0) {
            const assistantMessage = response.data.choices[0].message;
            console.log('💬 Model reply:');
            console.log('─'.repeat(60));
            console.log(assistantMessage.content);
            console.log('─'.repeat(60));
            console.log();
            
            if (response.data.usage) {
                console.log('📊 Token usage statistics:');
                console.log(`   ├─ Input tokens: ${response.data.usage.prompt_tokens}`);
                console.log(`   ├─ Output tokens: ${response.data.usage.completion_tokens}`);
                console.log(`   └─ Total tokens: ${response.data.usage.total_tokens}`);
            }
        }

        console.log();
        console.log('🎉 Test complete! Model call is working normally');
        return response;

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        if (error.stack) {
            console.error('🐛 Error stack:', error.stack);
        }
        
        console.log();
        console.log('🔍 Troubleshooting suggestions:');
        console.log('1. Check network connection');
        console.log('2. Verify GitHub Copilot subscription is valid');
        console.log('3. Confirm the access token is correct and not expired');
        console.log('4. Check if you have permission to access this model (requires Pro/Enterprise subscription)');
        console.log('5. This model is in preview and may have access restrictions');
        
        throw error;
    }
}

// Run script
if (require.main === module) {
    testGPT5Codex().catch(error => {
        console.error('\n💥 Script execution failed');
        process.exit(1);
    });
}

module.exports = {
    testGPT5Codex,
    MODEL_ID,
    MODEL_NAME
};