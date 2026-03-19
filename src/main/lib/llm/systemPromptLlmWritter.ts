import { ghcModelApi } from './ghcModelApi';

/**
 * System Prompt Writer response interface
 */
export interface SystemPromptWriterResponse {
  success: boolean;
  originalPrompt?: string;
  improvedPrompt?: string;
  strategy?: 'A' | 'B' | 'C'; // A: Simple expansion, B: Detailed optimization, C: Warning
  expansionNote?: string; // Explanation of supplemented content when strategy is A
  improvements?: string[];
  warnings?: string[];
  errors?: string[];
  rawResponse?: string;
}

/**
 * System Prompt Writer LLM parameters
 */
export interface SystemPromptWriterParams {
  name: string;
  prompt: string;
  maxTokens: number;
  temperature: number;
}

/**
 * System Prompt LLM Writer
 * Uses Azure OpenAI API to improve and optimize system prompts
 */
export class SystemPromptLlmWriter {
  // System prompt for the System Prompt Writer
  private static readonly SYSTEM_PROMPT = `# Intelligent System Prompt Optimization Expert

You are a professional system prompt optimization expert. You need to intelligently analyze user input and provide corresponding processing solutions.

## Core Processing Logic

### 1. Input Content Analysis
First analyze the type of user input content:
- **Simple Description**: Only role names and basic descriptions (e.g., "data analyst", "help me write code")
- **Detailed Information**: Contains specific tasks, constraints, output formats, and other detailed requirements
- **Invalid Information**: Blank, meaningless text, or overly vague content

### 2. Processing Strategies

#### Strategy A: Simple Description Expansion
When users only provide role names or simple descriptions:
1. Create a complete system prompt based on common role responsibilities and best practices
2. Include: role definition, core skills, working methods, output format, and considerations
3. Add a friendly reminder at the end explaining which key information was supplemented based on understanding
4. Suggest users provide more specific information to get a more suitable prompt

#### Strategy B: Detailed Information Optimization
When users provide detailed information:
1. Maintain the user's original intent and requirements
2. Optimize structure and expression
3. Supplement missing important elements
4. Ensure logical consistency

#### Strategy C: Warning Response
When users input invalid information:
1. Return warning information
2. Guide users on how to provide valid input

### 3. Markdown Format Requirements
- All system prompts must use markdown format
- Use appropriate heading levels, lists, code blocks, etc.
- Ensure readability and clear structure

## Output Format Requirements

Strictly return in the following JSON format, do not add any additional explanatory text, markdown markers, or code block markers:

{
  "success": true,
  "improvedPrompt": "Optimized system prompt in markdown format",
  "strategy": "A|B|C",
  "expansionNote": "When strategy is A, explain the supplemented content",
  "warnings": ["Warning messages"],
  "errors": []
}

**Important**: Return pure JSON object directly, do not wrap with markdown code blocks.`;

  private static readonly WRITING_PROMPT = `Please analyze the following user input and provide corresponding System Prompt optimization:

Input content:`;

  /**
   * Analyze user input type
   * @param userInput User input
   * @returns Input analysis result
   */
  private static analyzeUserInput(userInput: string): {
    type: 'simple' | 'detailed' | 'invalid';
    confidence: number;
    suggestion: string;
  } {
    const trimmedInput = userInput.trim();
    
    // Check if input is invalid
    if (!trimmedInput || trimmedInput.length < 3) {
      return {
        type: 'invalid',
        confidence: 1.0,
        suggestion: 'Please provide specific role names or descriptions, for example: "Data Analyst", "Python Programming Assistant", etc.'
      };
    }

    // Check if input is simple (only role name or brief description)
    const simplePatterns = [
      /^[\u4e00-\u9fa5]{2,10}$/,  // Chinese role names
      /^[a-zA-Z\s]{3,20}$/,      // English role names
      /^.{3,30}$(?!.*[：:])(?!.*要求)(?!.*格式)(?!.*输出)/  // Brief description without detailed requirements (Chinese: 要求=requirements, 格式=format, 输出=output)
    ];

    // Check if input contains detailed specification keywords (Chinese + English)
    const detailedKeywords = [
      '要求', '输出格式', '注意事项', '约束', '规则', '步骤', '流程',  // Chinese: requirements, output format, notes, constraints, rules, steps, process
      'requirement', 'format', 'output', 'constraint', 'rule', 'step',
      '：', ':', '。', '；', ';', '\n'
    ];

    const hasDetailedKeywords = detailedKeywords.some(keyword => 
      trimmedInput.toLowerCase().includes(keyword.toLowerCase())
    );

    if (hasDetailedKeywords || trimmedInput.length > 100) {
      return {
        type: 'detailed',
        confidence: 0.8,
        suggestion: 'Will optimize your detailed description, improving structure and expression while maintaining original intent'
      };
    }

    if (simplePatterns.some(pattern => pattern.test(trimmedInput))) {
      return {
        type: 'simple',
        confidence: 0.9,
        suggestion: 'Will generate a complete System Prompt based on role understanding'
      };
    }

    return {
      type: 'simple',
      confidence: 0.6,
      suggestion: 'Will attempt to understand your description and generate corresponding System Prompt'
    };
  }

  /**
   * Improve system prompt
   * @param userInputPrompt User input system prompt
   * @returns Improved system prompt response
   */
  static async improveSystemPrompt(userInputPrompt: string): Promise<SystemPromptWriterResponse> {
    // First analyze user input
    const inputAnalysis = this.analyzeUserInput(userInputPrompt);

    // If input is invalid, return warning directly
    if (inputAnalysis.type === 'invalid') {
      return {
        success: false,
        strategy: 'C',
        warnings: [
          'Input content is too simple or invalid.',
          inputAnalysis.suggestion,
          'Example valid inputs:',
          '• Simple description: "Python Programming Assistant", "Data Analyst"',
          '• Detailed description: "I need an AI assistant to help write Python code, requirements...output format..."'
        ],
        errors: []
      };
    }

    try {
      // Build complete prompt with context
      const contextualPrompt = `${this.WRITING_PROMPT}

"${userInputPrompt}"

User input analysis:
- Type: ${inputAnalysis.type === 'simple' ? 'Simple description' : 'Detailed description'}
- Suggested strategy: ${inputAnalysis.type === 'simple' ? 'Strategy A (Expansion)' : 'Strategy B (Optimization)'}
- Confidence: ${inputAnalysis.confidence}`;

      // Call LLM API
      const llmParams: SystemPromptWriterParams = {
        name: 'system prompt improvement',
        prompt: contextualPrompt,
        maxTokens: 10000,
        temperature: 0.7
      };

      // Use claude-haiku-4.5 model for system prompt optimization
      const rawResponse = await ghcModelApi.callModel(
        'claude-haiku-4.5',
        llmParams.prompt,
        this.SYSTEM_PROMPT,
        llmParams.maxTokens,
        llmParams.temperature
      );

      // Try to parse JSON returned by LLM
      let parsedResponse: SystemPromptWriterResponse;
      try {
        // More robust JSON extraction and cleanup logic
        let cleanedResponse = rawResponse.trim();
        
        // Remove markdown code block markers
        cleanedResponse = cleanedResponse
          .replace(/```json\s*/g, '')
          .replace(/```\s*/g, '')
          .trim();

        // Try to extract JSON object
        // Find content between first { and last }
        const firstBrace = cleanedResponse.indexOf('{');
        const lastBrace = cleanedResponse.lastIndexOf('}');
        
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          const jsonContent = cleanedResponse.substring(firstBrace, lastBrace + 1);
          parsedResponse = JSON.parse(jsonContent);
        } else {
          // If complete JSON structure not found, try to parse cleaned content directly
          parsedResponse = JSON.parse(cleanedResponse);
        }
        
        parsedResponse.rawResponse = rawResponse;

      } catch (parseError) {
        // If parsing fails, return error response
        parsedResponse = {
          success: false,
          errors: [`LLM response parsing failed: ${parseError instanceof Error ? parseError.message : String(parseError)}`],
          rawResponse: rawResponse
        };
      }

      return parsedResponse;

    } catch (error) {
      return {
        success: false,
        errors: [`Improvement failed: ${error instanceof Error ? error.message : String(error)}`],
        rawResponse: undefined
      };
    }
  }

  /**
   * Validate improvement result
   * @param response Improvement response
   * @returns Whether validation passes
   */
  static validateWriterResponse(response: SystemPromptWriterResponse): boolean {
    if (!response.success) {
      return false;
    }

    // For strategy C (warning), no improved prompt needed
    if (response.strategy === 'C') {
      return !!(response.warnings && response.warnings.length > 0);
    }

    // Check required fields for strategies A and B
    if (!response.improvedPrompt) {
      return false;
    }

    // Validate markdown format (simple check)
    if (!response.improvedPrompt.includes('#') && !response.improvedPrompt.includes('##')) {
      // Improved prompt may not be properly formatted as markdown
    }

    // Check if improved prompt is different from original
    if (response.originalPrompt && response.improvedPrompt === response.originalPrompt) {
      return false;
    }

    return true;
  }

  /**
   * Get default values for improvement parameters
   */
  static getDefaultParams(): Omit<SystemPromptWriterParams, 'prompt'> {
    return {
      name: 'system prompt improvement',
      maxTokens: 1000,
      temperature: 0.7
    };
  }

  /**
   * Get usage guide and examples
   */
  static getUsageGuide(): {
    title: string;
    examples: Array<{
      type: string;
      input: string;
      expectedStrategy: string;
      description: string;
    }>;
    tips: string[];
  } {
    return {
      title: 'Intelligent System Prompt Optimizer Usage Guide',
      examples: [
        {
          type: 'Simple Role Description',
          input: 'Python Programming Assistant',
          expectedStrategy: 'Strategy A (Intelligent Expansion)',
          description: 'Generate complete system prompt based on role understanding, including skill definition, working methods, output format, etc.'
        },
        {
          type: 'Simple Task Description',
          input: 'Help me write code',
          expectedStrategy: 'Strategy A (Intelligent Expansion)',
          description: 'Supplement specific skill requirements, coding standards, response format and other details based on task type'
        },
        {
          type: 'Detailed Requirements Description',
          input: 'I need a data analysis assistant, requirements: 1. Proficient in Python and SQL 2. Able to generate visualization charts 3. Output format should include analysis process',
          expectedStrategy: 'Strategy B (Structure Optimization)',
          description: 'Maintain original requirements, optimize expression structure, supplement missing elements, ensure logical clarity'
        },
        {
          type: 'Invalid Input',
          input: 'a',
          expectedStrategy: 'Strategy C (Provide Guidance)',
          description: 'Identify invalid input, provide specific improvement suggestions and examples'
        }
      ],
      tips: [
        '💡 Simple description: Just provide role name or basic function, AI will intelligently expand',
        '📝 Detailed description: Provide specific requirements, constraints, output format, etc., AI will optimize structure',
        '⚠️  Avoid overly simple input, such as single letters or meaningless text',
        '🎯 Generated System Prompt will be returned in Markdown format for easy reading and use',
        '🔄 If results are unsatisfactory, provide more specific information to regenerate'
      ]
    };
  }
}

// Export instantiated writer
export const systemPromptLlmWriter = SystemPromptLlmWriter;
export default systemPromptLlmWriter;