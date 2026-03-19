/**
 * Google Web Search Tool Execution Test
 * Uses ts-node to directly run TypeScript source code to test search functionality
 */

const path = require('path');

async function testGoogleSearch() {
  console.log('🚀 Starting test for GoogleWebSearchTool.execute()');
  console.log('Time:', new Date().toLocaleString());
  console.log('');

  try {
    // Set up ts-node environment
    require('ts-node').register({
      transpileOnly: true,
      compilerOptions: {
        module: 'commonjs',
        target: 'es2020',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        moduleResolution: 'node'
      }
    });
    
    // Directly import TypeScript source code
    const toolPath = path.join(__dirname, '../src/main/lib/mcpRuntime/builtinTools/googleWebSearchTool.ts');
    console.log('📂 Loading module:', toolPath);
    
    const { GoogleWebSearchTool } = require(toolPath);
    
    if (!GoogleWebSearchTool) {
      throw new Error('Cannot find GoogleWebSearchTool class');
    }
    
    console.log('✅ Successfully loaded GoogleWebSearchTool');
    console.log('');
    
    // Prepare test parameters
    const testArgs = {
    //   queries: ['JavaScript tutorial', 'Node.js best practices'],
      queries: ["Netherlands election 2023 results", "Netherlands election 2023 latest news", "Netherlands general election latest news"],
      maxResults: 5,
      timeout: 60000
    };
    
    console.log('📋 Test parameters:');
    console.log(JSON.stringify(testArgs, null, 2));
    console.log('');
    
    console.log('🔍 Starting search...');
    const startTime = Date.now();
    
    // Call execute method
    const result = await GoogleWebSearchTool.execute(testArgs);
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    
    console.log('');
    console.log('✅ Search complete!');
    console.log(`⏱️  Duration: ${duration.toFixed(2)} seconds`);
    console.log('');
    
    // Print result summary
    console.log('📊 Result summary:');
    console.log(`  Success status: ${result.success}`);
    console.log(`  Total queries: ${result.totalQueries}`);
    console.log(`  Total results: ${result.totalResults}`);
    console.log(`  Timestamp: ${result.timestamp}`);
    
    if (result.errors && result.errors.length > 0) {
      console.log(`  Error count: ${result.errors.length}`);
    }
    
    console.log('');
    
    // Print detailed results
    if (result.results && result.results.length > 0) {
      console.log('🎯 Search result details:');
      console.log('='.repeat(80));
      
      result.results.forEach((item, index) => {
        console.log(`${index + 1}. ${item.title}`);
        console.log(`   URL: ${item.url}`);
        console.log(`   Site: ${item.site}`);
        console.log(`   Query: ${item.query}`);
        console.log(`   Description: ${item.caption.substring(0, 100)}${item.caption.length > 100 ? '...' : ''}`);
        console.log('');
      });
    }
    
    // Print error messages
    if (result.errors && result.errors.length > 0) {
      console.log('❌ Error messages:');
      result.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`);
      });
      console.log('');
    }
    
    console.log('🎉 Test complete!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('');
    console.error('💡 Ensure dependencies are installed:');
    console.error('  1. npm install ts-node typescript --save-dev');
    console.error('  2. npm install playwright');
    console.error('');
    console.error('🔍 Error details:', error);
  }
}

// Execute test
if (require.main === module) {
  testGoogleSearch().catch(console.error);
}