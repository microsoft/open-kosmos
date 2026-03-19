# Kosmos Memory System Integration Update

## Overview

This update fully integrates the LLM and Embedder configuration in the Kosmos Memory system into the Kosmos main process architecture, using unified authentication management and model configuration.

## Changes

### 1. KosmosLLM Update

**File**: `kosmosLLM.ts`

**Major Changes**:
- Removed dependency on the renderer process LLM module
- Directly uses the main process's `GhcModelApi` and `MainAuthManager`
- Uses model configuration validation from `ghcModels.ts`
- Implemented full authentication state checking

**New Features**:
```typescript
// Auto-retrieve auth session
private async getCurrentSession(): Promise<any>

// Get configuration info
getConfig(): { provider: string; model: string; ... }

// Availability check
async isAvailable(): Promise<boolean>
```

### 2. KosmosEmbedder Update

**File**: `kosmosEmbedder.ts`

**Major Changes**:
- Removed dependency on the renderer process embedding module
- Directly uses the main process's `TextLlmEmbedder` and `MainAuthManager`
- Uses embedding model configuration validation from `ghcModels.ts`
- Implemented full authentication state checking

**New Features**:
```typescript
// Auto-retrieve auth session
private async getCurrentSession(): Promise<any>

// Get configuration info
getConfig(): { provider: string; model: string; dimensions: number; ... }

// Availability check
async isAvailable(): Promise<boolean>

// Cosine similarity calculation (static method)
static cosineSimilarity(embedding1: number[], embedding2: number[]): number
```

### 3. Factory Class Update

**File**: `mem0-core/utils/factory.ts`

**Major Changes**:
- Updated `EmbedderFactory` and `LLMFactory` to correctly instantiate Kosmos adapters
- Kosmos adapters no longer require configuration parameters, as they directly use the main process's modules and authentication

```typescript
// Before update
return new KosmosLLM(config);
return new KosmosEmbedder(config);

// After update
return new KosmosLLM();
return new KosmosEmbedder();
```

## Technical Advantages

### 1. Unified Authentication Management
- All LLM and embedding operations obtain GitHub Copilot tokens through `MainAuthManager`
- Automatically handles token refresh and expiration checks
- Centralized authentication state management

### 2. Unified Model Configuration
- Uses the unified model configuration from `ghcModels.ts`
- Automatically validates model capabilities and limitations
- Supports dynamic model configuration updates

### 3. Improved Error Handling
- Detailed logging and error tracking
- Clear error messages on authentication failures
- Graceful degradation handling

### 4. Performance Optimization
- Reduced cross-process communication overhead
- Directly uses main process modules, avoiding the performance cost of dynamic imports
- Better memory management

## Usage Examples

### Basic Usage

```typescript
import { createKosmosMemory } from 'src/main/lib/mem0/kosmos-adapters';

// Create memory instance (requires user authentication)
const memory = createKosmosMemory('production', 'user-alias');

// Add memory
await memory.add("User prefers dark theme", {
  userId: "user123",
  agentId: "kosmos"
});

// Search memories
const results = await memory.search("User interface preferences", {
  userId: "user123",
  limit: 5
});
```

### Direct Adapter Usage

```typescript
import { KosmosLLM, KosmosEmbedder } from 'src/main/lib/mem0/kosmos-adapters';

// LLM usage
const llm = new KosmosLLM();
const isAvailable = await llm.isAvailable();
if (isAvailable) {
  const response = await llm.generateResponse([
    { role: 'user', content: 'Hello world' }
  ]);
}

// Embedding usage
const embedder = new KosmosEmbedder();
const embedding = await embedder.embed("Test text");
```

## Testing

Use the provided test files to verify integration:

```bash
# Run integration tests (in main process environment)
cd src/main/lib/mem0/kosmos-adapters
node -r ts-node/register test-integration.ts
```

## Compatibility

- ✅ Fully backward compatible with existing mem0 API
- ✅ Supports all existing Kosmos Memory configuration options
- ✅ Maintains original error handling behavior
- ✅ Supports all run modes (production, development, memory, graph)

## Notes

1. **Authentication Required**: LLM and embedding features require valid GitHub Copilot authentication
2. **Main Process Only**: These adapters can only run in the Electron main process
3. **Simplified Configuration**: No longer requires manual API key or endpoint configuration — everything is managed through the main process

## Update History

- Update Date: 2025-01-28
- Version: v1.1.0
- Compatibility: Kosmos v1.7.1+