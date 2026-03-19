// src/renderer/lib/memory/index.ts
// Memory module export file

// Export core types and interfaces
export type {
  MemoryOperation,
  MemoryItem,
  MemoryStats,
  MemoryMetadata,
  IMemoryProxy
} from './MemoryProxy';

// Export core classes
export {
  MemoryProxy,
  StubMemoryProxy
} from './MemoryProxy';

export {
  MemoryProxyIPC,
  type MemoryAgentIPC
} from './MemoryProxyIPC';

// Import concrete classes for use in factory function
import { MemoryProxy, StubMemoryProxy } from './MemoryProxy';
import { MemoryProxyIPC } from './MemoryProxyIPC';

// Export aliases for backward compatibility
export { MemoryProxyIPC as MemoryAgent } from './MemoryProxyIPC';
export { MemoryProxy as MemoryAgentCore } from './MemoryProxy';

// Factory function: create memory proxy instance
export function createMemoryProxy(userAlias: string, agentId: string): MemoryProxy {
  // Check if IPC support is available
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    return new MemoryProxyIPC(userAlias, agentId);
  } else {
    return new StubMemoryProxy(userAlias, agentId);
  }
}