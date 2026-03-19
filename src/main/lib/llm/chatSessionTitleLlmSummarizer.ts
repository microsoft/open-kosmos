import { ghcModelApi } from './ghcModelApi';

/**
 * Chat Session Title Summarizer response interface
 */
export interface ChatSessionTitleSummarizerResponse {
  success: boolean;
  originalMessage?: string;
  title?: string;
  tokenCount?: number;
  warnings?: string[];
  errors?: string[];
  rawResponse?: string;
}

/**
 * Chat Session Title Summarizer LLM parameters
 */
export interface ChatSessionTitleSummarizerParams {
  name: string;
  prompt: string;
  maxTokens: number;
  temperature: number;
}

/**
 * Chat Session Title LLM Summarizer
 * Uses LLM API to generate concise titles for chat sessions based on user messages
 */
export class ChatSessionTitleLlmSummarizer {
  // System prompt for generating chat session titles
  private static readonly SYSTEM_PROMPT = `# Chat Session Title Generator

You are an expert at creating concise, informative titles for chat conversations. Your task is to analyze the user's message and generate a brief, descriptive title that captures the essence of the conversation topic.

## Guidelines

### Title Requirements
- **Length**: Maximum 20 tokens
- **Language**: Use the same language as the user's message
- **Clarity**: Clear and descriptive
- **Relevance**: Directly related to the main topic or intent
- **Conciseness**: Remove unnecessary words and filler

### Title Generation Rules
1. **Focus on the main topic**: Identify the primary subject or question
2. **Use keywords**: Include the most important terms from the message
3. **Be specific**: Avoid generic titles like "Question" or "Help"
4. **Action-oriented**: When applicable, reflect the user's intent (e.g., "Debug", "Create", "Analyze")
5. **Professional tone**: Keep it neutral and professional

### Examples

**User Message**: "How do I implement a binary search algorithm in Python?"
**Title**: "Python Binary Search Implementation"

**User Message**: "Can you help me debug this React component that's not rendering properly?"
**Title**: "Debug React Component Rendering"

**User Message**: "I need to analyze the sales trends of this dataset"
**Title**: "Sales Trend Data Analysis"

**User Message**: "Write a function to calculate factorial recursively"
**Title**: "Recursive Factorial Function"

**User Message**: "What's the difference between MongoDB and PostgreSQL?"
**Title**: "MongoDB vs PostgreSQL Comparison"

## Output Format

Return ONLY a JSON object with the title. Do not include any explanatory text, markdown markers, or code blocks:

{
  "success": true,
  "title": "Generated Title Here",
  "tokenCount": 4
}

If the message is too vague or unclear, return:

{
  "success": false,
  "warnings": ["Message too vague to generate meaningful title"],
  "title": "General Discussion"
}

**Important**: The title must be concise and within 20 tokens. Count tokens carefully.`;

  private static readonly TITLE_PROMPT = `Generate a concise title for this chat session based on the user message:`;

  /**
   * Estimate token count for a given text (rough approximation)
   * @param text Text to count tokens for
   * @returns Estimated token count
   */
  private static estimateTokenCount(text: string): number {
    // Rough approximation: 1 token ≈ 4 characters for English, 1 token ≈ 1-2 characters for Chinese
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = text.replace(/[\u4e00-\u9fa5]/g, '').trim().split(/\s+/).filter(word => word.length > 0).length;
    
    // Estimate: Chinese characters ~1 token each, English words ~1 token each
    return chineseChars + englishWords;
  }

  /**
   * Validate if message is suitable for title generation
   * @param userMessage User message to analyze
   * @returns Validation result
   */
  private static validateMessage(userMessage: string): {
    isValid: boolean;
    suggestion?: string;
  } {
    const trimmedMessage = userMessage.trim();
    
    // Check if message is too short
    if (trimmedMessage.length < 5) {
      return {
        isValid: false,
        suggestion: 'Message too short to generate meaningful title'
      };
    }

    // Check if message is too long (might be difficult to summarize)
    if (trimmedMessage.length > 1000) {
      return {
        isValid: true,
        suggestion: 'Long message detected, will focus on main topic'
      };
    }

    // Check if message contains only symbols or numbers
    if (!/[a-zA-Z\u4e00-\u9fa5]/.test(trimmedMessage)) {
      return {
        isValid: false,
        suggestion: 'Message contains no meaningful text for title generation'
      };
    }

    return { isValid: true };
  }

  /**
   * Generate chat session title from user message
   * @param userMessage User message to generate title from
   * @returns Chat session title response
   */
  static async generateTitle(userMessage: string): Promise<ChatSessionTitleSummarizerResponse> {
    // Analyze memory-related content in the user message
    const memoryKeywords = /memory|fact|extract|remember|search|retrieve|personal|context|history|learn|store|recall|knowledge|previous|conversation|chat/i;

    // Validate input message
    const validation = this.validateMessage(userMessage);

    if (!validation.isValid) {
      return {
        success: false,
        originalMessage: userMessage,
        warnings: [validation.suggestion || 'Invalid message for title generation'],
        errors: [],
        title: 'General Discussion'
      };
    }

    try {
      // Build complete prompt with memory context awareness
      const fullPrompt = `${this.TITLE_PROMPT}

"${userMessage}"`;

      // Call LLM API with minimal tokens since we only need a short title
      const llmParams: ChatSessionTitleSummarizerParams = {
        name: 'chat title generation',
        prompt: fullPrompt,
        maxTokens: 50, // Small limit since we only need a short title
        temperature: 0.3 // Low temperature for consistency
      };

      // Use claude-haiku-4.5 model for title generation (faster and lower cost)
      const rawResponse = await ghcModelApi.callModel(
        'claude-haiku-4.5',
        llmParams.prompt,
        this.SYSTEM_PROMPT,
        llmParams.maxTokens,
        llmParams.temperature
      );
      // Try to parse JSON returned by LLM
      let parsedResponse: ChatSessionTitleSummarizerResponse;
      try {
        // Clean up response
        let cleanedResponse = rawResponse.trim();
        
        // Remove markdown code block markers
        cleanedResponse = cleanedResponse
          .replace(/```json\s*/g, '')
          .replace(/```\s*/g, '')
          .trim();

        // Extract JSON object
        const firstBrace = cleanedResponse.indexOf('{');
        const lastBrace = cleanedResponse.lastIndexOf('}');
        
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          const jsonContent = cleanedResponse.substring(firstBrace, lastBrace + 1);
          parsedResponse = JSON.parse(jsonContent);
        } else {
          // Try direct parsing
          parsedResponse = JSON.parse(cleanedResponse);
        }
        
        // Add metadata
        parsedResponse.rawResponse = rawResponse;
        parsedResponse.originalMessage = userMessage;
        
        // Validate token count if title exists
        if (parsedResponse.title) {
          const estimatedTokens = this.estimateTokenCount(parsedResponse.title);
          parsedResponse.tokenCount = estimatedTokens;
          
          // Check if title exceeds 20 tokens
          if (estimatedTokens > 20) {
            // Truncate title if too long
            const words = parsedResponse.title.split(/\s+/);
            if (words.length > 20) {
              parsedResponse.title = words.slice(0, 20).join(' ');
              parsedResponse.tokenCount = 20;
              parsedResponse.warnings = parsedResponse.warnings || [];
              parsedResponse.warnings.push('Title was truncated to meet 20-token limit');
            }
          }
        }

      } catch (parseError) {
        // If parsing fails, create a fallback title
        const fallbackTitle = this.generateFallbackTitle(userMessage);
        
        parsedResponse = {
          success: true,
          originalMessage: userMessage,
          title: fallbackTitle,
          tokenCount: this.estimateTokenCount(fallbackTitle),
          warnings: [`LLM response parsing failed, using fallback title`],
          errors: [`Parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}`],
          rawResponse: rawResponse
        };
      }

      return parsedResponse;

    } catch (error) {
      // Generate fallback title on error
      const fallbackTitle = this.generateFallbackTitle(userMessage);

      return {
        success: false,
        originalMessage: userMessage,
        title: fallbackTitle,
        tokenCount: this.estimateTokenCount(fallbackTitle),
        errors: [`Title generation failed: ${error instanceof Error ? error.message : String(error)}`],
        rawResponse: undefined
      };
    }
  }

  /**
   * Generate a fallback title when LLM fails
   * @param userMessage Original user message
   * @returns Simple fallback title
   */
  private static generateFallbackTitle(userMessage: string): string {
    // Analyze memory content in the message for fallback generation
    const memoryKeywords = /memory|fact|extract|remember|search|retrieve|personal|context|history|learn|store|recall/i;
    const hasMemoryContent = memoryKeywords.test(userMessage);

    const trimmedMessage = userMessage.trim();
    
    // Extract first few words as fallback, prioritizing memory-related terms
    const words = trimmedMessage.split(/\s+/);
    let selectedWords: string[] = [];
    
    // If message has memory content, try to include memory-related words
    if (hasMemoryContent) {
      // Find words that contain memory keywords
      const memoryWords = words.filter(word => memoryKeywords.test(word));
      const nonMemoryWords = words.filter(word => !memoryKeywords.test(word));
      
      // Prioritize memory words, then add other words up to 4 total
      selectedWords = [...memoryWords.slice(0, 2), ...nonMemoryWords.slice(0, 4 - memoryWords.slice(0, 2).length)];
    } else {
      selectedWords = words.slice(0, 4);
    }
    
    let fallbackTitle = selectedWords.join(' ');
    
    // If too long, truncate
    if (fallbackTitle.length > 50) {
      fallbackTitle = fallbackTitle.substring(0, 47) + '...';
    }
    
    // If too short or generic, use memory-aware timestamp-based title
    if (fallbackTitle.length < 5) {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      
      // Use memory-aware titles when appropriate
      if (hasMemoryContent) {
        fallbackTitle = `Memory Chat ${timeStr}`;
      } else {
        fallbackTitle = `Chat ${timeStr}`;
      }
    }
    
    return fallbackTitle;
  }

  /**
   * Validate title generation result
   * @param response Title generation response
   * @returns Whether validation passes
   */
  static validateSummarizerResponse(response: ChatSessionTitleSummarizerResponse): boolean {
    if (!response.success && !response.title) {
      return false;
    }

    // Check if title exists
    if (!response.title) {
      return false;
    }

    // Check token count
    if (response.tokenCount && response.tokenCount > 20) {
      // Still valid, but warn
    }

    // Check if title is meaningful (not just whitespace or generic)
    const trimmedTitle = response.title.trim();
    if (trimmedTitle.length < 2) {
      return false;
    }

    return true;
  }

  /**
   * Get default values for title generation parameters
   */
  static getDefaultParams(): Omit<ChatSessionTitleSummarizerParams, 'prompt'> {
    return {
      name: 'chat title generation',
      maxTokens: 50,
      temperature: 0.3
    };
  }

  /**
   * Get usage guide and examples
   */
  static getUsageGuide(): {
    title: string;
    description: string;
    examples: Array<{
      input: string;
      expectedOutput: string;
      description: string;
    }>;
    tips: string[];
  } {
    return {
      title: 'Chat Session Title Summarizer Usage Guide',
      description: 'Generates concise, descriptive titles for chat sessions based on user messages, with a maximum of 20 tokens.',
      examples: [
        {
          input: 'How do I implement a binary search algorithm in Python?',
          expectedOutput: 'Python Binary Search Implementation',
          description: 'Technical programming question - focuses on language and algorithm'
        },
        {
          input: 'Can you help me debug this React component that\'s not rendering?',
          expectedOutput: 'Debug React Component Rendering',
          description: 'Debugging request - action-oriented title'
        },
        {
          input: 'I need to analyze the sales trends of this dataset',
          expectedOutput: 'Sales Trend Data Analysis',
          description: 'Chinese message - maintains original language'
        },
        {
          input: 'What\'s the weather like today?',
          expectedOutput: 'Weather Information Request',
          description: 'General inquiry - descriptive but specific'
        }
      ],
      tips: [
        '🎯 Titles focus on the main topic or intent of the message',
        '📝 Maximum 20 tokens to ensure conciseness',
        '🌐 Uses the same language as the user\'s message',
        '⚡ Fast generation with minimal API token usage',
        '🛡️ Fallback titles generated when LLM fails',
        '📊 Token counting helps ensure length compliance'
      ]
    };
  }
}

// Export instantiated summarizer
export const chatSessionTitleLlmSummarizer = ChatSessionTitleLlmSummarizer;
export default chatSessionTitleLlmSummarizer;