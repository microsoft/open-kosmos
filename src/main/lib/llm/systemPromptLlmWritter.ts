import { ghcModelApi } from './ghcModelApi';
import {
  AGENT_SYSTEM_PROMPT_AGENTS_FILE,
  AGENT_SYSTEM_PROMPT_BASE_FILE,
  type AgentSystemPromptFile,
} from '@shared/types/agentSystemPrompt';

/**
 * System Prompt Writer response interface
 */
export interface SystemPromptWriterResponse {
  success: boolean;
  originalPrompt?: string;
  improvedPrompt?: string;
  changeSummary?: string[];
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

export interface SystemPromptWriterOptions {
  promptFile?: AgentSystemPromptFile;
}

/**
 * System Prompt LLM Writer
 * Uses GitHub Copilot models to improve and optimize system prompts
 */
export class SystemPromptLlmWriter {
  private static readonly SYSTEM_PROMPT = `# Identity

You are a System Prompt Polish Expert.

Your only job is to improve user-written system prompts so they are clearer, more structured, more precise, and more effective for modern LLMs, while preserving the user's original intent, scope, and constraints.

You are not a product designer, not a requirements generator, and not a role inventor.
Do not replace the user's prompt with a different prompt concept.
Do not add new capabilities, tools, workflows, or persona traits unless they are clearly implied by the user's original text and are necessary to remove ambiguity.

Your writing standards should align with common best practices reflected in official guidance from Anthropic and OpenAI:
- be clear and direct
- prefer positive, actionable instructions over purely negative prohibitions
- make output expectations explicit
- structure complex prompts with clear sections
- preserve the user's intent instead of rewriting from scratch
- avoid unnecessary verbosity and overengineering

# Primary Task

Given a user-provided system prompt draft, return a polished version that:
- preserves the original purpose
- resolves ambiguity
- removes redundancy and contradictions
- improves instruction ordering and grouping
- makes behavioral expectations more testable
- adds structure only when it materially improves reliability
- stays as simple as possible

# Operating Rules

## 1. Preserve Intent
Treat the user's original prompt as the source of truth.
Keep the same assistant purpose, target use case, and core restrictions.
If something is underspecified, make the smallest reasonable clarification rather than redesigning the prompt.

## 2. Prefer Minimal Necessary Changes
Do not over-rewrite.
Do not turn a short prompt into a bloated framework unless the original clearly needs more structure.
If the prompt is already strong, make only light edits.

## 3. Improve Instruction Quality
When useful:
- replace vague phrases like "be helpful", "be professional", or "be concise" with concrete behavioral guidance
- convert negative-only instructions into positive alternatives when that improves compliance
- make the scope of instructions explicit
- separate must-do rules from optional style guidance
- remove duplicated or conflicting rules

## 4. Improve Structure
Use section headers only when they improve readability or reliability.
Typical useful sections include:
- Identity
- Instructions
- Output Format
- Tool Use
- Safety Boundaries
- Context
- Examples

Do not force all sections into every prompt.
Use only the sections the prompt actually needs.

## 5. Examples
Add examples only if they materially improve reliability for a complex behavior, formatting rule, or edge case.
Do not add examples to simple prompts unless clearly beneficial.

## 6. Tool and Agent Behavior
If the prompt is clearly for an agentic assistant with tools, make the following clearer when needed:
- when to use tools versus answer directly
- what to do when the user's intent is ambiguous
- what actions require caution or confirmation
- how to communicate progress or limitations

Do not invent tool policies if the prompt is not for a tool-using agent.

## 7. Tone and Style
Preserve the user's intended tone unless it is too vague to be actionable.
Write polished system prompts in professional, natural English.
Avoid filler, hype, and generic AI phrasing.

# Output Requirements

Return valid JSON only. Do not use markdown fences.

Use exactly this schema:

{
  "success": true,
  "improvedPrompt": "the polished system prompt",
  "changeSummary": [
    "short explanation of important change 1",
    "short explanation of important change 2"
  ],
  "warnings": [],
  "errors": []
}

# Quality Bar

Before finalizing, check the improved prompt against these questions:
- Does it preserve the user's original intent?
- Is it clearer than the original?
- Is it more actionable and less ambiguous?
- Did it avoid unnecessary additions?
- Would a model follow it more reliably than the original?

If the answer to any of these is no, revise before returning.

# Failure Handling

If the input is empty, meaningless, or not actually a system prompt draft, return:

{
  "success": false,
  "improvedPrompt": "",
  "changeSummary": [],
  "warnings": [
    "Please provide a usable system prompt draft to polish."
  ],
  "errors": []
}`;

  private static getPromptFileInstructions(promptFile: AgentSystemPromptFile): string {
    if (promptFile === AGENT_SYSTEM_PROMPT_AGENTS_FILE) {
      return `# Current Prompt Area: Project Context

You are polishing Project Context instructions for an AI agent.

Project Context defines what the agent works on and how to work in that context: project or domain overview, workflows, rules, knowledge sources, constraints, terminology, tools, commands, paths, stakeholders, and known gotchas.

Preserve only facts present in the user's draft. Do not invent project facts, domain rules, commands, paths, policies, workflows, stakeholders, tools, terminology, or constraints.

Do not add generic agent personality, tone, or universal behavior rules unless they are explicitly context-specific. If the draft contains general agent identity instructions, keep them only when necessary and add a warning that they may belong in Agent Identity.`;
    }

    return `# Current Prompt Area: Agent Identity

You are polishing Agent Identity instructions for an AI agent.

Agent Identity defines who the agent is: role, expertise, responsibilities, behavior, communication style, boundaries, and safety rules.

Preserve the user's intent. Make the instructions clearer, more structured, and easier for an AI agent to follow.

Do not add project-specific or domain-specific workflows, facts, commands, paths, stakeholders, policies, customer details, or temporary task state. If the draft contains context-specific material, keep it only when necessary and add a warning that it may belong in Project Context.`;
  }

  private static getSystemPrompt(promptFile: AgentSystemPromptFile): string {
    return `${this.SYSTEM_PROMPT}

${this.getPromptFileInstructions(promptFile)}

# Language

Return a professional, concise, user-readable prompt in the same language as the input unless the input explicitly requests another language.`;
  }

  private static getWritingPrompt(promptFile: AgentSystemPromptFile): string {
    const promptArea = promptFile === AGENT_SYSTEM_PROMPT_AGENTS_FILE
      ? 'Project Context'
      : 'Agent Identity';
    return `Polish the following ${promptArea} draft while preserving the user's original intent.

${promptArea} draft:`;
  }

  /**
   * Improve system prompt
   * @param userInputPrompt User input system prompt
   * @returns Improved system prompt response
   */
  static async improveSystemPrompt(
    userInputPrompt: string,
    options: SystemPromptWriterOptions = {},
  ): Promise<SystemPromptWriterResponse> {
    const trimmedPrompt = userInputPrompt.trim();
    const promptFile = options.promptFile === AGENT_SYSTEM_PROMPT_AGENTS_FILE
      ? AGENT_SYSTEM_PROMPT_AGENTS_FILE
      : AGENT_SYSTEM_PROMPT_BASE_FILE;

    if (!trimmedPrompt || trimmedPrompt.length < 3) {
      return {
        success: false,
        warnings: [
          'Please provide a usable system prompt draft to polish.'
        ],
        errors: []
      };
    }

    try {
      const contextualPrompt = `${this.getWritingPrompt(promptFile)}

    """
    ${trimmedPrompt}
    """`;

      // Call LLM API
      const llmParams: SystemPromptWriterParams = {
        name: 'system prompt improvement',
        prompt: contextualPrompt,
        maxTokens: 10000,
        temperature: 0.7
      };

      // Use the claude-haiku-4.5 model for system prompt optimization
      const rawResponse = await ghcModelApi.callModel(
        'claude-haiku-4.5',
        llmParams.prompt,
        this.getSystemPrompt(promptFile),
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
        parsedResponse.originalPrompt = userInputPrompt;

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

    if (!response.improvedPrompt) {
      return !!(response.warnings && response.warnings.length > 0);
    }

    if (!response.improvedPrompt.trim()) {
      return !!(response.warnings && response.warnings.length > 0);
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
      description: string;
    }>;
    tips: string[];
  } {
    return {
      title: 'Intelligent System Prompt Optimizer Usage Guide',
      examples: [
        {
          type: 'Light Polish',
          input: 'You are a coding assistant. Be accurate, concise, and helpful. Ask follow-up questions when needed.',
          description: 'Tighten vague phrasing, reduce redundancy, and improve instruction clarity without changing the assistant role.'
        },
        {
          type: 'Structural Polish',
          input: 'You are a support agent. Answer product questions, stay polite, do not guess, and keep answers short. Use tools when necessary.',
          description: 'Reorganize mixed rules into clear sections and make tool-use conditions more explicit.'
        },
        {
          type: 'Agent Prompt Polish',
          input: 'You are an agent that can search files and run commands. Complete tasks autonomously, but do not do anything risky without confirmation.',
          description: 'Clarify autonomy boundaries, risky-action rules, and expected operating behavior for a tool-using agent.'
        },
        {
          type: 'Invalid Input',
          input: 'a',
          description: 'Reject unusable input and ask for a real system prompt draft to polish.'
        }
      ],
      tips: [
        'Paste an actual system prompt draft instead of a role name or one-line idea.',
        'The optimizer preserves your intent and focuses on clarity, structure, and instruction quality.',
        'If your draft is already strong, expect small edits rather than a full rewrite.',
        'For agent prompts, include any tool, safety, or output requirements you already care about.',
        'Avoid meaningless or extremely short input.'
      ]
    };
  }
}

// Export instantiated writer
export const systemPromptLlmWriter = SystemPromptLlmWriter;
export default systemPromptLlmWriter;