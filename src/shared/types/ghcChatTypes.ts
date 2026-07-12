import { Message, ToolCall, StartChatCallbacks } from './chatTypes';

export interface GhcApiSettings {
  apiEndpoint: string;
  currentModel: string;
  temperature: number;
  maxTokens: number;
  capabilities: string[];
  modelConfigs: Map<string, GhcModelConfig>;
}

// GitHub Copilot Model interface based on official API response
export interface GhcCopilotModel {
  billing: {
    is_premium: boolean;
    multiplier: number;
    restricted_to?: string[];
  };
  capabilities: {
    family: string;
    limits?: {
      max_context_window_tokens?: number;
      max_non_streaming_output_tokens?: number;
      max_output_tokens?: number;
      max_prompt_tokens?: number;
      max_inputs?: number; // For embeddings
      vision?: {
        max_prompt_image_size: number;
        max_prompt_images: number;
        supported_media_types: string[];
      };
    };
    object: "model_capabilities";
    supports: {
      adaptive_thinking?: boolean;
      parallel_tool_calls?: boolean;
      reasoning_effort?: string[]; // e.g. ["low", "medium", "high"]
      streaming?: boolean; // Optional for some model types
      structured_outputs?: boolean;
      tool_calls?: boolean;
      vision?: boolean;
      max_thinking_budget?: number;
      min_thinking_budget?: number;
      dimensions?: boolean; // For embeddings
    };
    tokenizer: string;
    type: "chat" | "completion" | "embeddings";
  };
  id: string;
  is_chat_default: boolean;
  is_chat_fallback: boolean;
  model_picker_category?: "versatile" | "lightweight" | "powerful";
  model_picker_enabled: boolean;
  name: string;
  object: "model";
  policy?: {
    state: "enabled" | "disabled";
    terms: string;
  };
  preview: boolean;
  supported_endpoints?: string[]; // API endpoints supported by this model
  vendor: string;
  version: string;
  warning_message?: string;
}

// Backward compatibility - keep old interface for gradual migration
export interface GhcModel {
  id: string;
  name: string;
  attachment: boolean;
  reasoning: boolean;
  temperature: boolean;
  tool_call: boolean;
  knowledge: string;
  release_date: string;
  last_updated: string;
  modalities: {
    input: string[];
    output: string[];
  };
  open_weights: boolean;
  limit: {
    context: number;
    output: number;
  };
}

export interface GhcModelConfig {
  temperature: number;
  maxTokens: number;
  topP?: number;
  enabled: boolean;
  customPrompt?: string;
}

/**
 * Reasoning effort level reported by Copilot `/models` capabilities.
 * Kept as a plain string because GitHub Copilot adds new tiers over time
 * (e.g. `minimal`, future high-tier values) and we should not silently drop
 * unrecognized levels. Values are canonicalized to lowercase on read/write
 * to match the OpenAI-compatible API's expected casing.
 */
export type ReasoningEffort = string;

export interface GhcModelCapabilities {
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsImages: boolean;
  supportsAudio: boolean;
  supportsVideo: boolean;
  supportsReasoning: boolean;
  supportsTemperature: boolean;
  maxContextLength: number;
  maxOutputLength: number;
  tokenizer?: 'cl100k_base' | 'o200k_base';
  /**
   * Effort levels the model exposes via `supports.reasoning_effort`,
   * canonicalized to lowercase and deduped. Empty / undefined means the
   * model does not accept a reasoning effort parameter. New tiers reported
   * by the API (e.g. `minimal`) are surfaced without code changes.
   */
  reasoningEfforts?: ReasoningEffort[];
}

export interface GhcChatCompletionRequest {
  messages: Message[];
  model: string;
  max_tokens?: number;
  temperature?: number;
  tools?: OpenAiFunctionTool[];
  tool_choice?: 'none' | 'auto' | { type: 'function'; function: { name: string } };
  stream?: boolean;
  /** OpenAI-style reasoning effort (`/chat/completions` flat form) */
  reasoning_effort?: ReasoningEffort;
}

export interface GhcChatCompletionResponse {
  choices: Array<{
    message: Message;
    finish_reason: string;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAiFunctionDef {
  name: string;
  description: string;
  parameters?: object;
}

export interface OpenAiFunctionTool {
  function: OpenAiFunctionDef;
  type: 'function';
}

export enum ToolMode {
  Auto = 'auto',
  None = 'none',
  Required = 'required'
}

// Response API Types
export interface ResponseInputTextContent {
  type: 'input_text';
  text: string;
}

export interface ResponseInputImageContent {
  type: 'input_image';
  image_url?: string;
  file_id?: string;
  detail?: 'low' | 'high' | 'auto' | 'original';
}

export interface ResponseMessageItem {
  type: 'message';
  role: 'system' | 'user' | 'assistant' | 'developer';
  content: string | Array<ResponseInputTextContent | ResponseInputImageContent>;
  tool_calls?: any[];
}

export type ResponseInputItem =
  | ResponseInputTextContent
  | ResponseInputImageContent
  | ResponseMessageItem
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

export interface GhcResponsesRequest {
  model: string;
  input: ResponseInputItem[];
  max_output_tokens?: number;
  stream?: boolean;
  include?: string[];
  previous_response_id?: string;
  /** OpenAI Responses API nested form for reasoning effort */
  reasoning?: { effort: ReasoningEffort };
}

// Interface compatibility with existing ChatApi
export interface IChatApi {
  processConversationWithMCP(
    messages: Message[],
    callbacks?: StartChatCallbacks
  ): Promise<Message[]>;

  executeToolCall(toolCall: any): Promise<any>;
  saveConfig(config: any): void;
}
