#!/usr/bin/env node

/**
 * GitHub Copilot Gemini 2.0 Flash Model API Test Script
 * Based on vscode-copilot-chat implementation
 */

const https = require('https');
const { v4: uuidv4 } = require('uuid');

// GitHub Copilot auth info - set environment variables or replace with actual tokens
const TOKENS = {
    "refresh": process.env.GITHUB_COPILOT_REFRESH_TOKEN || "YOUR_REFRESH_TOKEN_HERE",
    "access": process.env.GITHUB_COPILOT_ACCESS_TOKEN || "YOUR_ACCESS_TOKEN_HERE",
    "expires": parseInt(process.env.GITHUB_COPILOT_TOKEN_EXPIRES) || Date.now() + 24 * 60 * 60 * 1000 // Defaults to 24 hours from now
};

// Verify tokens are set
if (TOKENS.refresh === "YOUR_REFRESH_TOKEN_HERE" || TOKENS.access === "YOUR_ACCESS_TOKEN_HERE") {
    console.error('❌ Please set GitHub Copilot auth info:');
    console.error('   export GITHUB_COPILOT_REFRESH_TOKEN="your_refresh_token"');
    console.error('   export GITHUB_COPILOT_ACCESS_TOKEN="your_access_token"');
    console.error('   export GITHUB_COPILOT_TOKEN_EXPIRES="timestamp"');
    process.exit(1);
}

// Model ID (based on fetched model list)
const GEMINI_2_0_FLASH_MODEL = 'gemini-2.0-flash-001';

// CAPI endpoint configuration
const CAPI_BASE_URL = 'api.githubcopilot.com';
const CHAT_COMPLETIONS_ENDPOINT = '/chat/completions';

/**
 * Create chat completion request
 */
function createChatCompletionRequest(messages, modelId = GEMINI_2_0_FLASH_MODEL, options = {}) {
    const requestBody = {
        model: modelId,
        messages: messages,
        max_tokens: options.max_tokens || 4096,
        temperature: options.temperature || 0.7,
        top_p: options.top_p || 1.0,
        stream: options.stream || false,
        n: options.n || 1,
        ...options
    };

    // Remove undefined values
    Object.keys(requestBody).forEach(key => {
        if (requestBody[key] === undefined) {
            delete requestBody[key];
        }
    });

    return requestBody;
}

/**
 * Send chat request to GitHub Copilot CAPI
 */
function sendChatRequest(requestBody) {
    return new Promise((resolve, reject) => {
        const requestId = uuidv4();
        const sessionId = uuidv4();
        const machineId = uuidv4();
        
        const postData = JSON.stringify(requestBody);
        
        const options = {
            hostname: CAPI_BASE_URL,
            port: 443,
            path: CHAT_COMPLETIONS_ENDPOINT,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${TOKENS.access}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'Accept': 'application/json',
                'User-Agent': 'GitHubCopilotChat/0.22.4',
                'Editor-Version': 'vscode/1.95.0',
                'Editor-Plugin-Version': '0.22.4',
                'Openai-Organization': 'github-copilot',
                'Openai-Intent': 'conversation-panel',
                'VScode-SessionId': sessionId,
                'VScode-MachineId': machineId,
                'X-Request-Id': requestId,
                'Copilot-Integration-Id': 'vscode-chat'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                console.log(`✅ HTTP Status: ${res.statusCode}`);
                console.log('📤 Response Headers:', JSON.stringify(res.headers, null, 2));
                
                if (res.statusCode === 200) {
                    try {
                        const jsonResponse = JSON.parse(data);
                        resolve(jsonResponse);
                    } catch (parseError) {
                        reject(new Error(`JSON parse error: ${parseError.message}\nResponse body: ${data}`));
                    }
                } else {
                    reject(new Error(`Request failed: HTTP ${res.statusCode}\nResponse body: ${data}`));
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
async function testGemini20Flash() {
    console.log('🚀 Starting Gemini 2.0 Flash model API test...\n');
    
    try {
        // Check token expiration time
        const now = Date.now();
        if (now >= TOKENS.expires) {
            console.warn('⚠️  Warning: Access token may have expired');
        } else {
            const remaining = Math.floor((TOKENS.expires - now) / 1000 / 60 / 60);
            console.log(`✅ Token valid for: ${remaining} hours`);
        }

        // Test messages
        const messages = [
            {
                role: "user",
                content: "Hello! Please describe the main features and advantages of the Google Gemini 2.0 Flash model."
            }
        ];

        console.log('📝 Request message:', JSON.stringify(messages, null, 2));
        console.log(`🎯 Target model: ${GEMINI_2_0_FLASH_MODEL}\n`);

        // Create request
        const requestBody = createChatCompletionRequest(messages, GEMINI_2_0_FLASH_MODEL, {
            max_tokens: 2048,
            temperature: 0.7,
            stream: false
        });

        console.log('📤 Request body:', JSON.stringify(requestBody, null, 2));
        console.log('\n⏳ Sending request...\n');

        // Send request
        const response = await sendChatRequest(requestBody);

        console.log('🎉 Request successful!');
        console.log('📥 Full response:', JSON.stringify(response, null, 2));

        // Extract and display reply content
        if (response.choices && response.choices.length > 0) {
            const assistantMessage = response.choices[0].message;
            console.log('\n💬 Assistant reply:');
            console.log('-------------------');
            console.log(assistantMessage.content);
            console.log('-------------------');
            
            if (response.usage) {
                console.log('\n📊 Token usage stats:');
                console.log(`   Input tokens: ${response.usage.prompt_tokens}`);
                console.log(`   Output tokens: ${response.usage.completion_tokens}`);
                console.log(`   Total tokens: ${response.usage.total_tokens}`);
            }
        }

        return response;

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        if (error.stack) {
            console.error('🐛 Error stack:', error.stack);
        }
        throw error;
    }
}

/**
 * Streaming response test
 */
async function testStreamingResponse() {
    console.log('\n🌊 Starting streaming response test...\n');
    
    const messages = [
        {
            role: "user", 
            content: "Please write a short poem about artificial intelligence with a sense of rhythm."
        }
    ];

    const requestBody = createChatCompletionRequest(messages, GEMINI_2_0_FLASH_MODEL, {
        max_tokens: 1024,
        temperature: 0.8,
        stream: true
    });

    return new Promise((resolve, reject) => {
        const requestId = uuidv4();
        const sessionId = uuidv4();
        const machineId = uuidv4();
        
        const postData = JSON.stringify(requestBody);
        
        const options = {
            hostname: CAPI_BASE_URL,
            port: 443,
            path: CHAT_COMPLETIONS_ENDPOINT,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${TOKENS.access}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'Accept': 'text/event-stream',
                'User-Agent': 'GitHubCopilotChat/0.22.4',
                'Editor-Version': 'vscode/1.95.0',
                'Editor-Plugin-Version': '0.22.4',
                'VScode-SessionId': sessionId,
                'VScode-MachineId': machineId,
                'X-Request-Id': requestId,
                'Copilot-Integration-Id': 'vscode-chat'
            }
        };

        const req = https.request(options, (res) => {
            console.log(`✅ Streaming response status: ${res.statusCode}`);
            
            let buffer = '';
            
            res.on('data', (chunk) => {
                buffer += chunk.toString();
                
                // Process SSE data
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') {
                            console.log('\n✅ Streaming response complete');
                            resolve();
                            return;
                        }
                        
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.choices && parsed.choices[0].delta.content) {
                                process.stdout.write(parsed.choices[0].delta.content);
                            }
                        } catch (e) {
                            // Ignore parse errors
                        }
                    }
                }
            });
            
            res.on('end', () => {
                resolve();
            });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

// Main program execution
if (require.main === module) {
    (async () => {
        try {
            console.log('=' .repeat(60));
            console.log('🤖 GitHub Copilot Gemini 2.0 Flash Model Test');
            console.log('=' .repeat(60));
            
            // Basic chat test
            await testGemini20Flash();
            
            console.log('\n' + '='.repeat(60));
            
            // Streaming response test
            await testStreamingResponse();
            
            console.log('\n' + '='.repeat(60));
            console.log('🎊 All tests complete!');
            
        } catch (error) {
            console.error('\n❌ Program execution failed:', error.message);
            process.exit(1);
        }
    })();
}

module.exports = {
    testGemini20Flash,
    testStreamingResponse,
    createChatCompletionRequest,
    sendChatRequest,
    GEMINI_2_0_FLASH_MODEL
};