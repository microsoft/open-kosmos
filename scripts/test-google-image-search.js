/**
 * Google Image Search Tool Test Script
 * Tests parallel search, HTML scraping, and debug file saving functionality
 */

const path = require('path');
const fs = require('fs');

// Add TypeScript support
require('ts-node').register({
  project: path.join(__dirname, '..', 'tsconfig.json'),
  transpileOnly: true,
  compilerOptions: {
    module: 'commonjs',
    target: 'es2020',
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    skipLibCheck: true
  }
});

// Import tool class
const { GoogleImageSearchTool } = require('../src/main/lib/mcpRuntime/builtinTools/googleImageSearchTool');

async function testGoogleImageSearch() {
  console.log('🖼️ === Google Image Search Tool Test Started ===');
  
  try {
    // Test parameters
    const testArgs = {
      queries: [
        'cute cats',
        'beautiful landscape photography',
        'modern architecture design'
      ],
      maxResults: 3,
      timeout: 180000 // 3 minute timeout
    };
    
    console.log(`📋 Test configuration:`);
    console.log(`   Number of queries: ${testArgs.queries.length}`);
    console.log(`   Query list: ${testArgs.queries.map(q => `"${q}"`).join(', ')}`);
    console.log(`   Max results per query: ${testArgs.maxResults}`);
    console.log(`   Timeout: ${testArgs.timeout / 1000} seconds`);
    console.log('');
    
    // Record start time
    const startTime = Date.now();
    console.log(`⏰ Start time: ${new Date().toISOString()}`);
    
    // Execute search
    console.log('🚀 Starting Google Image Search...');
    const result = await GoogleImageSearchTool.execute(testArgs);
    
    // Record end time
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    
    console.log(`✅ Search complete! Duration: ${duration.toFixed(2)} seconds`);
    console.log('');
    
    // Display result statistics
    console.log('📊 === Search Result Statistics ===');
    console.log(`Success status: ${result.success ? '✅ Success' : '❌ Failed'}`);
    console.log(`Total queries: ${result.totalQueries}`);
    console.log(`Total results: ${result.totalResults}`);
    console.log(`Result timestamp: ${result.timestamp}`);
    
    if (result.errors && result.errors.length > 0) {
      console.log('⚠️ Error messages:');
      result.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }
    console.log('');
    
    // Display detailed results
    if (result.results && result.results.length > 0) {
      console.log('🖼️ === Image Search Result Details ===');
      console.log('='.repeat(80));
      
      result.results.forEach((item, index) => {
        console.log(`${index + 1}. ${item.title}`);
        console.log(`   Thumbnail URL: ${item.thumbnailUrl}`);
        console.log(`   Source page: ${item.sourcePageUrl}`);
        console.log(`   Source site: ${item.source}`);
        console.log(`   Query source: ${item.query}`);
        if (item.width && item.height) {
          console.log(`   Image dimensions: ${item.width} x ${item.height}`);
        }
        if (item.fileSize) {
          console.log(`   File size: ${item.fileSize}`);
        }
        console.log('');
      });
    } else {
      console.log('📝 No image search results found');
      console.log('');
    }
    
    // Tool definition test
    console.log('⚙️ === Tool Definition Test ===');
    const toolDefinition = GoogleImageSearchTool.getDefinition();
    console.log(`Tool name: ${toolDefinition.name}`);
    console.log(`Tool description: ${toolDefinition.description.substring(0, 100)}...`);
    console.log(`Input schema: ${JSON.stringify(toolDefinition.inputSchema.properties.queries, null, 2)}`);
    console.log('');
    
    console.log('🎉 === Test Complete ===');
    
  } catch (error) {
    console.error('❌ Error occurred during test:');
    console.error(error);
    process.exit(1);
  }
}

// Run test
if (require.main === module) {
  testGoogleImageSearch();
}

module.exports = { testGoogleImageSearch };