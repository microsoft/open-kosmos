import { ghcModelApi } from './ghcModelApi';
import { getGlobalLogger } from '../unifiedLogger';
import { TokenCounter } from '../token';

export interface ContextCompressionLlmSummarizerParams {
  conversationText: string;
  maxRetries?: number;
}

export interface ContextCompressionLlmSummarizerResponse {
  success: boolean;
  summary?: string;
  attempts: number;
  error?: string;
}

export class ContextCompressionLlmSummarizer {
  private static readonly LOG_SOURCE = 'ContextCompressionLlmSummarizer';
  private static readonly MODEL = 'claude-haiku-4.5';
  private static readonly MAX_TOKENS = 16000;
  private static readonly TEMPERATURE = 0.3;
  private static readonly OUTPUT_LANGUAGE = 'en';
  private static readonly SYSTEM_PROMPT = `You are a specialized conversation compression summarizer for a desktop AI coding assistant.

Your task is to compress prior conversation history into a continuation-safe handoff summary.

Rules:
- Preserve concrete technical facts, active tasks, decisions, constraints, and unresolved work.
- Preserve exact identifiers when they matter: file paths, symbol names, commands, URLs, model names, error messages, IDs, hashes, ports, and configuration values.
- Keep the summary dense, factual, and execution-oriented.
- Do not invent facts.
- Do not explain your summarization process.
- Follow the structure explicitly requested by the user prompt exactly.

Return only the requested summary.`;

  private static readonly SUMMARY_TEMPLATE_EN = `Your task is to create a comprehensive, detailed conversation summary that captures all essential information needed to continue work without losing any context. This summary will be used to compress the conversation while preserving key details, decisions, and progress for any type of general task.

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

  static buildPrompt(conversationText: string): string {
    return `${this.SUMMARY_TEMPLATE_EN}

### Conversation Content to Summarize:
${conversationText}

Please generate a structured summary according to the above requirements:`;
  }

  static estimateRequestTokens(tokenCounter: TokenCounter, conversationText: string): number {
    const userPrompt = this.buildPrompt(conversationText);

    return tokenCounter.countTextTokens(
      `system\n${this.SYSTEM_PROMPT}\n\nuser\n${userPrompt}`,
    );
  }

  static getPromptOverheadTokens(tokenCounter: TokenCounter): number {
    return this.estimateRequestTokens(tokenCounter, '');
  }

  static async summarize(
    params: ContextCompressionLlmSummarizerParams,
  ): Promise<ContextCompressionLlmSummarizerResponse> {
    const logger = getGlobalLogger();
    const maxRetries = Math.max(1, params.maxRetries ?? 3);
    const prompt = this.buildPrompt(params.conversationText);
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(
          `[CompressionSummary] 🤖 Calling LLM (${this.MODEL}) — promptLength=${prompt.length}, language=${this.OUTPUT_LANGUAGE}, maxTokens=${this.MAX_TOKENS}, temperature=${this.TEMPERATURE}, attempt=${attempt}/${maxRetries}`,
          this.LOG_SOURCE,
        );

        const response = await ghcModelApi.callModel(
          this.MODEL,
          prompt,
          this.SYSTEM_PROMPT,
          this.MAX_TOKENS,
          this.TEMPERATURE,
        );

        const summary = response.trim();
        if (!summary) {
          throw new Error('Empty response from compression summary API');
        }

        logger.info(
          `[CompressionSummary] ✅ Summary generated — length=${summary.length}, attempt=${attempt}/${maxRetries}`,
          this.LOG_SOURCE,
        );

        return {
          success: true,
          summary,
          attempts: attempt,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn(
          `[CompressionSummary] ⚠️ Summary attempt failed — attempt=${attempt}/${maxRetries}, error="${lastError.message}"`,
          this.LOG_SOURCE,
        );

        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    return {
      success: false,
      attempts: maxRetries,
      error: lastError?.message || 'Compression summary API call failed after all retries',
    };
  }
}

export const contextCompressionLlmSummarizer = ContextCompressionLlmSummarizer;
export default contextCompressionLlmSummarizer;