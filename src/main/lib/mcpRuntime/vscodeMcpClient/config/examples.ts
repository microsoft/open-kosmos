/**
 * Configuration Adapter Usage Examples
 * VSCode MCP Client configuration compatibility integration examples
 */

import { ConfigAdapter, createConfigAdapter } from './ConfigAdapter';
import { 
  detectVSCodeConfigs, 
  parseMcpConfig, 
  validateMcpServerConfig,
  quickConfigDetection 
} from './index';
import type { McpServerConfig, ConfigAdapterOptions } from './types';

// ==================== Basic Usage Examples ====================

/**
 * Example 1: Basic configuration detection
 */
export async function basicConfigDetectionExample() {
  
  try {
    const result = await detectVSCodeConfigs();
    
    if (result.success) {
      
      for (const configFile of result.configFiles) {
        if (configFile.exists && configFile.isValid) {
        }
      }
    } else {
    }
  } catch (error) {
  }
}

/**
 * Example 2: Configuration parsing
 */
export async function configParsingExample() {
  
  // VSCode settings.json format example
  const settingsJsonConfig = `{
    "mcp": {
      "servers": {
        "filesystem": {
          "type": "stdio",
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/files"],
          "env": {
            "DEBUG": "mcp:*"
          }
        }
      }
    }
  }`;
  
  // VSCode mcp.json format example
  const mcpJsonConfig = `{
    "servers": {
      "weather": {
        "type": "sse",
        "url": "http://localhost:3000/sse"
      }
    }
  }`;
  
  try {
    // Parse settings.json format
    const settingsResult = parseMcpConfig(settingsJsonConfig);
    if (settingsResult.success) {
    }
    
    // Parse mcp.json format
    const mcpResult = parseMcpConfig(mcpJsonConfig);
    if (mcpResult.success) {
    }
  } catch (error) {
  }
}

/**
 * Example 3: Configuration validation
 */
export async function configValidationExample() {
  
  const testConfigs: McpServerConfig[] = [
    {
      name: 'valid-stdio-server',
      transport: 'stdio',
      command: 'python',
      args: ['-m', 'mcp_server'],
      env: { DEBUG: 'true' }
    },
    {
      name: 'valid-http-server',
      transport: 'http',
      url: 'http://localhost:8000/mcp'
    },
    {
      name: 'invalid-server', // Missing required fields
      transport: 'stdio',
      // Missing command
    } as any
  ];
  
  for (const config of testConfigs) {
    const report = validateMcpServerConfig(config);
    
    if (report.errors.length > 0) {
    }
    
    if (report.warnings.length > 0) {
    }
  }
}

// ==================== Advanced Usage Examples ====================

/**
 * Example 4: Configuration adapter full lifecycle
 */
export async function configAdapterLifecycleExample() {
  
  // Create configuration adapter
  const options: ConfigAdapterOptions = {
    autoDetection: true,
    strictValidation: false,
    supportedPlatforms: ['macOS', 'Windows'],
    cacheTtl: 10 * 60 * 1000 // 10 minutes cache
  };
  
  const adapter = createConfigAdapter(options);
  
  // Listen to events
  adapter.on('detection-started', () => {
  });
  
  adapter.on('detection-completed', (result) => {
  });
  
  adapter.on('detection-failed', (error) => {
  });
  
  adapter.on('config-validated', (report) => {
  });
  
  try {
    // Start auto-detection
    const detectionResult = await adapter.startAutoDetection();
    
    // Get platform information
    const platformInfo = adapter.getPlatformInfo();
    
    // Get detection state
    const state = adapter.getDetectionState();
    
  } catch (error) {
  }
}

/**
 * Example 5: Configuration migration
 */
export async function configMigrationExample() {
  
  const adapter = createConfigAdapter({ strictValidation: false });
  
  const sourceConfigs: McpServerConfig[] = [
    {
      name: 'filesystem-server',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { DEBUG: 'mcp:*' }
    },
    {
      name: 'weather-api',
      transport: 'http',
      url: 'https://api.weather.com/mcp',
      env: { API_KEY: 'your-api-key' }
    }
  ];
  
  try {
    // Migrate to VSCode settings.json format
    const settingsResult = await adapter.migrateConfigs(sourceConfigs, 'vscode-settings');
    
    if (settingsResult.errors.length > 0) {
    }
    
    // Export to VSCode format
    const exportedSettings = adapter.exportToVSCodeFormat(sourceConfigs, 'settings.json');
    
    const exportedMcpJson = adapter.exportToVSCodeFormat(sourceConfigs, 'mcp.json');
    
  } catch (error) {
  }
}

// ==================== Quick Start Examples ====================

/**
 * Example 6: Quick configuration detection and usage
 */
export async function quickStartExample() {
  
  try {
    const result = await quickConfigDetection();
    
    if (result.success) {
      
      // Use the detected configuration to create server config
      if (result.parsedConfig) {
        const serverConfig: McpServerConfig = {
          name: result.parsedConfig.serverName || 'detected-server',
          transport: result.parsedConfig.transportType === 'StreamableHttp' ? 'http' : 
                    result.parsedConfig.transportType === 'sse' ? 'sse' : 'stdio',
          command: result.parsedConfig.config.command,
          args: result.parsedConfig.config.args,
          url: result.parsedConfig.config.url,
          env: result.parsedConfig.config.env
        };
        
        // Validate the converted configuration
        const validation = validateMcpServerConfig(serverConfig);
      }
    } else {
    }
  } catch (error) {
  }
}

// ==================== Error Handling Examples ====================

/**
 * Example 7: Error handling and recovery
 */
export async function errorHandlingExample() {
  
  const adapter = createConfigAdapter();
  
  // Listen to error events
  adapter.on('detection-failed', (error) => {
    
    // Implement retry logic
    setTimeout(async () => {
      try {
        await adapter.startAutoDetection();
      } catch (retryError) {
      }
    }, 5000);
  });
  
  try {
    // Intentionally trigger a potential error scenario
    await adapter.detectConfigFile('/nonexistent/path/config.json');
  } catch (error) {
    
    // Fall back to default configuration detection
    await adapter.startAutoDetection();
  }
}

// ==================== Performance Monitoring Examples ====================

/**
 * Example 8: Performance monitoring
 */
export async function performanceMonitoringExample() {
  
  const adapter = createConfigAdapter({ cacheTtl: 30000 }); // 30 second cache
  
  // Monitor detection performance
  const startTime = Date.now();
  
  adapter.on('detection-completed', () => {
    const endTime = Date.now();
  });
  
  // Test cache performance
  await adapter.startAutoDetection();
  
  const cacheStartTime = Date.now();
  await adapter.startAutoDetection();
  const cacheEndTime = Date.now();
  
  // Clear cache and re-test
  adapter.clearCache();
  const noCacheStartTime = Date.now();
  await adapter.startAutoDetection();
  const noCacheEndTime = Date.now();
}

// ==================== Comprehensive Examples ====================

/**
 * Run all examples
 */
export async function runAllExamples() {
  const examples = [
    { name: 'Basic configuration detection', fn: basicConfigDetectionExample },
    { name: 'Configuration parsing', fn: configParsingExample },
    { name: 'Configuration validation', fn: configValidationExample },
    { name: 'Adapter lifecycle', fn: configAdapterLifecycleExample },
    { name: 'Configuration migration', fn: configMigrationExample },
    { name: 'Quick start', fn: quickStartExample },
    { name: 'Error handling', fn: errorHandlingExample },
    { name: 'Performance monitoring', fn: performanceMonitoringExample }
  ];
  
  
  for (const example of examples) {
    
    try {
      await example.fn();
    } catch (error) {
    }
    
    // Add delay to observe output
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
}

// If running this file directly, execute all examples
if (require.main === module) {
  runAllExamples().catch(console.error);
}