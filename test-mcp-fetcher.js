/**
 * Test MCP Library Fetcher functionality
 * Verify fetching data from remote and saving to local
 */

const { app } = require('electron');
const path = require('path');

// Mock electron app environment
if (!app.isReady()) {
  // Set user data path for testing
  app.setPath('userData', '/Users/pumpedgechina/Library/Application Support/kosmos-app');
}

async function testMcpLibraryFetcher() {
  try {
    console.log('Starting MCP Library Fetcher test...');
    
    // Dynamically import McpLibraryFetcher
    const { McpLibraryFetcher } = await import('./src/main/lib/assetsFetcher/mcpLibraryFetcher.ts');
    
    const fetcher = McpLibraryFetcher.getInstance();
    
    console.log('Attempting to fetch library data...');
    const result = await fetcher.getLibraryData();
    
    if (result.success) {
      console.log('✅ Successfully fetched MCP library data!');
      console.log(`📦 Found ${result.data.mcp_servers.length} servers`);
      console.log(`📁 Data saved to: ${fetcher.getLibraryFilePath()}`);
      
      // Show first 3 server names
      if (result.data.mcp_servers.length > 0) {
        console.log('First few servers:');
        result.data.mcp_servers.slice(0, 3).forEach((server, index) => {
          console.log(`  ${index + 1}. ${server.name}`);
        });
      }
    } else {
      console.log('❌ Failed to fetch MCP library data:', result.error);
    }
    
  } catch (error) {
    console.error('❌ Error occurred during test:', error.message);
  }
}

// Run test
if (require.main === module) {
  testMcpLibraryFetcher().then(() => {
    console.log('Test completed');
    process.exit(0);
  }).catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}

module.exports = { testMcpLibraryFetcher };