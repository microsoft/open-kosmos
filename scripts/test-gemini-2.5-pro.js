#!/usr/bin/env node

/**
 * GitHub Copilot Gemini 2.5 Pro Model API Test Script
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
const GEMINI_2_5_PRO_MODEL = 'gemini-2.5-pro';

// CAPI endpoint configuration
const CAPI_BASE_URL = 'api.githubcopilot.com';
const CHAT_COMPLETIONS_ENDPOINT = '/chat/completions';

/**
 * Create chat completion request
 */
function createChatCompletionRequest(messages, modelId = GEMINI_2_5_PRO_MODEL, options = {}) {
    const requestBody = {
        model: modelId,
        messages: messages,
        max_tokens: options.max_tokens || 8192,
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
 * Complex reasoning task test
 */
async function testComplexReasoning() {
    console.log('🧠 Testing complex reasoning...\n');
    
    const messages = [
        {
            role: "user",
            content: `Please solve this logic puzzle:

A company has 5 employees: Alice, Bob, Carol, David, and Eve. Their job positions are: Manager, Engineer, Designer, Analyst, and Sales.

Given conditions:
1. Alice is not the Manager, nor Sales
2. Bob's position has more letters than Carol's
3. David is either the Analyst or the Engineer
4. Eve is not the Designer
5. Carol is not the Manager
6. The Manager's name has fewer letters than the Engineer's name

Please determine each person's specific position and explain your reasoning process in detail.`
        }
    ];

    const requestBody = createChatCompletionRequest(messages, GEMINI_2_5_PRO_MODEL, {
        max_tokens: 4096,
        temperature: 0.3
    });

    console.log('📤 Sending complex reasoning task...\n');
    
    const response = await sendChatRequest(requestBody);
    
    if (response.choices && response.choices.length > 0) {
        console.log('💬 Reasoning result:');
        console.log('-------------------');
        console.log(response.choices[0].message.content);
        console.log('-------------------');
    }
    
    return response;
}

/**
 * Code analysis task test
 */
async function testCodeAnalysis() {
    console.log('\n💻 Testing code analysis...\n');
    
    const messages = [
        {
            role: "user",
            content: `Please analyze the following JavaScript code, find potential issues and provide optimization suggestions:

\`\`\`javascript
function processData(data) {
    var result = [];
    for (var i = 0; i < data.length; i++) {
        if (data[i] != null) {
            var item = data[i];
            if (item.type == 'important') {
                result.push({
                    id: item.id,
                    value: item.value * 2,
                    processed: true
                });
            }
        }
    }
    return result;
}

// Usage example
var inputData = [
    { id: 1, value: 10, type: 'important' },
    null,
    { id: 2, value: '20', type: 'important' },
    { id: 3, value: 30, type: 'normal' }
];

var output = processData(inputData);
console.log(output);
\`\`\`

Please analyze from the following aspects:
1. Code quality issues
2. Potential runtime errors
3. Performance optimization suggestions
4. Modernization improvement suggestions`
        }
    ];

    const requestBody = createChatCompletionRequest(messages, GEMINI_2_5_PRO_MODEL, {
        max_tokens: 4096,
        temperature: 0.2
    });

    console.log('📤 Sending code analysis task...\n');
    
    const response = await sendChatRequest(requestBody);
    
    if (response.choices && response.choices.length > 0) {
        console.log('💬 Analysis result:');
        console.log('-------------------');
        console.log(response.choices[0].message.content);
        console.log('-------------------');
    }
    
    return response;
}

/**
 * Long text processing test
 */
async function testLongContextHandling() {
    console.log('\n📚 Testing long text processing...\n');
    
    const longText = `
Artificial Intelligence (AI) is a branch of computer science that aims to create systems capable of performing tasks that typically require human intelligence. Since the 1950s, artificial intelligence has experienced multiple waves of development and periods of decline.

Early Development Phase (1950s-1970s):
During this phase, researchers were highly optimistic, believing that general artificial intelligence could be achieved soon. The 1956 Dartmouth Conference is considered the birthmark of artificial intelligence. Early successes included logic reasoning programs, chess programs, and simple natural language processing systems.

First AI Winter (1970s-1980s):
As limitations in computing power and a deeper understanding of problem complexity emerged, AI research faced setbacks. Funding was cut and research stagnated. However, there were also important advances during this period, such as the development of expert systems.

Revival and Second Boom (1980s-1990s):
The commercial success of expert systems brought a new round of investment. Progress was made in machine learning, neural networks, and other fields. But bottlenecks were encountered again in the late 1990s.

Modern AI Era (2000s to present):
The widespread adoption of the internet brought massive amounts of data, and improvements in computing power made deep learning possible. The 2012 breakthrough of AlexNet in image recognition marked the beginning of the deep learning era. Subsequently, AI has made significant progress in various fields:

1. Computer Vision: From image classification to object detection and semantic segmentation
2. Natural Language Processing: From statistical methods to the Transformer architecture, then to large language models like GPT and BERT
3. Speech Recognition: Significant improvements in accuracy, enabling real-time speech-to-text
4. Recommendation Systems: Widely used in e-commerce, social media, and streaming platforms
5. Autonomous Driving: From ADAS to the exploration of fully autonomous driving
6. Game AI: From Deep Blue to AlphaGo to AlphaStar

Current Challenges and Opportunities:
Technical challenges include model interpretability, fairness, and robustness. Ethical challenges involve privacy protection, employment impact, and algorithmic bias. On the regulatory front, countries are developing relevant policy frameworks.

Future Outlook:
AGI (Artificial General Intelligence) remains a long-term goal. In the short term, AI will be deeply applied in more vertical domains, converging with other technologies such as IoT, blockchain, and quantum computing. Human-AI collaboration will become the mainstream paradigm.
    `.trim();
    
    const messages = [
        {
            role: "user",
            content: `Please carefully read the following text about the history of artificial intelligence development, then answer the questions:

${longText}

Questions:
1. Please summarize the main phases of AI development and their characteristics
2. What are the important technological breakthroughs in the modern AI era?
3. What are the main challenges facing current AI development?
4. What is the outlook for the future development of AI?

Please provide detailed answers based on the text content, and feel free to supplement with your own knowledge where appropriate.`
        }
    ];

    const requestBody = createChatCompletionRequest(messages, GEMINI_2_5_PRO_MODEL, {
        max_tokens: 6144,
        temperature: 0.4
    });

    console.log('📤 Sending long text processing task...\n');
    
    const response = await sendChatRequest(requestBody);
    
    if (response.choices && response.choices.length > 0) {
        console.log('💬 Processing result:');
        console.log('-------------------');
        console.log(response.choices[0].message.content);
        console.log('-------------------');
    }
    
    return response;
}

/**
 * Main test function
 */
async function testGemini25Pro() {
    console.log('🚀 Starting Gemini 2.5 Pro model API test...\n');
    
    try {
        // Check token expiration time
        const now = Date.now();
        if (now >= TOKENS.expires) {
            console.warn('⚠️  Warning: Access token may have expired');
        } else {
            const remaining = Math.floor((TOKENS.expires - now) / 1000 / 60 / 60);
            console.log(`✅ Token valid for: ${remaining} hours`);
        }

        // Basic conversation test
        const messages = [
            {
                role: "user",
                content: "Hello! Please describe the main improvements and advantages of Google Gemini 2.5 Pro compared to 2.0 Flash. Please answer in detail."
            }
        ];

        console.log('📝 Request message:', JSON.stringify(messages, null, 2));
        console.log(`🎯 Target model: ${GEMINI_2_5_PRO_MODEL}\n`);

        const requestBody = createChatCompletionRequest(messages, GEMINI_2_5_PRO_MODEL, {
            max_tokens: 4096,
            temperature: 0.7,
            stream: false
        });

        console.log('📤 Request body:', JSON.stringify(requestBody, null, 2));
        console.log('\n⏳ Sending request...\n');

        const response = await sendChatRequest(requestBody);

        console.log('🎉 Request successful!');
        console.log('📥 Full response:', JSON.stringify(response, null, 2));

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
        console.error('❌ Basic test failed:', error.message);
        throw error;
    }
}

// Main program execution
if (require.main === module) {
    (async () => {
        try {
            console.log('=' .repeat(70));
            console.log('🤖 GitHub Copilot Gemini 2.5 Pro Full Test Suite');
            console.log('=' .repeat(70));
            
            // Basic conversation test
            console.log('\n📋 Test 1: Basic conversation');
            console.log('-'.repeat(40));
            await testGemini25Pro();
            
            console.log('\n\n📋 Test 2: Complex reasoning');
            console.log('-'.repeat(40));
            await testComplexReasoning();
            
            console.log('\n\n📋 Test 3: Code analysis');
            console.log('-'.repeat(40));
            await testCodeAnalysis();
            
            console.log('\n\n📋 Test 4: Long text processing');
            console.log('-'.repeat(40));
            await testLongContextHandling();
            
            console.log('\n' + '='.repeat(70));
            console.log('🎊 All tests complete! Gemini 2.5 Pro model verification finished');
            
        } catch (error) {
            console.error('\n❌ Program execution failed:', error.message);
            process.exit(1);
        }
    })();
}

module.exports = {
    testGemini25Pro,
    testComplexReasoning,
    testCodeAnalysis,
    testLongContextHandling,
    createChatCompletionRequest,
    sendChatRequest,
    GEMINI_2_5_PRO_MODEL
};