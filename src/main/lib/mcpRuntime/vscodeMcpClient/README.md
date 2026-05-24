# VSCode-Compatible MCP Client Implementation

This module provides an MCP client compatible with the VSCode MCP implementation standard.

## Core Features

### 1. Standard Compatibility
- Based on VSCode's MCP implementation patterns
- Follows the MCP protocol specification (2024-11-05)
- Supports all standard transport layer types

### 2. Transport Layer Support
- **Stdio Transport**: Sub-process communication with graceful shutdown support
- **HTTP Transport**: RESTful HTTP communication
- **SSE Transport**: Server-Sent Events real-time communication
- **StreamableHTTP**: Automatic HTTP/SSE fallback mechanism

### 3. Process Lifecycle Management
- State machine management (Running → StdinEnded → KilledPolite → KilledForceful)
- Windows security fix (CVE-2024-27980)
- Timeout and error handling

## File Structure

```
src/main/lib/mcp/vscodeMcpClient/
├── VscodeMcpClient.ts              # Main client implementation
├── transport/
│   ├── VscodeTransportFactory.ts   # Transport layer factory
│   ├── VscodeStdioTransport.ts     # Stdio transport implementation
│   ├── VscodeHttpTransport.ts      # HTTP/SSE transport implementation
│   └── types.ts                    # Type definitions
└── README.md                       # This document
```

## Usage Examples

### Stdio Transport

```typescript
import { VscodeMcpClient } from './VscodeMcpClient';

const client = new VscodeMcpClient({
  name: 'git-server',
  type: 'stdio',
  command: 'uvx',
  args: ['mcp-server-git', '--repository', '/path/to/repo'],
  timeout: 30000
});

// Listen for state changes
client.on('stateChange', (state) => {
  console.log(`State: ${state.state}`);
});

// Connect and use
await client.connect();
const tools = client.getTools();
const result = await client.callTool('git_log', { max_count: 10 });
await client.disconnect();
```

### HTTP Transport

```typescript
const client = new VscodeMcpClient({
  name: 'http-server',
  type: 'http',
  url: 'http://localhost:3001/mcp',
  headers: {
    'Authorization': 'Bearer token'
  },
  timeout: 30000
});

await client.connect();
const resources = client.getResources();
await client.disconnect();
```

### StreamableHTTP (Automatic Fallback)

```typescript
const client = new VscodeMcpClient({
  name: 'streamable-server',
  type: 'streamablehttp',
  url: 'http://localhost:3001/mcp',
  timeout: 30000
});
```

## Key Differences from the Original Implementation

### 1. Process Management
- **VSCode approach**: Graceful shutdown flow driven by a state machine
- **Original approach**: Simple kill mechanism

### 2. Message Handling
- **VSCode approach**: Streamlined message validation and processing
- **Original approach**: Complex validation and statistics tracking

### 3. Error Handling
- **VSCode approach**: State-based error management
- **Original approach**: Event-based error propagation

### 4. Transport Layer Design
- **VSCode approach**: Factory pattern with automatic type detection
- **Original approach**: Manual transport layer instantiation

## Configuration Options

### Common Configuration
```typescript
interface VscodeMcpServerConfig {
  name: string;                          // Server name
  type?: 'stdio' | 'http' | 'sse' | 'streamablehttp';
  timeout?: number;                      // Timeout in ms (default: 30000ms)
}
```

### Stdio-Specific Configuration
```typescript
{
  command: string;                       // Command to execute
  args?: string[];                       // Command arguments
  cwd?: string;                         // Working directory
  env?: Record<string, string | null>;   // Environment variables
  envFile?: string;                     // Environment variable file
}
```

### HTTP-Specific Configuration
```typescript
{
  url: string;                          // Server URL
  headers?: Record<string, string>;     // HTTP headers
  method?: string;                      // HTTP method (default: POST)
}
```

## Event System

The client extends EventEmitter and supports the following events:

- `stateChange`: Connection state changes
- `log`: Log messages
- `notification`: Server notifications

```typescript
client.on('stateChange', (state: ConnectionState) => {
  // Handle state change
});

client.on('log', (level: string, message: string) => {
  // Handle log
});

client.on('notification', (notification: any) => {
  // Handle server notification
});
```

## Tests

Test files have been moved to a dedicated test directory. See the `tests/` folder.

## Dependencies

- Node.js Events API
- Standard fetch API (HTTP transport)
- child_process (Stdio transport)

## Security

### Windows CVE-2024-27980 Fix
The Stdio transport layer includes a fix for the Windows sub-process argument injection vulnerability:

```typescript
// Safe argument formatting
const safeArgs = formatWindowsArgs(args);
```

### Environment Variable Handling
Supports safe environment variable configuration, including null-value clearing:

```typescript
env: {
  'SAFE_VAR': 'value',
  'REMOVE_VAR': null  // Clear the variable
}
```

## Performance Features

- Connection pool reuse (HTTP transport)
- Automatic reconnection (configurable)
- Message queue management
- Memory leak protection

## Troubleshooting

### Common Issues

1. **Stdio process fails to start**
   - Check command path and permissions
   - Verify argument formatting
   - Confirm `uvx` availability

2. **HTTP connection failure**
   - Check URL reachability
   - Verify authentication headers
   - Confirm firewall settings

3. **Message timeout**
   - Adjust the `timeout` configuration
   - Check network latency
   - Verify server response

### Debug Mode

Enable verbose logging:

```typescript
client.on('log', (level, message) => {
  if (level === 'trace') {
    console.log('TRACE:', message);
  }
});
```
