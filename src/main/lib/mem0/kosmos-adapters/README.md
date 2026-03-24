# OpenKosmos Memory Adapters

These are custom mem0 memory system adapters designed for the Kosmos application. They integrate Kosmos's existing GitHub Copilot API and vector storage system.

## Features

- ✅ Uses ChromaDB as the local vector database
- ✅ Integrates Kosmos's GhcModelApi (GPT-4.1)
- ✅ Uses Kosmos's textLlmEmbedder (text-embedding-3-small)
- ✅ Retains all core mem0-ts features
- ✅ Provides multiple configuration modes (production, development, memory-only)

## Quick Start

### Basic Usage

```typescript
import { createKosmosMemory } from './src/main/lib/mem0/kosmos-adapters';

// Create memory instance
const memory = createKosmosMemory();

// Add memory
await memory.add("User prefers using a dark theme for coding", {
  userId: "user123",
  agentId: "kosmos"
});

// Search memories
const results = await memory.search("User interface preferences", {
  userId: "user123",
  limit: 5
});

console.log('Search results:', results);
```

### Different Mode Usage

```typescript
import { 
  createKosmosMemory, 
  createKosmosDevMemory, 
  createKosmosMemoryOnly 
} from './src/main/lib/mem0/kosmos-adapters';

// Production mode (default)
const prodMemory = createKosmosMemory('production');

// Development mode
const devMemory = createKosmosDevMemory();

// Memory-only mode (no persistence)
const tempMemory = createKosmosMemoryOnly();
```

### Custom Configuration

```typescript
import { createCustomKosmosMemory } from './src/main/lib/mem0/kosmos-adapters';

const customMemory = createCustomKosmosMemory({
  vectorStore: {
    config: {
      collectionName: "my_custom_memories",
      persistPath: "./custom_chroma_db"
    }
  },
  customPrompt: "You are a helpful assistant with access to user memory."
});
```

## API Reference

### Memory Class Main Methods

```typescript
// Add memory
await memory.add(text: string, metadata?: object): Promise<string>

// Search memories
await memory.search(query: string, filters?: object): Promise<SearchResult>

// Get all memories
await memory.getAll(filters?: object): Promise<MemoryItem[]>

// Delete memory
await memory.delete(memoryId: string): Promise<void>

// Update memory
await memory.update(memoryId: string, text: string): Promise<void>
```

### Configuration Options

```typescript
interface KosmosMemoryConfig {
  vectorStore: {
    provider: "chroma";
    config: {
      collectionName?: string;  // Default: "kosmos_memories"
      dimension?: number;       // Default: 1536
      persistPath?: string;     // Default: "./chroma_db"
    }
  };
  llm: {
    provider: "kosmos";
    config: {
      model: "gpt-4.1";
    }
  };
  embedder: {
    provider: "kosmos";
    config: {
      model: "text-embedding-3-small";
    }
  };
}
```

## Architecture Overview

### Component Architecture

```
┌─────────────────────────────────────────┐
│             Kosmos Memory               │
├─────────────────────────────────────────┤
│  Memory (mem0-ts core)                  │
├─────────────────┬───────────────────────┤
│ KosmosEmbedder  │     KosmosLLM        │
│ (text-embed-    │   (GPT-4.1 via       │
│  3-small)       │    GhcModelApi)      │
├─────────────────┴───────────────────────┤
│         ChromaVectorStore               │
│         (Local vector database)         │
├─────────────────────────────────────────┤
│     Kosmos Auth System (GitHub Copilot) │
└─────────────────────────────────────────┘
```

### Data Flow

1. **Adding Memory**: Text → KosmosEmbedder → Vector → ChromaDB
2. **Searching Memory**: Query → KosmosEmbedder → Similarity Search → ChromaDB → Results
3. **LLM Processing**: Prompt → KosmosLLM → GhcModelApi → GPT-4.1 → Response

## Troubleshooting

### Common Issues

1. **ChromaDB Initialization Failed**
   ```
   Solution: Ensure the chromadb package is correctly installed
   cd src/main/lib/mem0/mem0-ts/src/oss && npm install chromadb
   ```

2. **GitHub Copilot Authentication Failed**
   ```
   Solution: Ensure the user is logged into GitHub Copilot with a valid session
   Check that authManager.getCurrentSession() returns a valid ghc session
   ```

3. **Vector Dimension Mismatch**
   ```
   Solution: Ensure the dimension in the configuration matches the text-embedding-3-small dimension (1536)
   ```

### Debugging Tips

```typescript
// Enable verbose logging
const memory = createKosmosMemory('development');

// Check configuration
console.log('Memory config:', memory.getConfig());

// Check vector store status
const vectorStore = memory.getVectorStore();
console.log('Vector store info:', await vectorStore.getInfo());

// Check embedder status
const embedder = memory.getEmbedder();
console.log('Embedder info:', embedder.getInfo());
```

## Performance Optimization Tips

1. **Batch Operations**: Use `embedBatch` for batch embeddings
2. **Use Appropriate Collection Names**: Use different collections for different purposes
3. **Regular Cleanup**: Periodically delete old memories that are no longer needed
4. **Index Optimization**: ChromaDB automatically optimizes indexes, but you can consider periodic rebuilds

## Changelog

### v1.0.0
- ✅ Initial release
- ✅ Integrated ChromaDB vector store
- ✅ Integrated Kosmos GhcModelApi
- ✅ Integrated Kosmos textLlmEmbedder
- ✅ Support for multiple configuration modes