# VSCode MCP Client - Configuration Compatibility Integration Module

## Overview

The configuration compatibility integration module provides seamless integration between the VSCode MCP Client and existing OpenKosmos configuration components. It supports automatic configuration detection, multi-format configuration parsing, configuration validation, and migration.

## Features

### 🔍 Automatic Configuration Detection
- Cross-platform config file auto-discovery (macOS, Windows, Linux)
- Intelligent priority ordering and multi-path scanning
- Real-time config file status monitoring

### 📝 Multi-Format Configuration Parsing
- Supports VSCode `settings.json` format
- Supports VSCode `mcp.json` format
- Supports OpenKosmos custom format
- Auto-detection for 10+ predefined formats

### ✅ Configuration Validation and Compatibility Checks
- Enterprise-grade configuration validation rules
- Transport type consistency checks
- Configuration quality scoring system
- Batch configuration validation support

### 🔄 Configuration Migration and Conversion
- Bidirectional conversion between VSCode and OpenKosmos formats
- Batch configuration migration
- Configuration format normalization
- Migration error recovery mechanisms

### ⚡ Smart Cache Management
- LRU + TTL dual cache strategy
- Memory usage optimization
- Cache invalidation and update mechanisms

## Architecture

```
config/
├── types.ts           # Type definitions and interfaces
├── utils.ts           # Utility functions and platform detection
├── detector.ts        # Config file detection and discovery
├── parser.ts          # Configuration parsing and format conversion
├── validator.ts       # Configuration validation and compatibility checks
├── ConfigAdapter.ts   # Main configuration adapter class
├── index.ts           # Module entry point and convenience functions
├── examples.ts        # Usage examples and demos
└── README.md          # This document
```

## Quick Start

### Basic Usage

```typescript
import { quickConfigDetection, createDefaultConfigAdapter } from './config';

// Quick configuration detection
const result = await quickConfigDetection();
if (result.success) {
  console.log('Config detected:', result.bestConfigPath);
  console.log('Parsed result:', result.parsedConfig);
}

// Create configuration adapter
const adapter = createDefaultConfigAdapter();
await adapter.startAutoDetection();
```

### Configuration Adapter Lifecycle

```typescript
import { ConfigAdapter } from './config';

const adapter = new ConfigAdapter({
  autoDetection: true,
  strictValidation: false,
  cacheTtl: 5 * 60 * 1000 // 5-minute cache
});

// Listen to events
adapter.on('detection-completed', (result) => {
  console.log(`Found ${result.totalServersFound} servers`);
});

adapter.on('config-validated', (report) => {
  console.log(`Config validated: ${report.serverName} - ${report.isValid ? '✅' : '❌'}`);
});

// Start detection
await adapter.startAutoDetection();
```

### Configuration Parsing

```typescript
import { parseMcpConfig, parseVSCodeConfigToInternal } from './config';

// Parse generic format
const result = parseMcpConfig(configContent);
if (result.success) {
  console.log('Server name:', result.data.serverName);
  console.log('Transport type:', result.data.transportType);
  console.log('Detected format:', result.data.detectedFormat);
}

// Parse VSCode-specific format
const vscodeResult = parseVSCodeConfigToInternal(content, 'settings.json');
```

### Configuration Validation

```typescript
import { validateMcpServerConfig, validateBatchImport } from './config';

// Validate a single config
const report = validateMcpServerConfig(serverConfig);
console.log(`Validation result: ${report.isValid ? '✅' : '❌'}`);
console.log(`Quality score: ${report.score}/100`);

// Batch config validation
const batchResult = validateBatchImport(serverConfigs);
console.log(`Batch valid: ${batchResult.isValid ? '✅' : '❌'}`);
```

### Configuration Migration

```typescript
// Migrate to VSCode format
const migrationResult = await adapter.migrateConfigs(
  sourceConfigs,
  'vscode-settings'
);

// Export to VSCode format
const settingsJson = adapter.exportToVSCodeFormat(configs, 'settings.json');
const mcpJson = adapter.exportToVSCodeFormat(configs, 'mcp.json');
```

## API Reference

### ConfigAdapter Class

The main configuration adapter class providing full configuration management.

#### Constructor

```typescript
constructor(options?: ConfigAdapterOptions)
```

#### Key Methods

- `startAutoDetection()`: Start automatic configuration detection
- `detectConfigFile(filePath)`: Detect a specific configuration file
- `parseConfig(content, format?)`: Parse configuration content
- `validateConfig(config)`: Validate a configuration
- `migrateConfigs(configs, targetFormat)`: Migrate configurations
- `exportToVSCodeFormat(configs, format)`: Export to VSCode format

#### Events

- `detection-started`: Configuration detection started
- `detection-completed`: Detection complete
- `detection-failed`: Detection failed
- `config-validated`: Configuration validation complete
- `config-migrated`: Configuration migration complete

### Utility Functions

#### Configuration Detection

- `detectVSCodeConfigs()`: Detect VSCode configuration files
- `detectVscodeConfigFile()`: Get the first valid configuration path
- `detectSingleConfigFile()`: Detect a single configuration file

#### Configuration Parsing

- `parseMcpConfig()`: Parse generic MCP configuration
- `parseVSCodeConfigToInternal()`: Parse VSCode-format configuration
- `formatToStandardJson()`: Format to standard JSON
- `formatToVSCodeSettings()`: Format to VSCode settings.json

#### Configuration Validation

- `validateMcpServerConfig()`: Validate a single server configuration
- `validateBatchImport()`: Batch validate configurations
- `validateVSCodeConfig()`: Validate VSCode configuration format

#### Convenience Functions

- `quickConfigDetection()`: Quick configuration detection and parsing
- `checkConfigCompatibility()`: Check configuration compatibility
- `createDefaultConfigAdapter()`: Create a default configuration adapter

## Supported Configuration Formats

### VSCode settings.json Format

```json
{
  "mcp": {
    "servers": {
      "filesystem": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
        "env": {
          "DEBUG": "mcp:*"
        }
      }
    }
  }
}
```

### VSCode mcp.json Format

```json
{
  "servers": {
    "weather": {
      "type": "sse",
      "url": "http://localhost:3000/sse"
    }
  },
  "inputs": []
}
```

### OpenKosmos Format

```json
{
  "name": "my-server",
  "transport": "stdio",
  "command": "python",
  "args": ["-m", "mcp_server"],
  "env": {
    "DEBUG": "true"
  }
}
```

## Platform Support

### macOS
- **Path**: `~/Library/Application Support/Code/User/`
- **Formats**: `mcp.json`, `settings.json`
- **Variants**: Standard, Insiders, OSS, Homebrew

### Windows
- **Path**: `%APPDATA%\Code\User\`
- **Formats**: `mcp.json`
- **Variants**: Standard, Insiders, OSS, Portable, System-level

### Linux
- **Path**: `~/.config/Code/User/`
- **Formats**: `settings.json`
- **Variants**: Standard, Insiders, OSS

## Error Handling

The configuration module provides comprehensive error handling:

### Detection Errors
- File does not exist
- File permission issues
- Platform not supported

### Parse Errors
- Malformed JSON
- Invalid configuration structure
- Field type mismatch

### Validation Errors
- Missing required fields
- Invalid transport type
- Malformed URL

### Migration Errors
- Incompatible formats
- Data conversion failure
- Partial failure in batch operations

## Performance Optimization

### Cache Strategy
- **LRU Cache**: Least Recently Used eviction
- **TTL Expiry**: Time-based cache invalidation
- **Memory Management**: Smart memory usage control

### Detection Optimization
- **Priority Scan**: Detect by platform priority order
- **Early Exit**: Stop as soon as a valid config is found
- **Concurrent Detection**: Support parallel multi-path detection

### Parse Optimization
- **Format Cache**: Cache parsed results
- **Incremental Parsing**: Parse only changed portions
- **Stream Processing**: Stream-parse large files

## Testing and Validation

The configuration module includes a comprehensive test suite:

### Unit Tests
- Configuration detection functionality
- Parser accuracy
- Validation rule coverage
- Utility function correctness

### Integration Tests
- End-to-end configuration flow
- Multi-platform compatibility
- Error recovery mechanisms
- Performance benchmarks

### Compatibility Tests
- VSCode version compatibility
- Platform-specific tests
- Backward format compatibility
- Edge case handling

## Best Practices

### Configuration Management
1. **Use auto-detection**: Prefer `quickConfigDetection()`
2. **Listen to events**: Use the event system for state management
3. **Cache configs**: Set a reasonable cache TTL
4. **Error handling**: Implement robust error recovery

### Performance Optimization
1. **Batch operations**: Use batch validation and migration
2. **Async processing**: Use async APIs to avoid blocking
3. **Memory management**: Clear caches periodically
4. **Lazy loading**: Load configuration modules on demand

### Security Considerations
1. **Path validation**: Validate configuration file paths
2. **Permission checks**: Ensure file access permissions
3. **Sensitive data**: Handle environment variables carefully
4. **Input validation**: Strictly validate user input

## Version History

### v1.0.0
- ✅ Initial release
- ✅ Basic configuration detection and parsing
- ✅ VSCode format support
- ✅ Configuration validation
- ✅ Cross-platform support

### Future Plans
- 🔄 Real-time configuration monitoring
- 🔄 Configuration template system
- 🔄 Advanced validation rules
- 🔄 Configuration sync mechanism
- 🔄 Web UI support

## Support and Contributing

### Reporting Issues
When reporting an issue, please provide:
- Operating system and version
- VSCode version
- Configuration file content
- Error logs

### Contributing
1. Fork the project
2. Create a feature branch
3. Add test cases
4. Submit a Pull Request

## License

This module is part of the VSCode MCP Client and follows the project's overall license.
