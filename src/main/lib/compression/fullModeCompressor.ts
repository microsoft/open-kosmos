// src/main/lib/compression/fullModeCompressor.ts
// VSCode Copilot Chat Full Mode compression algorithm migration version
// Dedicated to intelligent compression of Kosmos Messages

import { Message, MessageHelper } from '../types/chatTypes';
import { ghcModelApi } from '../llm/ghcModelApi';

/**
 * Full Mode Compression Configuration
 */
export interface FullModeCompressionConfig {
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

/**
 * Compression Result
 */
export interface FullModeCompressionResult {
  /** Whether compression was successful */
  success: boolean;
  /** Original message list */
  originalMessages: Message[];
  /** Compressed message list */
  compressedMessages: Message[];
  /** Compression strategy description */
  strategy: string;
  /** Range of compressed messages */
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

/**
 * Kosmos General Task Compressor
 * Intelligent compression implementation based on 8-part structured summary template, adapted for general task scenarios
 */
export class FullModeCompressor {
  private config: FullModeCompressionConfig;
  
  // Default configuration
  private static readonly DEFAULT_CONFIG: FullModeCompressionConfig = {
    preserveRecentMessages: 5,
    preserveFirstUserMessage: true,
    preserveFirstSkillToolCall: true,
    summaryModel: 'claude-haiku-4.5',
    maxSummaryTokens: 5096,
    summaryLanguage: 'en',
    maxRetries: 3,
    enableDebugLog: false
  };

  // Kosmos General Task summary template - adapted for general task scenarios
  private readonly summaryTemplate = `Your task is to create a comprehensive, detailed conversation summary that captures all essential information needed to continue work without losing any context. This summary will be used to compress the conversation while preserving key details, decisions, and progress for any type of general task.

## Recent Context Analysis

Pay special attention to the recent agent commands and tool executions that led to this summary being triggered. Include:
- **Last Agent Command**: The specific operation/tool just executed
- **Tool Results**: Key results from recent tool calls (truncate if long but preserve essential information)
- **Immediate State**: What the system was actively doing before the summary
- **Trigger Context**: What caused the token budget to be exceeded

## Analysis Process

Before providing your final summary, wrap your analysis in <analysis> tags to systematically organize your thoughts:

1. **Chronological Review**: Walk through the conversation chronologically, identifying key phases and transitions
2. **Intent Mapping**: Extract all explicit and implicit user requests, goals, and expectations
3. **Resource Inventory**: Catalog all important concepts, tools, resources, and decisions discussed
4. **Content Analysis**: Document key information shared, files processed, and insights gained
5. **Progress Assessment**: Evaluate what has been completed vs. what remains
6. **Context Verification**: Ensure all critical continuation information is captured
7. **Recent Command Analysis**: Document specific agent commands and tool results from recent operations

## Summary Structure

Your summary MUST contain these sections in order, following the exact format:

<analysis>
[Chronological Review: Walk through conversation phases: initial request → exploration → implementation → current state]
[Intent Mapping: List each explicit user request with message context]
[Resource Inventory: Document all mentioned tools, concepts, resources, and decisions]
[Content Analysis: Document key information shared, files processed, and insights provided]
[Progress Assessment: What's completed vs. pending with specific status]
[Context Verification: Verify all continuation context is captured]
[Recent Command Analysis: Last executed agent commands, tool results (truncated if long), immediate state before summary]
</analysis>

<summary>
1. Conversation Overview:
- Primary Objectives: [Exact quotes of all explicit user requests and overall goals]
- Session Context: [High-level narrative of conversation flow and key phases]
- User Intent Evolution: [How user needs or direction changed throughout conversation]

2. Resource Foundation:
- [Core Resource/Tool 1]: [Details and purpose in the task]
- [Concept/Method 2]: [Configuration and usage context]
- [Approach/Strategy 3]: [Implementation details and reasoning]
- [Environment Details 4]: [Setup details and constraints]

3. Content Status:
- [File/Resource 1]:
  - Purpose: [Why this resource is important to the task]
  - Current State: [Summary of recent changes or processing]
  - Key Content: [Brief description of important information or data]
  - Dependencies: [How this relates to other components]
- [File/Resource 2]:
  - Purpose: [Role in the task]
  - Current State: [Processing status]
  - Key Content: [Critical information]
- [Add additional resources as needed]

4. Problem Resolution:
- Issues Encountered: [Problems, errors, or challenges faced]
- Solutions Implemented: [How problems were resolved and reasoning]
- Troubleshooting Context: [Ongoing investigation work or known issues]
- Lessons Learned: [Important insights or patterns discovered]

5. Progress Tracking:
- Completed Tasks: [What has been successfully accomplished with status indicators]
- Partially Complete Work: [Tasks in progress with current completion status]
- Validated Results: [Outcomes confirmed working or accepted]

6. Active Work State:
- Current Focus: [Exact content being worked on in recent messages]
- Recent Context: [Detailed description of last few conversation exchanges]
- Working Content: [Information, files, or data recently processed or discussed]
- Immediate Context: [Specific task or issue being addressed before summary]

7. Recent Operations:
- Last Agent Command: [Specific tool/operation executed before summary with exact command name]
- Tool Results Summary: [Key results from recent tool executions - truncate long results but preserve essential info]
- Pre-Summary State: [What the agent was actively doing when token budget exceeded]
- Operation Context: [Why these specific commands were executed and their relationship to user goals]

8. Continuation Plan:
- [Pending Task 1]: [Details and specific next steps with verbatim quotes]
- [Pending Task 2]: [Requirements and continuation context]
- [Priority Information]: [Which tasks are most urgent or logical order]
- [Next Actions]: [Immediate next steps from recent messages with direct quotes]
</summary>

## Quality Guidelines

- **Precision**: Include exact names, terms, and specific details mentioned
- **Completeness**: Capture all context needed to continue work without re-reading the full conversation
- **Clarity**: Write for someone who needs to pick up where the conversation left off
- **Verbatim Accuracy**: Use direct quotes for task specifications and recent work context
- **Comprehensive Coverage**: Include sufficient detail for complex tasks and multi-faceted work
- **Logical Flow**: Present information in a way that progressively builds understanding

This summary should serve as a comprehensive handoff document that enables seamless continuation of all active workflows while preserving the full contextual richness of the original conversation.`;

  constructor(config: Partial<FullModeCompressionConfig> = {}) {
    this.config = { ...FullModeCompressor.DEFAULT_CONFIG, ...config };
  }

  /**
   * Compress message list
   * Strategy: preserve the first user message + most recent N messages, compress the middle portion
   */
  async compressMessages(messages: Message[]): Promise<FullModeCompressionResult> {
    const startTime = Date.now();

    this.log('Starting Full Mode compression', {
      messageCount: messages.length,
      config: this.config
    });

    try {
      // 1. Analyze message structure
      const analysis = this.analyzeMessageStructure(messages);
      
      // 2. If no compression needed, return directly
      if (!analysis.needsCompression) {
        return this.createResult(
          true,
          messages,
          messages,
          'no_compression_needed',
          startTime,
          analysis
        );
      }

      // 3. Perform compression
      const compressionResult = await this.performCompression(messages, analysis);
      
      // 4. Return result
      return this.createResult(
        true,
        messages,
        compressionResult.compressedMessages,
        'intelligent_summary',
        startTime,
        analysis,
        compressionResult.summary
      );

    } catch (error) {
      this.log('Compression failed', error);
      
      // Fall back to simple preservation strategy
      const fallbackResult = this.performFallbackCompression(messages);
      
      return this.createResult(
        false,
        messages,
        fallbackResult,
        'fallback_preservation',
        startTime,
        this.analyzeMessageStructure(messages),
        undefined,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Find the first successful SKILL.md read_file tool call and its corresponding tool result
   * Returns an array of message indices to protect
   */
  private findFirstSkillToolCallIndices(messages: Message[]): number[] {
    const protectedIndices: number[] = [];
    
    // 1. Find the first assistant message containing a read_file tool call targeting skill.md
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      
      // Check if this is an assistant message with tool_calls
      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        // Find read_file call where target file name contains skill.md (case-insensitive)
        const skillToolCall = msg.tool_calls.find(tc => {
          if (tc.function?.name === 'read_file') {
            try {
              const args = typeof tc.function.arguments === 'string' 
                ? JSON.parse(tc.function.arguments) 
                : tc.function.arguments;
              const filePath = args?.filePath || args?.path || '';
              return filePath.toLowerCase().includes('skill.md');
            } catch {
              return false;
            }
          }
          return false;
        });
        
        if (skillToolCall) {
          // Found assistant message containing skill.md read_file
          protectedIndices.push(i);
          
          // 2. Find the corresponding tool result message
          // The tool result message's tool_call_id should match skillToolCall.id
          for (let j = i + 1; j < messages.length; j++) {
            const resultMsg = messages[j];
            if (resultMsg.role === 'tool' && resultMsg.tool_call_id === skillToolCall.id) {
              // Verify this is a successful result (content is not empty and does not contain errors)
              const content = MessageHelper.getText(resultMsg);
              if (content && !content.toLowerCase().includes('"error"') && content.length > 100) {
                protectedIndices.push(j);
              }
              break;
            }
          }
          
          // Only protect the first one, return immediately after finding it
          break;
        }
      }
    }
    
    return protectedIndices;
  }

  /**
   * Analyze message structure
   */
  private analyzeMessageStructure(messages: Message[]): {
    totalMessages: number;
    firstUserMessageIndex: number;
    firstSkillToolCallIndices: number[];
    recentMessagesStartIndex: number;
    middleMessagesRange: { start: number; end: number; count: number } | null;
    needsCompression: boolean;
  } {
    const totalMessages = messages.length;
    
    // Find the first user message
    const firstUserMessageIndex = this.config.preserveFirstUserMessage 
      ? messages.findIndex(msg => msg.role === 'user')
      : -1;

    // Find the first successful SKILL.md read_file tool call and its corresponding tool result
    const firstSkillToolCallIndices = this.config.preserveFirstSkillToolCall
      ? this.findFirstSkillToolCallIndices(messages)
      : [];

    // Calculate the start index of recent messages
    const recentMessagesStartIndex = Math.max(
      0, 
      totalMessages - this.config.preserveRecentMessages
    );

    // Calculate the range of middle messages to compress
    let middleMessagesRange: { start: number; end: number; count: number } | null = null;
    let needsCompression = false;

    if (firstUserMessageIndex !== -1 && firstUserMessageIndex < recentMessagesStartIndex - 1) {
      // There are middle messages to compress
      middleMessagesRange = {
        start: firstUserMessageIndex + 1,
        end: recentMessagesStartIndex - 1,
        count: recentMessagesStartIndex - firstUserMessageIndex - 1
      };
      needsCompression = middleMessagesRange.count > 0;
    } else if (firstUserMessageIndex === -1 && totalMessages > this.config.preserveRecentMessages) {
      // No first user message, but total message count exceeds preservation count
      middleMessagesRange = {
        start: 0,
        end: recentMessagesStartIndex - 1,
        count: recentMessagesStartIndex
      };
      needsCompression = middleMessagesRange.count > 0;
    }

    return {
      totalMessages,
      firstUserMessageIndex,
      firstSkillToolCallIndices,
      recentMessagesStartIndex,
      middleMessagesRange,
      needsCompression
    };
  }

  /**
   * Perform intelligent compression
   */
  private async performCompression(
    messages: Message[], 
    analysis: ReturnType<typeof this.analyzeMessageStructure>
  ): Promise<{ compressedMessages: Message[]; summary?: string }> {
    const { firstUserMessageIndex, firstSkillToolCallIndices, middleMessagesRange, recentMessagesStartIndex } = analysis;

    if (!middleMessagesRange) {
      return { compressedMessages: messages };
    }

    // Create protected index set (including indices from firstSkillToolCallIndices that fall within the middle message range)
    const protectedMiddleIndices = new Set(
      firstSkillToolCallIndices.filter(
        idx => idx >= middleMessagesRange.start && idx <= middleMessagesRange.end
      )
    );

    // Extract middle messages to compress (excluding protected messages)
    const middleMessages = messages.slice(
      middleMessagesRange.start, 
      middleMessagesRange.end + 1
    ).filter((_, idx) => !protectedMiddleIndices.has(middleMessagesRange.start + idx));

    this.log('Compressing middle messages', {
      range: middleMessagesRange,
      messageCount: middleMessages.length
    });

    // Generate summary
    const summary = await this.generateSummary(middleMessages);

    // Build compressed message list
    const compressedMessages: Message[] = [];

    // 1. Add the first user message (if exists)
    if (firstUserMessageIndex !== -1 && firstUserMessageIndex < middleMessagesRange.start) {
      compressedMessages.push(messages[firstUserMessageIndex]);
    }

    // 2. Add messages after the first user message and before middle messages
    if (firstUserMessageIndex !== -1 && firstUserMessageIndex + 1 < middleMessagesRange.start) {
      compressedMessages.push(...messages.slice(firstUserMessageIndex + 1, middleMessagesRange.start));
    } else if (firstUserMessageIndex === -1 && middleMessagesRange.start > 0) {
      compressedMessages.push(...messages.slice(0, middleMessagesRange.start));
    }

    // 3. Add summary message
    if (summary) {
      const summaryMessage = MessageHelper.createTextMessage(
        summary,
        'assistant',
        `summary_${Date.now()}`
      );
      compressedMessages.push(summaryMessage);
    }

    // 4. Add protected SKILL.md tool call + tool result (if they are within the middle message range)
    // Add in original order
    const sortedProtectedIndices = Array.from(protectedMiddleIndices).sort((a, b) => a - b);
    for (const idx of sortedProtectedIndices) {
      compressedMessages.push(messages[idx]);
    }

    // 5. Add recent messages
    compressedMessages.push(...messages.slice(recentMessagesStartIndex));

    return { compressedMessages, summary };
  }

  /**
   * Generate intelligent summary
   */
  private async generateSummary(messages: Message[]): Promise<string> {
    // Build conversation text
    const conversationText = this.buildConversationText(messages);
    
    // Build summary prompt
    const summaryPrompt = this.buildSummaryPrompt(conversationText);

    // Call LLM to generate summary
    return await this.callSummaryAPI(summaryPrompt);
  }

  /**
   * Build conversation text
   */
  private buildConversationText(messages: Message[]): string {
    const conversationParts: string[] = [];

    for (const message of messages) {
      const text = MessageHelper.getText(message);
      let messagePart = `**${message.role}**: ${text}`;

      // Handle tool calls
      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolNames = message.tool_calls.map(tc => tc.function.name).join(', ');
        messagePart += ` [Tool calls: ${toolNames}]`;
      }

      // Handle attachments
      if (MessageHelper.hasAttachments(message)) {
        const attachmentCounts = MessageHelper.getAttachmentCounts(message);
        const attachmentInfo = [];
        
        if (attachmentCounts.files > 0) {
          const files = MessageHelper.getFiles(message);
          attachmentInfo.push(`${attachmentCounts.files} files: ${files.map(f => f.file.fileName).join(', ')}`);
        }
        
        if (attachmentCounts.images > 0) {
          const images = MessageHelper.getImages(message);
          attachmentInfo.push(`${attachmentCounts.images} images: ${images.map(img => img.metadata.fileName).join(', ')}`);
        }
        
        if (attachmentInfo.length > 0) {
          messagePart += ` [Attachments: ${attachmentInfo.join('; ')}]`;
        }
      }

      conversationParts.push(messagePart);
    }

    return conversationParts.join('\n\n');
  }

  /**
   * Build summary prompt
   */
  private buildSummaryPrompt(conversationText: string): string {
    return `${this.summaryTemplate}

### Conversation Content to Summarize:
${conversationText}

Please generate a structured summary according to the above requirements:`;
  }

  /**
   * Call summary API
   */
  private async callSummaryAPI(summaryPrompt: string): Promise<string> {
    let lastError: Error | null = null;

    // Retry mechanism
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        this.log(`Summary API call attempt ${attempt}/${this.config.maxRetries}`, {
          model: this.config.summaryModel,
          maxTokens: this.config.maxSummaryTokens
        });

        const response = await ghcModelApi.callModel(
          this.config.summaryModel,
          summaryPrompt,
          undefined, // No additional system prompt needed
          this.config.maxSummaryTokens,
          0.3 // Lower temperature for consistent summarization
        );

        if (response && response.trim()) {
          this.log(`Summary API call successful on attempt ${attempt}`);
          return response;
        } else {
          throw new Error('Empty response from summary API');
        }

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.log(`Summary API call attempt ${attempt} failed:`, lastError.message);

        if (attempt < this.config.maxRetries) {
          // Exponential backoff
          const delay = Math.pow(2, attempt) * 1000;
          this.log(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Summary API call failed after all retries');
  }

  /**
   * Perform fallback compression (simple preservation strategy)
   */
  private performFallbackCompression(messages: Message[]): Message[] {
    const result: Message[] = [];
    
    // Add first user message
    if (this.config.preserveFirstUserMessage) {
      const firstUserIndex = messages.findIndex(msg => msg.role === 'user');
      if (firstUserIndex !== -1) {
        result.push(messages[firstUserIndex]);
      }
    }

    // Add recent messages
    const recentStartIndex = Math.max(0, messages.length - this.config.preserveRecentMessages);
    result.push(...messages.slice(recentStartIndex));

    // Deduplicate (avoid duplicating first user message and recent messages)
    const seen = new Set();
    return result.filter(msg => {
      const key = msg.id || `${msg.role}_${Date.now()}_${Math.random()}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Create compression result
   */
  private createResult(
    success: boolean,
    originalMessages: Message[],
    compressedMessages: Message[],
    strategy: string,
    startTime: number,
    analysis: ReturnType<typeof this.analyzeMessageStructure>,
    summary?: string,
    error?: string
  ): FullModeCompressionResult {
    return {
      success,
      originalMessages,
      compressedMessages,
      strategy,
      compressedRange: analysis.middleMessagesRange ? {
        startIndex: analysis.middleMessagesRange.start,
        endIndex: analysis.middleMessagesRange.end,
        messageCount: analysis.middleMessagesRange.count
      } : undefined,
      summary,
      processingTime: Date.now() - startTime,
      error,
      metadata: {
        preservedFirst: analysis.firstUserMessageIndex !== -1,
        preservedRecent: Math.min(this.config.preserveRecentMessages, originalMessages.length),
        compressionMethod: summary ? 'summary' : (success ? 'none' : 'fallback'),
        timestamp: Date.now()
      }
    };
  }

  /**
   * Log output
   */
  private log(message: string, data?: any): void {
    if (this.config.enableDebugLog) {
    }
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<FullModeCompressionConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.log('Configuration updated', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): FullModeCompressionConfig {
    return { ...this.config };
  }
}

/**
 * Factory function for creating a Full Mode Compressor
 */
export function createFullModeCompressor(config?: Partial<FullModeCompressionConfig>): FullModeCompressor {
  return new FullModeCompressor(config);
}