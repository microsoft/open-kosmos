# Unified Terminal Instance Manager

## Overview

The unified terminal instance manager is a cross-platform terminal process management system designed specifically for the OpenKosmos project to uniformly manage and coordinate all terminal operations. It supports Windows and macOS, and provides efficient process pool management, lifecycle control, and resource cleanup.

## Key Features

### 🚀 Core Functionality

- **Cross-platform support**: Native support for Windows and macOS, automatically adapts to different platform shell environments
- **Unified interface**: Consistent API for command execution and MCP communication
- **Smart process pool**: Automatically manages terminal instances with reuse and cleanup mechanisms
- **Lifecycle management**: Graceful process start, stop, and resource cleanup
- **Error recovery**: Automatically handles process exceptions and timeouts

### 🛠️ Technical Highlights

- **Type safety**: Full TypeScript type support
- **Event-driven**: Async event handling based on EventEmitter
- **Resource optimization**: Smart memory and process resource management
- **Flexible configuration**: Supports environment variables, working directories, timeouts, and more

## Architecture

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

1. **Singleton pattern**: `TerminalManager` uses a singleton to ensure global uniqueness
2. **Factory pattern**: Creates specific terminal instance types based on different needs
3. **Adapter pattern**: Provides a seamless integration interface for existing components
4. **Strategy pattern**: Supports different shell execution strategies

## Usage

### Basic Usage

```typescript
import { getTerminalManager, TerminalConfig } from '../terminalManager';

// Get the manager instance
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
// Create a persistent MCP transport
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

// Send a message
instance.send('{"jsonrpc": "2.0", "method": "initialize"}');
```

### Using Adapters

```typescript
import { createExecuteCommandAdapter } from '../terminalManager';

// Create an adapter for existing components
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
// The existing interface is unchanged; the new manager is used internally
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
// Interface is fully compatible; the new manager is used internally
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

  // Timeouts and limits
  timeoutMs?: number;          // Timeout in milliseconds
  maxOutputLength?: number;    // Maximum output length

  // Advanced configuration
  envFile?: string;           // Path to environment variable file
  persistent?: boolean;       // Whether the process is persistent
  instanceId?: string;        // Instance identifier
}
```

### Platform Configuration

The system automatically detects the current platform and applies the appropriate configuration:

- **Windows**: Defaults to PowerShell; supports cmd, bash, zsh
- **macOS**: Defaults to zsh; supports bash, sh, and pwsh
- **Linux**: Defaults to bash; supports zsh, sh, and pwsh

## Best Practices

### 1. Choose the Right Instance Type

- Use `'command'` type for one-off commands
- Use `'mcp_transport'` type for persistent communication channels

### 2. Resource Management

```typescript
// Periodically clean up idle instances
const stats = manager.getStats();
console.log(`Current instance count: ${stats.totalInstances}`);

// Clean up all resources on app exit
process.on('exit', async () => {
  await manager.dispose();
});
```

### 3. Error Handling

```typescript
try {
  const result = await manager.executeCommand(config);
  // Handle successful result
} catch (error) {
  console.error('Command execution failed:', error.message);
  // Handle error
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

### Migrating from the Original ExecuteCommandTool

No code changes required; the interface is fully compatible.

### Migrating from the Original VscodeStdioTransport

1. Change the import to `VscodeStdioTransportV2`
2. The interface is unchanged, but you gain improved performance and resource management

## Performance Optimization

### Instance Pool Management

- **Max instances**: 50 by default
- **Idle timeout**: Auto-cleanup after 5 minutes
- **Cleanup interval**: Checked every 1 minute

### Memory Optimization

- Automatically truncates overly long output (default: 8000 characters)
- Promptly cleans up completed command instances
- Smart reuse of persistent instances

## Troubleshooting

### Common Issues

1. **Command not found**: Check PATH environment variable and command spelling
2. **Permission error**: Ensure execute permission and directory access rights
3. **Timeout error**: Increase `timeoutMs` setting or check if the command is hanging
4. **Out of memory**: Check for instance leaks; call `dispose()` to clean up

### Debugging

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
- [ ] Process monitoring and metrics collection
- [ ] Cluster mode and load balancing support
- [ ] Integration of more shell types
- [ ] Web UI monitoring tool
