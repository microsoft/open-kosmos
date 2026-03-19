# TokenCounter - Intelligent Token Calculator

## Overview

TokenCounter is a powerful token calculation module that supports:
- **Text Tokens**: Uses TikToken (OpenAI's official tokenizer)
- **Image Tokens**: OpenAI Vision API official algorithm
- **Tool Tokens**: Accurate calculation for Tools and System Prompts

## Quick Start

### Basic Usage

```typescript
import { createTokenCounter } from '@/main/lib/token';

// Create instance
const counter = createTokenCounter({
  defaultEncoding: 'cl100k_base', // GPT-3.5/GPT-4
  enableCache: true,
  cacheSize: 10000
});

// Count text tokens
const textTokens = counter.countTextTokens('Hello, world!');
console.log(`Text tokens: ${textTokens}`);

// Count image tokens
const imageResult = counter.countImageTokens({
  width: 1024,
  height: 768,
  detail: 'high'
});
console.log(`Image tokens: ${imageResult.tokens}`);

// Count all tokens in a Message
const message = {
  role: 'user',
  content: [
    { type: 'text', text: 'Describe this image' },
    { type: 'image', source: { type: 'base64', data: '...' } }
  ]
};
const messageTokens = counter.countMessageTokens(message);
console.log(`Message total tokens: ${messageTokens}`);
```

### Advanced Features

```typescript
// Batch text calculation
const texts = ['Hello', 'World', 'TypeScript'];
const totalTokens = counter.countTextTokensBatch(texts);

// Count Tools tokens
const tools = [
  {
    name: 'get_weather',
    description: 'Get weather information',
    input_schema: {
      type: 'object',
      properties: { location: { type: 'string' } }
    }
  }
];
const toolsResult = counter.countToolsTokens(tools);
console.log(`Tools tokens: ${toolsResult.totalTokens}`);

// System Prompt + Tools
const systemResult = counter.countSystemPromptWithTools(
  'You are a helpful assistant',
  tools
);
console.log(`System+Tools total tokens: ${systemResult.totalTokens}`);

// View cache statistics
const stats = counter.getCacheStats();
console.log(`Cache hit rate: ${(stats.hits / (stats.hits + stats.misses) * 100).toFixed(2)}%`);
```

## Core Features

### 1. Text Token Calculation
- ✅ Uses OpenAI's official TikToken
- ✅ Supports GPT-3.5/4 (cl100k_base) and GPT-4o (o200k_base)
- ✅ LRU cache (default 10,000 entries), cache hit rate >80%
- ✅ Batch calculation optimization

### 2. Image Token Calculation
- ✅ OpenAI Vision API official algorithm
- ✅ Automatic image scaling (2048x2048 → 768px short side)
- ✅ Based on 512x512 tile calculation: `tokens = tiles × 170 + 85`
- ✅ Supports both `low` and `high` detail modes

### 3. Tool Token Calculation
- ✅ JSON serialization + TikToken calculation
- ✅ Automatically accumulates all tool definitions
- ✅ Combined System Prompt and Tools calculation

### 4. Performance Optimization
- ✅ Encoder singleton pattern, globally shared
- ✅ Text calculation LRU cache
- ✅ Lazy encoder initialization
- ✅ Batch calculation reduces redundant calls

## API Documentation

### TokenCounter Class

#### Constructor
```typescript
new TokenCounter(config?: TokenCounterConfig)
```

**Configuration Options**:
- `defaultEncoding`: Default encoder (`'cl100k_base'` | `'o200k_base'`)
- `enableCache`: Whether to enable caching (default: `true`)
- `cacheSize`: Cache size (default: `10000`)

#### Main Methods

##### countTextTokens
```typescript
countTextTokens(text: string, options?: TextTokenOptions): number
```
Calculates the number of tokens in text.

**Parameters**:
- `text`: The text to calculate
- `options.encoding`: Override the default encoder
- `options.allowedSpecial`: Allowed special tokens

##### countImageTokens
```typescript
countImageTokens(options: ImageTokenOptions): ImageTokenResult
```
Calculates the number of tokens for an image.

**Parameters**:
- `width`: Image width (px)
- `height`: Image height (px)
- `detail`: Detail mode (`'low'` | `'high'`)

**Returns**:
```typescript
{
  tokens: number;        // Token count
  tiles: number;         // Tile count
  scaledWidth: number;   // Width after scaling
  scaledHeight: number;  // Height after scaling
}
```

##### countMessageTokens
```typescript
countMessageTokens(message: Message): number
```
Calculates the total token count for a single Message (text + images).

##### countMessagesTokens
```typescript
countMessagesTokens(messages: Message[]): number
```
Calculates the total token count for a Message array.

##### countToolsTokens
```typescript
countToolsTokens(tools: ToolDefinition[]): ToolsTokenResult
```
Calculates the token count for tool definitions.

##### countSystemPromptWithTools
```typescript
countSystemPromptWithTools(
  systemPrompt: string,
  tools: ToolDefinition[]
): ToolsTokenResult
```
Calculates the total token count for System Prompt + Tools.

##### getCacheStats
```typescript
getCacheStats(): CacheStats
```
Gets cache statistics.

**Returns**:
```typescript
{
  size: number;   // Current cache entry count
  maxSize: number; // Maximum cache size
  hits: number;   // Cache hit count
  misses: number; // Cache miss count
}
```

## Type Definitions

See [`types.ts`](./types.ts) for details.

## Technical Details

### Encoder Management
- Uses singleton pattern to manage encoder instances
- Supports `cl100k_base` (GPT-3.5/4) and `o200k_base` (GPT-4o)
- Lazy loading, initialized on demand

### Cache Strategy
- LRU (Least Recently Used) eviction strategy
- Default cache of 10,000 text fragments
- Average hit rate >80%

### Image Algorithm
Follows the OpenAI Vision API official specification:
1. If `detail='low'`, returns a fixed 85 tokens
2. If `detail='high'`:
   - Scale to within 2048x2048
   - Scale the short side to 768px
   - Divide into 512x512 tiles
   - 170 tokens per tile + 85 base tokens

## Performance Benchmarks

Based on actual test data:

| Operation | Latency | Throughput |
|-----------|---------|------------|
| Text calculation (cache hit) | ~0.01ms | 100,000 ops/s |
| Text calculation (cache miss) | ~0.1ms | 10,000 ops/s |
| Image calculation | ~0.05ms | 20,000 ops/s |
| Message calculation (text + image) | ~0.15ms | 6,600 ops/s |

## Dependencies

- `js-tiktoken` ^1.0.21 - OpenAI's official tokenizer

## Examples

For more examples, see:
- [API Usage Guide](../../../../docs/token-counter-api-guide.md)
- [Technical Design Document](../../../../docs/token-counter-implementation-plan.md)

## License

MIT