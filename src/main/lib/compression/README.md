# Full Mode Compressor

A port of the VSCode Copilot Chat Full Mode compression algorithm, dedicated to intelligent compression of OpenKosmos Messages.

## Features

- ✅ **No positional hard-anchors by default**: Only preserves the most recent messages and tool-pair integrity by default; avoids treating "first user message / first skill" as permanently non-compressible anchors.
- ✅ **Optional anchor protection**: Explicit protection for the first user message or first SKILL.md block can still be enabled when needed for compatibility.
- ✅ **Preserve recent messages**: Configurable number of recent messages to retain (default: 5).
- ✅ **Intelligent summary compression**: Uses the helper's built-in 8-part structured summary template.
- ✅ **Structured pre-trimming**: Losslessly extracts key information from oversized tool results (`fetch_web_content`, `read_file`, search results, command output, etc.) before entering the summary phase.
- ✅ **Token-aware summary budgeting**: Each summary call deducts the true fixed request overhead (system prompt + user prompt template) and splits into chunks based on a conservative prompt token budget, rather than relying solely on character count.
- ✅ **Single-message overflow re-truncation**: If a single message would exceed the summary prompt budget on its own, it is further token-aware truncated before entering the summary — it cannot pass through the budget as-is.
- ✅ **Recursive hierarchical merge**: Chunk summary merges are also hierarchically batched by budget, preventing the second phase from regressing back to one-shot overflow.
- ✅ **Limited-concurrency chunk summary**: The first-layer conversation chunk summary supports limited concurrent execution to reduce total compression latency for large sessions, while keeping the merge phase serial.
- ✅ **Recursive depth guard**: Merge summary has a maximum recursion depth; under extreme configurations it will fast-fallback rather than making unbounded serial calls to the compression model.
- ✅ **Dedicated compression LLM interface**: Compression summaries are issued through a fixed-scenario LLM helper with a built-in system prompt, summary template, output language, model, and sampling parameters — no external configuration required.
- ✅ **Degradation strategy**: Automatically falls back to a simple retention strategy on API failure.
- ✅ **No token calculation dependency**: Focused purely on compression logic; does not own token counting.
- ✅ **Configurable**: Supports custom compression window and budget parameters; the LLM helper has its own fixed summarization strategy.

## Core Algorithm

### Compression Strategy

```
Original messages: [M1, M2, M3(fetch), M4(read_file), M5, M6, M7, M8, M9, M10, M11, M12]
                          ↓
Analyze structure: Recent 5 messages (M8–M12) + compressible middle segment (M1–M7)
                          ↓
Structured pre-trim: Reduce oversized tool results to metadata + preview
                          ↓
Chunk summary: Token-aware chunk summary + recursive merge over middle segment
                          ↓
Compressed result: [SUMMARY(M1-M7), M8, M9, M10, M11, M12]
```

### Summary Template

Based on the helper's built-in 8-part structured summary:

1. **Conversation Overview** — Main goals and context
2. **Technical Background** — Tech stack and frameworks involved
3. **Codebase State** — Current code state and structure
4. **Problem Solving** — Issues encountered and their solutions
5. **Progress Tracking** — Completed and in-progress work
6. **Active Work State** — Current focus area
7. **Recent Actions** — Recent code changes and decisions
8. **Continuation Plan** — Next steps and outstanding issues

## Quick Start

### Basic Usage

```typescript
import { createFullModeCompressor } from './compression/fullModeCompressor';
import { Message } from './types/chatTypes';

// 1. Create a compressor
const compressor = createFullModeCompressor();

// 2. Prepare the message list
const messages: Message[] = [
  // ... your messages
];

// 3. Run compression
const result = await compressor.compressMessages(messages);

// 4. Use the result
if (result.success) {
  console.log(`Compressed: ${result.originalMessages.length} -> ${result.compressedMessages.length}`);
  // Use result.compressedMessages
} else {
  console.error('Compression failed:', result.error);
  // Use the fallback result.compressedMessages
}
```

### Custom Configuration

```typescript
import { createFullModeCompressor, FullModeCompressionConfig } from './compression/fullModeCompressor';

const config: Partial<FullModeCompressionConfig> = {
  preserveRecentMessages: 3,        // Keep the 3 most recent messages
  preserveFirstUserMessage: false,  // Do not preserve the first user message by default
  preserveFirstSkillToolCall: false,// Do not preserve the first skill block by default
  summaryPromptTokenBudget: 100000, // True token budget for the Haiku API (max_prompt_tokens=128K, 28K safety margin)
  maxRetries: 3,                    // Maximum retry count
  maxConcurrentChunkSummaries: 2,   // Max concurrency for the first-layer chunk summary
  enableDebugLog: true              // Enable debug logging
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
- `Promise<FullModeCompressionResult>`: The compression result

##### `updateConfig(newConfig: Partial<FullModeCompressionConfig>): void`

Updates the compressor configuration.

##### `getConfig(): FullModeCompressionConfig`

Returns the current configuration.

### Configuration Options

```typescript
interface FullModeCompressionConfig {
  /** Number of recent messages to preserve */
  preserveRecentMessages: number;
  /** Whether to additionally preserve the first user message (default: off) */
  preserveFirstUserMessage: boolean;
  /** Whether to additionally preserve the first successful SKILL.md read_file tool call + result (default: off) */
  preserveFirstSkillToolCall: boolean;
  /** Hard token budget for a single summary prompt (includes template overhead); fails and falls back if below template overhead */
  summaryPromptTokenBudget: number;
  /** Maximum retry count */
  maxRetries: number;
  /** Max concurrency for the first-layer conversation chunk summary */
  maxConcurrentChunkSummaries: number;
  /** Maximum recursion depth for recursive merge summaries */
  maxSummaryRecursionDepth: number;
  /** Whether to enable debug logging */
  enableDebugLog: boolean;
}
```

`summaryLanguage` and the summary template are no longer exposed as configuration on `FullModeCompressor`. They are managed internally by `contextCompressionLlmSummarizer` to prevent the compressor from continuing to own LLM prompt details.

### Compression Result

```typescript
interface FullModeCompressionResult {
  /** Whether compression succeeded */
  success: boolean;
  /** Original message list */
  originalMessages: Message[];
  /** Compressed message list */
  compressedMessages: Message[];
  /** Description of the compression strategy used */
  strategy: string;
  /** Range of messages that were compressed */
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
// Handle conversations exceeding the limit
if (messages.length > 20) {
  const result = await compressor.compressMessages(messages);
  // Continue the conversation with compressed messages
  const response = await chatAPI.sendMessages(result.compressedMessages);
}
```

### 2. Context Window Management

```typescript
// Intelligently compress before sending an API request
const compressor = createFullModeCompressor({
  preserveRecentMessages: 5,
  preserveFirstUserMessage: false,
  preserveFirstSkillToolCall: false
});

const result = await compressor.compressMessages(conversationHistory);
const apiRequest = {
  messages: result.compressedMessages,
  // ... other parameters
};
```

### 3. Batch Conversation Processing

```typescript
// Process multiple conversation sessions in bulk
const sessions = await loadConversationSessions();

for (const session of sessions) {
  if (session.messages.length > 10) {
    const result = await compressor.compressMessages(session.messages);
    await saveCompressedSession(session.id, result.compressedMessages);
  }
}
```

## Best Practices

### 1. Configuration Tuning

```typescript
// Tune configuration for different scenarios
const configs = {
  // Fast compression — for real-time conversations
  fast: {
    preserveRecentMessages: 3,
    summaryPromptTokenBudget: 50000,
    maxRetries: 1
  },

  // Balanced compression — recommended default
  balanced: {
    preserveRecentMessages: 5,
    summaryPromptTokenBudget: 100000,
    maxRetries: 3
  },

  // High-quality compression — for important conversations
  quality: {
    preserveRecentMessages: 7,
    summaryPromptTokenBudget: 100000,
    maxRetries: 5
  }
};
```

### 2. Error Handling

```typescript
const result = await compressor.compressMessages(messages);

if (!result.success) {
  // Compression failed, but a fallback result is still available
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

See `fullModeCompressor.example.ts` for complete usage examples, including:

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

1. **Message structure analysis**
   - Identify the position of the first user message
   - Calculate the recent message range
   - Determine the middle range of messages to compress

2. **Compression strategy decision**
   - If no compression is needed: return original messages directly
   - If compression is needed: extract middle messages for summarization

3. **Intelligent summary generation**
   - Build structured conversation text
   - Apply VSCode's 8-part summary template
   - Call LLM API to generate the summary

4. **Message reassembly**
   - Preserve the first user message
   - Insert the summary message in place of the middle section
   - Retain the most recent messages

5. **Degradation handling**
   - Automatically fall back on API failure
   - Use a simple retention strategy
   - Always ensure a usable result is available

### Differences from VSCode Copilot Chat

1. **Simplified dependencies**: Removed dependency on VSCode-specific APIs
2. **Adapted for OpenKosmos**: Uses OpenKosmos `Message` types and LLM API
3. **Compression-focused**: Does not own token calculation; focused purely on compression logic
4. **Streamlined configuration**: Simplified config options highlighting core functionality

## Changelog

### v1.2.0 (2026-05-11)

- ✅ Tokenizer alignment: Compressor now uses `o200k_base` encoding, consistent with the Haiku 4.5 actual tokenizer, eliminating systematic bias
- ✅ `summaryPromptTokenBudget` 12K → 100K: Fully utilizes Haiku 4.5's 128K prompt window (28K safety margin)
- ✅ Haiku output limit `MAX_TOKENS` 5096 → 16000: Aligned with non-streaming `max_non_streaming_output_tokens`
- ✅ `maxSummaryRecursionDepth` 8 → 4: At 100K budget typically only 1 chunk is needed; 4 layers is a conservative upper bound
- ✅ `maxConcurrentChunkSummaries` 3 → 2: Matches actual chunk count under 100K budget
- ✅ Added `metadata.chunkSummaryCallCount`: Number of chunk-level `summarize()` calls (1 per chunk, retries not counted)
- ✅ Added `metadata.totalLlmCallCount`: Total actual LLM API requests (including all chunk retries), for monitoring retry amplification

### v1.0.0 (2024-11-07)

- ✅ Initial release
- ✅ Implemented Full Mode compression algorithm based on VSCode Copilot Chat
- ✅ Support for preserving the first user message and recent messages
- ✅ Integration of the 8-part structured summary template
- ✅ Implemented fallback strategy and error handling
- ✅ Full configuration options and usage examples provided
