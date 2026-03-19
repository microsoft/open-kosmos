# Unified Terminal Instance Manager

## Overview

The Unified Terminal Instance Manager is a cross-platform terminal process management system designed specifically for the Kosmos project, providing unified management and coordination of all terminal operations. It supports Windows and macOS, offering efficient process pool management, lifecycle control, and resource cleanup.

## Key Features

### 🚀 Core Functionality

- **Cross-Platform Support**: Native support for Windows and macOS, automatically adapting to different platform shell environments
- **Unified Interface**: Provides a consistent API interface for command execution and MCP communication
- **Intelligent Process Pool**: Automatic terminal instance management with reuse and cleanup mechanisms
- **Lifecycle Management**: Graceful process startup, shutdown, and resource cleanup
- **Error Recovery**: Automatic handling of process exceptions and timeouts

### 🛠️ Technical Highlights

- **Type Safety**: Complete TypeScript type support
- **Event-Driven**: Async event handling based on EventEmitter
- **Resource Optimization**: Intelligent memory and process resource management
- **Flexible Configuration**: Supports environment variables, working directories, timeouts, and various configuration options

## Architecture Design

### Core Components

```
├── types.ts                    # Type definitions and interfaces
├── PlatformConfigManager.ts    # Platform configuration manager
├── TerminalInstance.ts         # Terminal instance implementation
├── TerminalManager.ts          # Unified manager
├── adapters.ts                 # Adapter functions
└── index.ts                   # Module exports
```

### Design Patterns

1. **Singleton Pattern**: `TerminalManager` uses singleton to ensure global uniqueness
2. **Factory Pattern**: Creates specific types of terminal instances based on different needs
3. **Adapter Pattern**: Provides seamless integration interfaces for existing components
4. **Strategy Pattern**: Supports different shell execution strategies

## Usage

### Basic Usage

```typescript
import { getTerminalManager, TerminalConfig } from '../terminalManager';

// Get manager instance
const manager = getTerminalManager();

// Execute a one-off command
const config: TerminalConfig = {
  command: 'ls',
  args: ['-la'],
  cwd: '/path/to/directory',
  type: 'command',
  timeoutMs: 30000
};

const result = await manager.executeCommand(config);
console.log('Output:', result.stdout);
```

### MCP Transport Instance

```typescript
// Create persistent MCP transport
const mcpConfig: TerminalConfig = {
  command: 'python',
  args: ['-m', 'mcp_server'],
  cwd: '/path/to/server',
  type: 'mcp_transport',
  persistent: true
};

const instance = await manager.createMcpTransport(mcpConfig);

// Listen for messages
instance.on('message', (message) => {
  console.log('Received:', message);
});

// Send message
instance.send('{"jsonrpc": "2.0", "method": "initialize"}');
```

### Using Adapters

```typescript
import { createExecuteCommandAdapter } from '../terminalManager';

// Create adapter for existing components
const adapter = await createExecuteCommandAdapter();

const result = await adapter.execute({
  command: 'npm',
  args: ['install'],
  cwd: './project',
  timeoutSeconds: 120
});
```

## Integration

### ExecuteCommandTool Integration

The existing [`ExecuteCommandTool`](src/main/lib/mcpRuntime/builtinTools/executeCommandTool.ts) has been refactored to use the unified terminal manager:

```typescript
// Existing interface remains unchanged, internally uses the new manager
const result = await ExecuteCommandTool.execute({
  command: 'git',
  args: ['status'],
  cwd: '/project/path',
  timeoutSeconds: 30
});
```

### VscodeStdioTransport Integration

The refactored [`VscodeStdioTransport`](src/main/lib/mcpRuntime/vscodeMcpClient/transport/VscodeStdioTransport.ts) uses the unified terminal manager:

```typescript
// Interface is fully compatible, internally uses the new manager
const transport = new VscodeStdioTransport({
  command: 'mcp-server',
  args: ['--stdio'],
  cwd: '/server/path'
});

await transport.start();
transport.send('message');
```

## Configuration Options

### TerminalConfig Interface

```typescript
interface TerminalConfig {
  // Basic configuration
  command: string;              // Command to execute
  args: string[];              // Command arguments
  cwd: string;                 // Working directory
  env?: Record<string, string | null | undefined>; // Environment variables
  
  // Execution type
  type: 'command' | 'mcp_transport';
  
  // Shell configuration
  shell?: 'powershell' | 'cmd' | 'bash' | 'sh' | 'zsh';
  
  // Timeout and limits
  timeoutMs?: number;          // Timeout (milliseconds)
  maxOutputLength?: number;    // Maximum output length
  
  // Advanced configuration
  envFile?: string;           // Environment variable file path
  persistent?: boolean;       // Whether the process is persistent
  instanceId?: string;        // Instance identifier
}
```

### Platform Configuration

The system automatically detects the current platform and applies the appropriate configuration:

- **Windows**: Defaults to PowerShell, supports cmd, bash, zsh
- **macOS**: Defaults to zsh, supports bash, sh, and pwsh
- **Linux**: Defaults to bash, supports zsh, sh, and pwsh

## Best Practices

### 1. Choose the Appropriate Instance Type

- Use `'command'` type for one-off command execution
- Use `'mcp_transport'` type for persistent communication channels

### 2. Resource Management

```typescript
// Periodically clean up idle instances
const stats = manager.getStats();
console.log(`Current instance count: ${stats.totalInstances}`);

// Clean up all resources on application exit
process.on('exit', async () => {
  await manager.dispose();
});
```

### 3. Error Handling

```typescript
try {
  const result = await manager.executeCommand(config);
  // Handle success result
} catch (error) {
  console.error('Command execution failed:', error.message);
  // Handle error case
}
```

### 4. Monitoring and Debugging

```typescript
// Get manager statistics
const stats = manager.getStats();
console.log('Running instances:', stats.runningInstances);
console.log('Error instances:', stats.errorInstances);

// Get all instance info
const instances = manager.getAllInstances();
instances.forEach(info => {
  console.log(`Instance ${info.id}: ${info.state}`);
});
```

## Migration Guide

### Migrating from Original ExecuteCommandTool

No changes to existing code needed — the interface remains fully compatible.

### Migrating from Original VscodeStdioTransport

1. Change the import to `VscodeStdioTransportV2`
2. Interface remains unchanged, but with better performance and resource management

## Performance Optimization

### Instance Pool Management

- **Maximum Instances**: Default 50
- **Idle Timeout**: Auto-cleanup after 5 minutes
- **Cleanup Interval**: Checked every 1 minute

### Memory Optimization

- Automatically truncates overly long output (default 8000 characters)
- Promptly cleans up completed command instances
- Intelligently reuses persistent instances

## Troubleshooting

### Common Issues

1. **Command Not Found**: Check PATH environment variable and command spelling
2. **Permission Error**: Ensure execution permission and directory access permission
3. **Timeout Error**: Increase `timeoutMs` setting or check if the command is hanging
4. **Out of Memory**: Check for instance leaks, call `dispose()` to clean up

### Debugging Methods

```typescript
// Enable verbose logging
const instance = await manager.createInstance(config);
instance.on('stateChange', (state) => {
  console.log(`State change: ${state}`);
});
instance.on('error', (error) => {
  console.error(`Instance error:`, error);
});
```

## Future Plans

- [ ] Linux platform support
- [ ] Add process monitoring and metrics collection
- [ ] Support cluster mode and load balancing
- [ ] Integrate more shell types
- [ ] Provide web-based monitoring tools