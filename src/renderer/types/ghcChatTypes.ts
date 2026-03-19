// src/renderer/types/ghcChatTypes.ts
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
      parallel_tool_calls?: boolean;
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
}

export interface GhcChatCompletionRequest {
  messages: Message[];
  model: string;
  max_tokens?: number;
  temperature?: number;
  tools?: OpenAiFunctionTool[];
  tool_choice?: 'none' | 'auto' | { type: 'function'; function: { name: string } };
  stream?: boolean;
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

// Interface compatibility with existing ChatApi
export interface IChatApi {
  processConversationWithMCP(
    messages: Message[],
    callbacks?: StartChatCallbacks
  ): Promise<Message[]>;
  
  executeToolCall(toolCall: any): Promise<any>;
  saveConfig(config: any): void;
}