const https = require('https');

// GitHub Copilot authentication info - please set environment variables or replace with actual tokens
const tokens = {
    "refresh": process.env.GITHUB_COPILOT_REFRESH_TOKEN || "YOUR_REFRESH_TOKEN_HERE",
    "access": process.env.GITHUB_COPILOT_ACCESS_TOKEN || "YOUR_ACCESS_TOKEN_HERE",
    "expires": parseInt(process.env.GITHUB_COPILOT_TOKEN_EXPIRES) || Date.now() + 24 * 60 * 60 * 1000 // Expires after 24 hours by default
};

// Verify token is set
if (tokens.refresh === "YOUR_REFRESH_TOKEN_HERE" || tokens.access === "YOUR_ACCESS_TOKEN_HERE") {
    console.error('❌ Please set GitHub Copilot authentication info:');
    console.error('   export GITHUB_COPILOT_REFRESH_TOKEN="your_refresh_token"');
    console.error('   export GITHUB_COPILOT_ACCESS_TOKEN="your_access_token"');
    console.error('   export GITHUB_COPILOT_TOKEN_EXPIRES="timestamp"');
    process.exit(1);
}

// Test texts
const testTexts = [
    "Hello world, this is a test embedding.",
    "GitHub Copilot is an AI coding assistant.",
    "Machine learning and natural language processing are fascinating fields."
];

async function testEmbeddingAda002() {
    try {
        console.log('=== GitHub Copilot text-embedding-ada-002 Model Test ===\n');
        
        // Request body - using correct format based on source code analysis
        const requestBody = {
            input: testTexts,  // Use input instead of inputs
            model: "text-embedding-ada-002"
            // Ada-002 does not support dimensions parameter, uses fixed 1536 dimensions
        };

        const postData = JSON.stringify(requestBody);

        const options = {
            hostname: 'api.githubcopilot.com',
            path: '/embeddings',  // Use /embeddings endpoint
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tokens.access}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'User-Agent': 'GitHubCopilotChat/0.22.4',
                'Editor-Version': 'vscode/1.96.0',
                'Editor-Plugin-Version': 'copilot-chat/0.22.4',
                'Openai-Organization': 'github-copilot',
                'Openai-Intent': 'conversation-panel',
                'X-Request-Id': `req_${Date.now()}`,
                'X-Github-Api-Version': '2023-07-07',
                'VScode-SessionId': `session_${Date.now()}`,
                'Vscode-MachineId': `machine_${Date.now()}`,
                'X-Interaction-Type': 'copilot-panel'
            }
        };

        const response = await makeRequest(options, postData);
        
        console.log('Request successful!');
        console.log('Status code:', response.statusCode);
        console.log('Response headers:', JSON.stringify(response.headers, null, 2));
        
        if (response.statusCode === 200) {
            const responseData = JSON.parse(response.data);
            console.log('\n=== Embedding Results ===');
            console.log('Model:', responseData.model);
            console.log('Usage:', responseData.usage || 'N/A');
            
            if (responseData.data && Array.isArray(responseData.data)) {
                console.log(`\nSuccessfully obtained embeddings for ${responseData.data.length} texts:`);
                
                responseData.data.forEach((item, index) => {
                    console.log(`\nText ${index + 1}: "${testTexts[index]}"`);
                    console.log(`Embedding dimensions: ${item.embedding ? item.embedding.length : 'N/A'}`);
                    if (item.embedding && item.embedding.length > 0) {
                        console.log(`First 5 values: [${item.embedding.slice(0, 5).join(', ')}...]`);
                        
                        // Calculate vector norm
                        const norm = Math.sqrt(item.embedding.reduce((sum, val) => sum + val * val, 0));
                        console.log(`Vector norm: ${norm.toFixed(6)}`);
                    }
                });
            }
        } else {
            console.log('\nRequest failed!');
            console.log('Error response:', response.data);
        }

    } catch (error) {
        console.error('Test error:', error.message);
        if (error.response) {
            console.error('Error status code:', error.response.statusCode);
            console.error('Error response body:', error.response.data);
        }
    }
}

function makeRequest(options, postData) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    data: data
                });
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

// Run test
testEmbeddingAda002();