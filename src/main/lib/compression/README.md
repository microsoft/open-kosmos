# Full Mode Compressor

A ported version of the Full Mode compression algorithm from VSCode Copilot Chat, specifically designed for intelligent compression of Kosmos Messages.

## Features

- ✅ **Preserves First User Message**: Automatically identifies and protects the first user message
- ✅ **Preserves First SKILL.md**: Automatically identifies and protects the first successful SKILL.md read_file tool call + tool result
- ✅ **Preserves Recent Messages**: Configurable to retain the most recent N messages (default: 5)
- ✅ **Intelligent Summary Compression**: Uses VSCode's 8-part structured summary template
- ✅ **Fallback Strategy**: Automatically falls back to simple retention strategy on API failure
- ✅ **No Token Calculation Dependency**: Focuses on compression logic without handling token calculation
- ✅ **Configurable**: Supports custom compression parameters and model selection

## Core Algorithm

### Compression Strategy

```
Original: [M1, M2, M3(skill_call), M4(skill_result), M5, M6, M7, M8, M9, M10, M11, M12]
               ↓
Analysis: First user message(M2) + SKILL(M3+M4) + Middle messages(M5-M7) + Recent 5 messages(M8-M12)
               ↓
Result:   [M2, SUMMARY(M5-M7), M3(skill_call), M4(skill_result), M8, M9, M10, M11, M12]
```

### Summary Template

Based on VSCode Copilot Chat's 8-part structured summary:

1. **Conversation Overview** - Main goals and context
2. **Technical Foundation** - Technology stack and frameworks involved  
3. **Codebase State** - Current code state and structure
4. **Problem Resolution** - Problems encountered and solutions
5. **Progress Tracking** - Completed and in-progress work
6. **Active Work Status** - Current work focus
7. **Recent Operations** - Recent code changes and decisions
8. **Continuation Plan** - Next tasks and pending issues

## Quick Start

### Basic Usage

```typescript
import { createFullModeCompressor } from './compression/fullModeCompressor';
import { Message } from './types/chatTypes';

// 1. Create compressor
const compressor = createFullModeCompressor();

// 2. Prepare message list
const messages: Message[] = [
  // ... your message list
];

// 3. Execute compression
const result = await compressor.compressMessages(messages);

// 4. Use compression result
if (result.success) {
  console.log(`Compression successful: ${result.originalMessages.length} -> ${result.compressedMessages.length}`);
  // Use result.compressedMessages
} else {
  console.error('Compression failed:', result.error);
  // Use fallback result result.compressedMessages
}
```

### Custom Configuration

```typescript
import { createFullModeCompressor, FullModeCompressionConfig } from './compression/fullModeCompressor';

const config: Partial<FullModeCompressionConfig> = {
  preserveRecentMessages: 3,        // Preserve the most recent 3 messages
  preserveFirstUserMessage: true,   // Preserve the first user message
  summaryModel: 'gpt-5-mini',      // Use specified model
  maxSummaryTokens: 1024,          // Limit summary length
  summaryLanguage: 'en',           // English summary
  maxRetries: 3,                   // Maximum retries
  enableDebugLog: true             // Enable debug logging
};

const compressor = createFullModeCompressor(config);
const result = await compressor.compressMessages(messages);
```

## API Reference

### FullModeCompressor

The main compressor class.

#### Methods

##### `compressMessages(messages: Message[]): Promise<FullModeCompressionResult>`

Compresses a list of messages.

**Parameters:**
- `messages`: Array of messages to compress

**Returns:**
- `Promise<FullModeCompressionResult>`: Compression result

##### `updateConfig(newConfig: Partial<FullModeCompressionConfig>): void`

Updates the compressor configuration.

##### `getConfig(): FullModeCompressionConfig`

Gets the current configuration.

### Configuration Options

```typescript
interface FullModeCompressionConfig {
  /** Number of recent messages to preserve */
  preserveRecentMessages: number;
  /** Whether to preserve the first user message */
  preserveFirstUserMessage: boolean;
  /** Whether to preserve the first successful SKILL.md read_file tool call + tool result */
  preserveFirstSkillToolCall: boolean;
  /** Model used for summarization */
  summaryModel: string;
  /** Maximum token count for summary */
  maxSummaryTokens: number;
  /** Summary language */
  summaryLanguage: 'zh' | 'en';
  /** Maximum retry count */
  maxRetries: number;
  /** Whether to enable debug logging */
  enableDebugLog: boolean;
}
```

### Compression Result

```typescript
interface FullModeCompressionResult {
  /** Whether compression was successful */
  success: boolean;
  /** Original message list */
  originalMessages: Message[];
  /** Compressed message list */
  compressedMessages: Message[];
  /** Compression strategy description */
  strategy: string;
  /** Compressed message range */
  compressedRange?: {
    startIndex: number;
    endIndex: number;
    messageCount: number;
  };
  /** Summary content (if applicable) */
  summary?: string;
  /** Processing time */
  processingTime: number;
  /** Error message */
  error?: string;
  /** Metadata */
  metadata: {
    preservedFirst: boolean;
    preservedRecent: number;
    compressionMethod: 'summary' | 'none' | 'fallback';
    timestamp: number;
  };
}
```

## Use Cases

### 1. Long Conversation Compression

```typescript
// Handle long conversations exceeding the limit
if (messages.length > 20) {
  const result = await compressor.compressMessages(messages);
  // Continue conversation with compressed messages
  const response = await chatAPI.sendMessages(result.compressedMessages);
}
```

### 2. Context Window Management

```typescript
// Perform intelligent compression before sending API requests
const compressor = createFullModeCompressor({
  preserveRecentMessages: 5,
  preserveFirstUserMessage: true
});

const result = await compressor.compressMessages(conversationHistory);
const apiRequest = {
  messages: result.compressedMessages,
  // ... other parameters
};
```

### 3. Batch Conversation Processing

```typescript
// Batch process multiple conversation sessions
const sessions = await loadConversationSessions();

for (const session of sessions) {
  if (session.messages.length > 10) {
    const result = await compressor.compressMessages(session.messages);
    await saveCompressedSession(session.id, result.compressedMessages);
  }
}
```

## Best Practices

### 1. Configuration Optimization

```typescript
// Optimize configuration for different scenarios
const configs = {
  // Fast compression - suitable for real-time conversations
  fast: {
    preserveRecentMessages: 3,
    maxSummaryTokens: 512,
    maxRetries: 1
  },
  
  // Balanced compression - default recommendation
  balanced: {
    preserveRecentMessages: 5,
    maxSummaryTokens: 1024,
    maxRetries: 3
  },
  
  // High quality compression - suitable for important conversations
  quality: {
    preserveRecentMessages: 7,
    maxSummaryTokens: 2048,
    maxRetries: 5
  }
};
```

### 2. Error Handling

```typescript
const result = await compressor.compressMessages(messages);

if (!result.success) {
  // Compression failed, but fallback result is still available
  logger.warn('Compression failed, using fallback:', result.error);
  
  // Fallback result is still usable
  const fallbackMessages = result.compressedMessages;
}
```

### 3. Performance Monitoring

```typescript
const startTime = Date.now();
const result = await compressor.compressMessages(messages);

// Monitor compression performance
const compressionRatio = result.compressedMessages.length / result.originalMessages.length;
const processingTime = result.processingTime;

logger.info('Compression metrics', {
  originalCount: result.originalMessages.length,
  compressedCount: result.compressedMessages.length,
  compressionRatio: compressionRatio.toFixed(2),
  processingTime: `${processingTime}ms`,
  strategy: result.strategy
});
```

## Examples and Tests

See the `fullModeCompressor.example.ts` file for complete usage examples, including:

- Basic usage examples
- Custom configuration examples  
- Edge case tests
- Performance tests

```bash
# Run examples
npm run example:compression
```

## Technical Details

### Compression Algorithm Flow

1. **Message Structure Analysis**
   - Identify the first user message position
   - Calculate the recent message range
   - Determine the middle message range to be compressed

2. **Compression Strategy Decision**
   - If no compression needed: return original messages directly
   - If compression needed: extract middle messages for summarization

3. **Intelligent Summary Generation**
   - Build structured conversation text
   - Use VSCode's 8-part summary template
   - Call LLM API to generate summary

4. **Message Reassembly**
   - Preserve the first user message
   - Insert summary message to replace the middle portion
   - Preserve recent messages

5. **Fallback Handling**
   - Automatic fallback on API failure
   - Use simple retention strategy
   - Ensure a usable result is always available

### Differences from VSCode Copilot Chat

1. **Simplified Dependencies**: Removed dependencies on VSCode-specific APIs
2. **Adapted for Kosmos**: Uses Kosmos's Message types and LLM API
3. **Focused on Compression**: Does not handle token calculation, focuses on compression logic
4. **Optimized Configuration**: Simplified configuration options, highlighting core functionality

## Changelog

### v1.0.0 (2024-11-07)

- ✅ Initial version release
- ✅ Implemented Full Mode compression algorithm based on VSCode Copilot Chat
- ✅ Support for preserving first user message and recent messages
- ✅ Integrated 8-part structured summary template
- ✅ Implemented fallback strategy and error handling
- ✅ Provided complete configuration options and usage examples