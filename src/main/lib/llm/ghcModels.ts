// src/main/lib/llm/ghcModels.ts
import { GhcCopilotModel, GhcModel } from '../types/ghcChatTypes';

// List of model IDs used in Kosmos
// Group order: Claude models / Gemini models / GPT models
// Within each group, sorted from newest to oldest, excluding mini and flash models
const KOSMOS_USED_MODEL_IDS = [
  // Claude models (newest to oldest)
  'claude-opus-4.6',
  'claude-opus-4.5',
  'claude-sonnet-4.6',
  'claude-sonnet-4.5',
  'claude-sonnet-4',

  // Gemini models (newest to oldest)
  'gemini-3.1-pro-preview',
  'gemini-3-pro-preview',
  'gemini-2.5-pro',

  // GPT models (newest to oldest)
  'gpt-5.3-codex',
  'gpt-5.2-codex',
  'gpt-5.2',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex',
  'gpt-5.1'
];

// Full GitHub Copilot model collection - synced from scripts/github-copilot-models.json
export const GITHUB_COPILOT_MODELS: GhcCopilotModel[] = [
  {
    billing: {
      is_premium: true,
      multiplier: 6,
      restricted_to: ["pro", "edu", "pro_plus", "business", "enterprise"]
    },
    capabilities: {
      family: "claude-opus-4.6-1m",
      limits: {
        max_context_window_tokens: 1000000,
        max_non_streaming_output_tokens: 16000,
        max_output_tokens: 64000,
        max_prompt_tokens: 936000,
        vision: {
          max_prompt_image_size: 3145728,
          max_prompt_images: 1,
          supported_media_types: ["image/jpeg", "image/png", "image/webp"]
        }
      },
      object: "model_capabilities",
      supports: {
        max_thinking_budget: 32000,
        min_thinking_budget: 1024,
        parallel_tool_calls: true,
        streaming: true,
        structured_outputs: true,
        tool_calls: true,
        vision: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "claude-opus-4.6-1m",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_category: "powerful",
    model_picker_enabled: true,
    name: "Claude Opus 4.6 (1M context)",
    object: "model",
    policy: {
      state: "enabled",
      terms: "Enable access to the latest Claude Opus 4.6 (1M context) model from Anthropic. [Learn more about how GitHub Copilot serves Claude Opus 4.6 (1M context)](https://gh.io/copilot-claude-opus)."
    },
    preview: false,
    supported_endpoints: ["/v1/messages", "/chat/completions"],
    vendor: "Anthropic",
    version: "claude-opus-4.6-1m"
  },
  {
    billing: {
      is_premium: true,
      multiplier: 30,
      restricted_to: ["pro_plus", "enterprise"]
    },
    capabilities: {
      family: "claude-opus-4.6-fast",
      limits: {
        max_context_window_tokens: 200000,
        max_non_streaming_output_tokens: 16000,
        max_output_tokens: 64000,
        max_prompt_tokens: 128000,
        vision: {
          max_prompt_image_size: 3145728,
          max_prompt_images: 1,
          supported_media_types: ["image/jpeg", "image/png", "image/webp"]
        }
      },
      object: "model_capabilities",
      supports: {
        max_thinking_budget: 32000,
        min_thinking_budget: 1024,
        parallel_tool_calls: true,
        streaming: true,
        structured_outputs: true,
        tool_calls: true,
        vision: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "claude-opus-4.6-fast",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_category: "powerful",
    model_picker_enabled: true,
    name: "Claude Opus 4.6 (fast mode)",
    object: "model",
    policy: {
      state: "enabled",
      terms: "Enable access to the latest Claude Opus 4.6 fast model from Anthropic. [Learn more about how GitHub Copilot serves Claude Opus 4.6 fast](https://gh.io/copilot-claude-opus)."
    },
    preview: true,
    supported_endpoints: ["/v1/messages", "/chat/completions"],
    vendor: "Anthropic",
    version: "claude-opus-4.6-fast"
  },
  {
    billing: {
      is_premium: true,
      multiplier: 3,
      restricted_to: ["pro", "edu", "pro_plus", "business", "enterprise"]
    },
    capabilities: {
      family: "claude-opus-4.6",
      limits: {
        max_context_window_tokens: 200000,
        max_non_streaming_output_tokens: 16000,
        max_output_tokens: 64000,
        max_prompt_tokens: 128000,
        vision: {
          max_prompt_image_size: 3145728,
          max_prompt_images: 1,
          supported_media_types: ["image/jpeg", "image/png", "image/webp"]
        }
      },
      object: "model_capabilities",
      supports: {
        max_thinking_budget: 32000,
        min_thinking_budget: 1024,
        parallel_tool_calls: true,
        streaming: true,
        structured_outputs: true,
        tool_calls: true,
        vision: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "claude-opus-4.6",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_category: "powerful",
    model_picker_enabled: true,
    name: "Claude Opus 4.6",
    object: "model",
    policy: {
      state: "enabled",
      terms: "Enable access to the latest Claude Opus 4.6 model from Anthropic. [Learn more about how GitHub Copilot serves Claude Opus 4.6](https://gh.io/copilot-claude-opus)."
    },
    preview: false,
    supported_endpoints: ["/v1/messages", "/chat/completions"],
    vendor: "Anthropic",
    version: "claude-opus-4.6"
  },
  {
    billing: {
      is_premium: true,
      multiplier: 1,
      restricted_to: ["pro", "pro_plus", "business", "enterprise"]
    },
    capabilities: {
      family: "claude-sonnet-4.6",
      limits: {
        max_context_window_tokens: 200000,
        max_non_streaming_output_tokens: 16000,
        max_output_tokens: 32000,
        max_prompt_tokens: 128000,
        vision: {
          max_prompt_image_size: 3145728,
          max_prompt_images: 5,
          supported_media_types: ["image/jpeg", "image/png", "image/webp"]
        }
      },
      object: "model_capabilities",
      supports: {
        max_thinking_budget: 32000,
        min_thinking_budget: 1024,
        parallel_tool_calls: true,
        streaming: true,
        structured_outputs: true,
        tool_calls: true,
        vision: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "claude-sonnet-4.6",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_category: "versatile",
    model_picker_enabled: true,
    name: "Claude Sonnet 4.6",
    object: "model",
    policy: {
      state: "enabled",
      terms: "Enable access to the latest Claude Sonnet 4.6 model from Anthropic. [Learn more about how GitHub Copilot serves Claude Sonnet 4.6](https://gh.io/copilot-claude-opus)."
    },
    preview: false,
    supported_endpoints: ["/chat/completions", "/v1/messages"],
    vendor: "Anthropic",
    version: "claude-sonnet-4.6"
  },
  {
    billing: {
      is_premium: true,
      multiplier: 1,
      restricted_to: ["pro", "pro_plus", "business", "enterprise"]
    },
    capabilities: {
      family: "gemini-3.1-pro-preview",
      limits: {
        max_context_window_tokens: 128000,
        max_output_tokens: 64000,
        max_prompt_tokens: 128000,
        vision: {
          max_prompt_image_size: 3145728,
          max_prompt_images: 10,
          supported_media_types: ["image/jpeg", "image/png", "image/webp"]
        }
      },
      object: "model_capabilities",
      supports: {
        max_thinking_budget: 32000,
        min_thinking_budget: 256,
        parallel_tool_calls: true,
        streaming: true,
        tool_calls: true,
        vision: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "gemini-3.1-pro-preview",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_category: "powerful",
    model_picker_enabled: true,
    name: "Gemini 3.1 Pro",
    object: "model",
    policy: {
      state: "enabled",
      terms: "Enable access to the latest Gemini 3 Pro model from Google. [Learn more about how GitHub Copilot serves Gemini 3 Pro](https://docs.github.com/en/copilot/reference/ai-models/model-hosting#google-models)."
    },
    preview: true,
    supported_endpoints: ["/chat/completions"],
    vendor: "Google",
    version: "gemini-3.1-pro-preview"
  },
  {
    billing: {
      is_premium: true,
      multiplier: 1,
      restricted_to: ["pro", "edu", "pro_plus", "business", "enterprise"]
    },
    capabilities: {
      family: "gpt-5.2-codex",
      limits: {
        max_context_window_tokens: 400000,
        max_output_tokens: 128000,
        max_prompt_tokens: 272000,
        vision: {
          max_prompt_image_size: 3145728,
          max_prompt_images: 1,
          supported_media_types: ["image/jpeg", "image/png", "image/webp", "image/gif"]
        }
      },
      object: "model_capabilities",
      supports: {
        parallel_tool_calls: true,
        streaming: true,
        structured_outputs: true,
        tool_calls: true,
        vision: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "gpt-5.2-codex",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_category: "powerful",
    model_picker_enabled: true,
    name: "GPT-5.2-Codex",
    object: "model",
    policy: {
      state: "enabled",
      terms: "Enable access to the latest GPT-5.2-Codex model from OpenAI. [Learn more about how GitHub Copilot serves GPT-5.2-Codex](https://gh.io/copilot-openai)."
    },
    preview: false,
    supported_endpoints: ["/responses"],
    vendor: "OpenAI",
    version: "gpt-5.2-codex"
  },
  {
    billing: {
      is_premium: true,
      multiplier: 1,
      restricted_to: ["pro", "edu", "pro_plus", "business", "enterprise"]
    },
    capabilities: {
      family: "gpt-5.3-codex",
      limits: {
        max_context_window_tokens: 400000,
        max_output_tokens: 128000,
        max_prompt_tokens: 272000,
        vision: {
          max_prompt_image_size: 3145728,
          max_prompt_images: 1,
          supported_media_types: ["image/jpeg", "image/png", "image/webp", "image/gif"]
        }
      },
      object: "model_capabilities",
      supports: {
        parallel_tool_calls: true,
        streaming: true,
        structured_outputs: true,
        tool_calls: true,
        vision: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "gpt-5.3-codex",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_category: "powerful",
    model_picker_enabled: true,
    name: "GPT-5.3-Codex",
    object: "model",
    policy: {
      state: "enabled",
      terms: "Enable access to the latest GPT-5.3-Codex model from OpenAI. [Learn more about how GitHub Copilot serves GPT-5.3-Codex](https://gh.io/copilot-openai)."
    },
    preview: false,
    supported_endpoints: ["/responses"],
    vendor: "OpenAI",
    version: "gpt-5.3-codex"
  },
  {
    billing: {
      is_premium: false,
      multiplier: 0
    },
    capabilities: {
      family: "gpt-5-mini",
      limits: {
        max_context_window_tokens: 264000,
        max_output_tokens: 64000,
        max_prompt_tokens: 128000,
        vision: {
          max_prompt_image_size: 3145728,
          max_prompt_images: 1,
          supported_media_types: ["image/jpeg", "image/png", "image/webp", "image/gif"]
        }
      },
      object: "model_capabilities",
      supports: {
        parallel_tool_calls: true,
        streaming: true,
        structured_outputs: true,
        tool_calls: true,
        vision: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "gpt-5-mini",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_category: "lightweight",
    model_picker_enabled: true,
    name: "GPT-5 mini",
    object: "model",
    policy: {
      state: "enabled",
      terms: "Enable access to the latest GPT-5 mini model from OpenAI. [Learn more about how GitHub Copilot serves GPT-5 mini](https://gh.io/copilot-openai)."
    },
    preview: false,
    supported_endpoints: ["/chat/completions", "/responses"],
    vendor: "Azure OpenAI",
    version: "gpt-5-mini"
  },
  {
    billing: {
      is_premium: false,
      multiplier: 0
    },
    capabilities: {
      family: "gpt-4o-mini",
      limits: {
        max_context_window_tokens: 128000,
        max_output_tokens: 4096,
        max_prompt_tokens: 12288
      },
      object: "model_capabilities",
      supports: {
        parallel_tool_calls: true,
        streaming: true,
        tool_calls: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "gpt-4o-mini-2024-07-18",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_enabled: false,
    name: "GPT-4o mini",
    object: "model",
    preview: false,
    vendor: "Azure OpenAI",
    version: "gpt-4o-mini-2024-07-18"
  },
  {
    billing: {
      is_premium: false,
      multiplier: 0
    },
    capabilities: {
      family: "gpt-4o",
      limits: {
        max_context_window_tokens: 128000,
        max_output_tokens: 16384,
        max_prompt_tokens: 64000,
        vision: {
          max_prompt_image_size: 3145728,
          max_prompt_images: 1,
          supported_media_types: ["image/jpeg", "image/png", "image/webp", "image/gif"]
        }
      },
      object: "model_capabilities",
      supports: {
        parallel_tool_calls: true,
        streaming: true,
        tool_calls: true,
        vision: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "gpt-4o-2024-11-20",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_enabled: false,
    name: "GPT-4o",
    object: "model",
    preview: false,
    vendor: "Azure OpenAI",
    version: "gpt-4o-2024-11-20"
  },
  {
    billing: {
      is_premium: false,
      multiplier: 0
    },
    capabilities: {
      family: "gpt-4o",
      limits: {
        max_context_window_tokens: 128000,
        max_output_tokens: 16384,
        max_prompt_tokens: 64000
      },
      object: "model_capabilities",
      supports: {
        parallel_tool_calls: true,
        streaming: true,
        tool_calls: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "gpt-4o-2024-08-06",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_enabled: false,
    name: "GPT-4o",
    object: "model",
    preview: false,
    vendor: "Azure OpenAI",
    version: "gpt-4o-2024-08-06"
  },
  {
    billing: {
      is_premium: true,
      multiplier: 1,
      restricted_to: ["pro", "pro_plus", "max", "business", "enterprise", "edu"]
    },
    capabilities: {
      family: "gpt-5.1",
      limits: {
        max_context_window_tokens: 264000,
        max_output_tokens: 64000,
        max_prompt_tokens: 128000,
        vision: {
          max_prompt_image_size: 3145728,
          max_prompt_images: 1,
          supported_media_types: ["image/jpeg", "image/png", "image/webp", "image/gif"]
        }
      },
      object: "model_capabilities",
      supports: {
        parallel_tool_calls: true,
        streaming: true,
        structured_outputs: true,
        tool_calls: true,
        vision: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "gpt-5.1",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_category: "versatile",
    model_picker_enabled: true,
    name: "GPT-5.1",
    object: "model",
    policy: {
      state: "enabled",
      terms: "Enable access to the latest GPT-5.1 model from OpenAI. [Learn more about how GitHub Copilot serves GPT-5.1](https://gh.io/copilot-openai)."
    },
    preview: false,
    supported_endpoints: ["/chat/completions", "/responses"],
    vendor: "OpenAI",
    version: "gpt-5.1"
  },
  {
    billing: {
      is_premium: true,
      multiplier: 1,
      restricted_to: ["pro", "pro_plus", "max", "business", "enterprise", "edu"]
    },
    capabilities: {
      family: "gpt-5.1-codex",
      limits: {
        max_context_window_tokens: 400000,
        max_output_tokens: 128000,
        max_prompt_tokens: 128000,
        vision: {
          max_prompt_image_size: 3145728,
          max_prompt_images: 1,
          supported_media_types: ["image/jpeg", "image/png", "image/webp", "image/gif"]
        }
      },
      object: "model_capabilities",
      supports: {
        parallel_tool_calls: true,
        streaming: true,
        structured_outputs: true,
        tool_calls: true,
        vision: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "gpt-5.1-codex",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_category: "powerful",
    model_picker_enabled: true,
    name: "GPT-5.1-Codex",
    object: "model",
    policy: {
      state: "enabled",
      terms: "Enable access to the latest GPT-5.1-Codex model from OpenAI. [Learn more about how GitHub Copilot serves GPT-5.1-Codex](https://gh.io/copilot-openai)."
    },
    preview: false,
    supported_endpoints: ["/responses"],
    vendor: "OpenAI",
    version: "gpt-5.1-codex"
  },
  {
    billing: {
      is_premium: true,
      multiplier: 0.33,
      restricted_to: ["pro", "pro_plus", "max", "business", "enterprise", "edu"]
    },
    capabilities: {
      family: "gpt-5.1-codex-mini",
      limits: {
        max_context_window_tokens: 400000,
        max_output_tokens: 128000,
        max_prompt_tokens: 128000,
        vision: {
          max_prompt_image_size: 3145728,
          max_prompt_images: 1,
          supported_media_types: ["image/jpeg", "image/png", "image/webp", "image/gif"]
        }
      },
      object: "model_capabilities",
      supports: {
        parallel_tool_calls: true,
        streaming: true,
        structured_outputs: true,
        tool_calls: true,
        vision: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "gpt-5.1-codex-mini",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_category: "powerful",
    model_picker_enabled: true,
    name: "GPT-5.1-Codex-Mini",
    object: "model",
    policy: {
      state: "enabled",
      terms: "Enable access to the latest GPT-5.1-Codex-Mini model from OpenAI. [Learn more about how GitHub Copilot serves GPT-5.1-Codex-Mini](https://gh.io/copilot-openai)."
    },
    preview: true,
    supported_endpoints: ["/responses"],
    vendor: "OpenAI",
    version: "gpt-5.1-codex-mini"
  },
  {
    billing: {
      is_premium: true,
      multiplier: 1,
      restricted_to: ["pro", "pro_plus", "max", "business", "enterprise", "edu"]
    },
    capabilities: {
      family: "gpt-5.1-codex-max",
      limits: {
        max_context_window_tokens: 400000,
        max_output_tokens: 128000,
        max_prompt_tokens: 128000,
        vision: {
          max_prompt_image_size: 3145728,
          max_prompt_images: 1,
          supported_media_types: ["image/jpeg", "image/png", "image/webp", "image/gif"]
        }
      },
      object: "model_capabilities",
      supports: {
        parallel_tool_calls: true,
        streaming: true,
        structured_outputs: true,
        tool_calls: true,
        vision: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "gpt-5.1-codex-max",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_category: "powerful",
    model_picker_enabled: true,
    name: "GPT-5.1-Codex-Max",
    object: "model",
    policy: {
      state: "enabled",
      terms: "Enable access to the latest GPT-5.1-Codex-Max model from OpenAI. [Learn more about how GitHub Copilot serves GPT-5.1-Codex-Max](https://gh.io/copilot-openai)."
    },
    preview: false,
    supported_endpoints: ["/responses"],
    vendor: "OpenAI",
    version: "gpt-5.1-codex-max"
  },
  {
    billing: {
      is_premium: false,
      multiplier: 0
    },
    capabilities: {
      family: "text-embedding-3-small",
      limits: {
        max_inputs: 512
      },
      object: "model_capabilities",
      supports: {
        dimensions: true
      },
      tokenizer: "cl100k_base",
      type: "embeddings"
    },
    id: "text-embedding-3-small",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_enabled: false,
    name: "Embedding V3 small",
    object: "model",
    preview: false,
    vendor: "Azure OpenAI",
    version: "text-embedding-3-small"
  },
  {
    billing: {
      is_premium: false,
      multiplier: 0
    },
    capabilities: {
      family: "text-embedding-3-small",
      object: "model_capabilities",
      supports: {
        dimensions: true
      },
      tokenizer: "cl100k_base",
      type: "embeddings"
    },
    id: "text-embedding-3-small-inference",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_enabled: false,
    name: "Embedding V3 small (Inference)",
    object: "model",
    preview: false,
    vendor: "Azure OpenAI",
    version: "text-embedding-3-small"
  },
  {
    billing: {
      is_premium: true,
      multiplier: 1,
      restricted_to: ["pro", "pro_plus", "max", "business", "enterprise", "edu"]
    },
    capabilities: {
      family: "claude-sonnet-4",
      limits: {
        max_context_window_tokens: 216000,
        max_output_tokens: 16000,
        max_prompt_tokens: 128000,
        vision: {
          max_prompt_image_size: 3145728,
          max_prompt_images: 5,
          supported_media_types: ["image/jpeg", "image/png", "image/webp"]
        }
      },
      object: "model_capabilities",
      supports: {
        max_thinking_budget: 32000,
        min_thinking_budget: 1024,
        parallel_tool_calls: true,
        streaming: true,
        tool_calls: true,
        vision: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "claude-sonnet-4",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_category: "versatile",
    model_picker_enabled: true,
    name: "Claude Sonnet 4",
    object: "model",
    policy: {
      state: "enabled",
      terms: "Enable access to the latest Claude Sonnet 4 model from Anthropic. [Learn more about how GitHub Copilot serves Claude Sonnet 4](https://docs.github.com/en/copilot/using-github-copilot/ai-models/using-claude-sonnet-in-github-copilot)."
    },
    preview: false,
    supported_endpoints: ["/chat/completions", "/v1/messages"],
    vendor: "Anthropic",
    version: "claude-sonnet-4"
  },
  {
    billing: {
      is_premium: true,
      multiplier: 1,
      restricted_to: ["pro", "pro_plus", "max", "business", "enterprise", "edu"]
    },
    capabilities: {
      family: "claude-sonnet-4.5",
      limits: {
        max_context_window_tokens: 200000,
        max_non_streaming_output_tokens: 16000,
        max_output_tokens: 32000,
        max_prompt_tokens: 128000,
        vision: {
          max_prompt_image_size: 3145728,
          max_prompt_images: 5,
          supported_media_types: ["image/jpeg", "image/png", "image/webp"]
        }
      },
      object: "model_capabilities",
      supports: {
        max_thinking_budget: 32000,
        min_thinking_budget: 1024,
        parallel_tool_calls: true,
        streaming: true,
        tool_calls: true,
        vision: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "claude-sonnet-4.5",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_category: "versatile",
    model_picker_enabled: true,
    name: "Claude Sonnet 4.5",
    object: "model",
    policy: {
      state: "enabled",
      terms: "Enable access to the latest Claude Sonnet 4.5 model from Anthropic. [Learn more about how GitHub Copilot serves Claude Sonnet 4.5](https://docs.github.com/en/copilot/using-github-copilot/ai-models/using-claude-sonnet-in-github-copilot)."
    },
    preview: false,
    supported_endpoints: ["/chat/completions", "/v1/messages"],
    vendor: "Anthropic",
    version: "claude-sonnet-4.5"
  },
  {
    billing: {
      is_premium: true,
      multiplier: 3,
      restricted_to: ["pro", "pro_plus", "max", "business", "enterprise", "edu"]
    },
    capabilities: {
      family: "claude-opus-4.5",
      limits: {
        max_context_window_tokens: 200000,
        max_non_streaming_output_tokens: 16000,
        max_output_tokens: 32000,
        max_prompt_tokens: 128000,
        vision: {
          max_prompt_image_size: 3145728,
          max_prompt_images: 5,
          supported_media_types: ["image/jpeg", "image/png", "image/webp"]
        }
      },
      object: "model_capabilities",
      supports: {
        max_thinking_budget: 32000,
        min_thinking_budget: 1024,
        parallel_tool_calls: true,
        streaming: true,
        tool_calls: true,
        vision: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "claude-opus-4.5",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_category: "powerful",
    model_picker_enabled: true,
    name: "Claude Opus 4.5",
    object: "model",
    policy: {
      state: "enabled",
      terms: "Enable access to the latest Claude Opus 4.5 model from Anthropic. [Learn more about how GitHub Copilot serves Claude Opus 4.5](https://gh.io/copilot-anthropic)."
    },
    preview: false,
    supported_endpoints: ["/chat/completions", "/v1/messages"],
    vendor: "Anthropic",
    version: "claude-opus-4.5"
  },
  {
    billing: {
      is_premium: true,
      multiplier: 0.33
    },
    capabilities: {
      family: "claude-haiku-4.5",
      limits: {
        max_context_window_tokens: 200000,
        max_non_streaming_output_tokens: 16000,
        max_output_tokens: 32000,
        max_prompt_tokens: 128000,
        vision: {
          max_prompt_image_size: 3145728,
          max_prompt_images: 5,
          supported_media_types: ["image/jpeg", "image/png", "image/webp"]
        }
      },
      object: "model_capabilities",
      supports: {
        max_thinking_budget: 32000,
        min_thinking_budget: 1024,
        parallel_tool_calls: true,
        streaming: true,
        tool_calls: true,
        vision: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "claude-haiku-4.5",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_category: "versatile",
    model_picker_enabled: true,
    name: "Claude Haiku 4.5",
    object: "model",
    policy: {
      state: "enabled",
      terms: "Enable access to the latest Claude Haiku 4.5 model from Anthropic. [Learn more about how GitHub Copilot serves Claude Haiku 4.5](https://gh.io/copilot-anthropic)."
    },
    preview: false,
    supported_endpoints: ["/chat/completions", "/v1/messages"],
    vendor: "Anthropic",
    version: "claude-haiku-4.5"
  },
  {
    billing: {
      is_premium: true,
      multiplier: 1,
      restricted_to: ["pro", "pro_plus", "max", "business", "enterprise", "edu"]
    },
    capabilities: {
      family: "gemini-3-pro",
      limits: {
        max_context_window_tokens: 128000,
        max_output_tokens: 64000,
        max_prompt_tokens: 128000,
        vision: {
          max_prompt_image_size: 3145728,
          max_prompt_images: 10,
          supported_media_types: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]
        }
      },
      object: "model_capabilities",
      supports: {
        max_thinking_budget: 32000,
        min_thinking_budget: 256,
        parallel_tool_calls: true,
        streaming: true,
        tool_calls: true,
        vision: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "gemini-3-pro-preview",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_category: "powerful",
    model_picker_enabled: true,
    name: "Gemini 3 Pro (Preview)",
    object: "model",
    policy: {
      state: "enabled",
      terms: "Enable access to the latest Gemini 3 Pro model from Google. [Learn more about how GitHub Copilot serves Gemini 3 Pro](https://docs.github.com/en/copilot/reference/ai-models/model-hosting#google-models)."
    },
    preview: true,
    vendor: "Google",
    version: "gemini-3-pro-preview"
  },
  {
    billing: {
      is_premium: true,
      multiplier: 0.33,
      restricted_to: ["pro", "pro_plus", "max", "business", "enterprise", "edu"]
    },
    capabilities: {
      family: "gemini-3-flash",
      limits: {
        max_context_window_tokens: 128000,
        max_output_tokens: 64000,
        max_prompt_tokens: 128000,
        vision: {
          max_prompt_image_size: 3145728,
          max_prompt_images: 10,
          supported_media_types: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]
        }
      },
      object: "model_capabilities",
      supports: {
        max_thinking_budget: 32000,
        min_thinking_budget: 256,
        parallel_tool_calls: true,
        streaming: true,
        tool_calls: true,
        vision: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "gemini-3-flash-preview",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_category: "lightweight",
    model_picker_enabled: true,
    name: "Gemini 3 Flash (Preview)",
    object: "model",
    policy: {
      state: "enabled",
      terms: "Enable access to the latest Gemini 3 Flash model from Google. [Learn more about how GitHub Copilot serves Gemini 3 Flash](https://docs.github.com/en/copilot/reference/ai-models/model-hosting#google-models)"
    },
    preview: true,
    vendor: "Google",
    version: "gemini-3-flash-preview"
  },
  {
    billing: {
      is_premium: true,
      multiplier: 1,
      restricted_to: ["pro", "pro_plus", "max", "business", "enterprise", "edu"]
    },
    capabilities: {
      family: "gemini-2.5-pro",
      limits: {
        max_context_window_tokens: 128000,
        max_output_tokens: 64000,
        max_prompt_tokens: 128000,
        vision: {
          max_prompt_image_size: 3145728,
          max_prompt_images: 10,
          supported_media_types: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]
        }
      },
      object: "model_capabilities",
      supports: {
        max_thinking_budget: 32768,
        min_thinking_budget: 128,
        parallel_tool_calls: true,
        streaming: true,
        tool_calls: true,
        vision: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "gemini-2.5-pro",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_category: "powerful",
    model_picker_enabled: true,
    name: "Gemini 2.5 Pro",
    object: "model",
    policy: {
      state: "enabled",
      terms: "Enable access to the latest Gemini 2.5 Pro model from Google. [Learn more about how GitHub Copilot serves Gemini 2.5 Pro](https://docs.github.com/en/copilot/using-github-copilot/ai-models/choosing-the-right-ai-model-for-your-task#gemini-25-pro)."
    },
    preview: false,
    vendor: "Google",
    version: "gemini-2.5-pro"
  },
  {
    billing: {
      is_premium: false,
      multiplier: 0
    },
    capabilities: {
      family: "gpt-4.1",
      limits: {
        max_context_window_tokens: 128000,
        max_output_tokens: 16384,
        max_prompt_tokens: 128000,
        vision: {
          max_prompt_image_size: 3145728,
          max_prompt_images: 1,
          supported_media_types: ["image/jpeg", "image/png", "image/webp", "image/gif"]
        }
      },
      object: "model_capabilities",
      supports: {
        parallel_tool_calls: true,
        streaming: true,
        structured_outputs: true,
        tool_calls: true,
        vision: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "gpt-4.1-2025-04-14",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_enabled: false,
    name: "GPT-4.1",
    object: "model",
    policy: {
      state: "enabled",
      terms: "Enable access to the latest GPT-4.1 model from OpenAI. [Learn more about how GitHub Copilot serves GPT-4.1](https://docs.github.com/en/copilot/using-github-copilot/ai-models/choosing-the-right-ai-model-for-your-task#gpt-41)."
    },
    preview: false,
    vendor: "Azure OpenAI",
    version: "gpt-4.1-2025-04-14"
  },
  {
    billing: {
      is_premium: true,
      multiplier: 1,
      restricted_to: ["pro", "pro_plus", "max", "business", "enterprise", "edu"]
    },
    capabilities: {
      family: "gpt-5.2",
      limits: {
        max_context_window_tokens: 264000,
        max_output_tokens: 64000,
        max_prompt_tokens: 128000,
        vision: {
          max_prompt_image_size: 3145728,
          max_prompt_images: 1,
          supported_media_types: ["image/jpeg", "image/png", "image/webp", "image/gif"]
        }
      },
      object: "model_capabilities",
      supports: {
        parallel_tool_calls: true,
        streaming: true,
        structured_outputs: true,
        tool_calls: true,
        vision: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "gpt-5.2",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_category: "versatile",
    model_picker_enabled: true,
    name: "GPT-5.2",
    object: "model",
    policy: {
      state: "enabled",
      terms: "Enable access to the latest GPT-5.2 model from OpenAI. [Learn more about how GitHub Copilot serves GPT-5.2](https://gh.io/copilot-openai)."
    },
    preview: false,
    supported_endpoints: ["/chat/completions", "/responses"],
    vendor: "OpenAI",
    version: "gpt-5.2"
  },
  {
    billing: {
      is_premium: false,
      multiplier: 0
    },
    capabilities: {
      family: "gpt-4.1",
      object: "model_capabilities",
      supports: {
        streaming: true
      },
      tokenizer: "o200k_base",
      type: "completion"
    },
    id: "gpt-41-copilot",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_category: "versatile",
    model_picker_enabled: true,
    name: "GPT-4.1 Copilot",
    object: "model",
    preview: false,
    vendor: "Azure OpenAI",
    version: "gpt-41-copilot"
  },
  {
    billing: {
      is_premium: false,
      multiplier: 0
    },
    capabilities: {
      family: "gpt-3.5-turbo",
      limits: {
        max_context_window_tokens: 16384,
        max_output_tokens: 4096,
        max_prompt_tokens: 12288
      },
      object: "model_capabilities",
      supports: {
        streaming: true,
        tool_calls: true
      },
      tokenizer: "cl100k_base",
      type: "chat"
    },
    id: "gpt-3.5-turbo-0613",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_enabled: false,
    name: "GPT 3.5 Turbo",
    object: "model",
    preview: false,
    vendor: "Azure OpenAI",
    version: "gpt-3.5-turbo-0613"
  },
  {
    billing: {
      is_premium: false,
      multiplier: 0
    },
    capabilities: {
      family: "gpt-4",
      limits: {
        max_context_window_tokens: 32768,
        max_output_tokens: 4096,
        max_prompt_tokens: 32768
      },
      object: "model_capabilities",
      supports: {
        streaming: true,
        tool_calls: true
      },
      tokenizer: "cl100k_base",
      type: "chat"
    },
    id: "gpt-4",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_enabled: false,
    name: "GPT 4",
    object: "model",
    preview: false,
    vendor: "Azure OpenAI",
    version: "gpt-4-0613"
  },
  {
    billing: {
      is_premium: false,
      multiplier: 0
    },
    capabilities: {
      family: "gpt-4",
      limits: {
        max_context_window_tokens: 32768,
        max_output_tokens: 4096,
        max_prompt_tokens: 32768
      },
      object: "model_capabilities",
      supports: {
        streaming: true,
        tool_calls: true
      },
      tokenizer: "cl100k_base",
      type: "chat"
    },
    id: "gpt-4-0613",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_enabled: false,
    name: "GPT 4",
    object: "model",
    preview: false,
    vendor: "Azure OpenAI",
    version: "gpt-4-0613"
  },
  {
    billing: {
      is_premium: false,
      multiplier: 0
    },
    capabilities: {
      family: "gpt-4-turbo",
      limits: {
        max_context_window_tokens: 128000,
        max_output_tokens: 4096,
        max_prompt_tokens: 64000
      },
      object: "model_capabilities",
      supports: {
        parallel_tool_calls: true,
        streaming: true,
        tool_calls: true
      },
      tokenizer: "cl100k_base",
      type: "chat"
    },
    id: "gpt-4-0125-preview",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_enabled: false,
    name: "GPT 4 Turbo",
    object: "model",
    preview: false,
    vendor: "Azure OpenAI",
    version: "gpt-4-0125-preview"
  },
  {
    billing: {
      is_premium: false,
      multiplier: 0
    },
    capabilities: {
      family: "gpt-4o",
      limits: {
        max_context_window_tokens: 128000,
        max_output_tokens: 4096,
        max_prompt_tokens: 64000,
        vision: {
          max_prompt_image_size: 3145728,
          max_prompt_images: 1,
          supported_media_types: ["image/jpeg", "image/png", "image/webp", "image/gif"]
        }
      },
      object: "model_capabilities",
      supports: {
        parallel_tool_calls: true,
        streaming: true,
        tool_calls: true,
        vision: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "gpt-4o-2024-05-13",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_enabled: false,
    name: "GPT-4o",
    object: "model",
    preview: false,
    vendor: "Azure OpenAI",
    version: "gpt-4o-2024-05-13"
  },
  {
    billing: {
      is_premium: false,
      multiplier: 0
    },
    capabilities: {
      family: "gpt-4o",
      limits: {
        max_context_window_tokens: 128000,
        max_output_tokens: 4096,
        max_prompt_tokens: 64000
      },
      object: "model_capabilities",
      supports: {
        parallel_tool_calls: true,
        streaming: true,
        tool_calls: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "gpt-4-o-preview",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_enabled: false,
    name: "GPT-4o",
    object: "model",
    preview: false,
    vendor: "Azure OpenAI",
    version: "gpt-4o-2024-05-13"
  },
  {
    billing: {
      is_premium: false,
      multiplier: 0
    },
    capabilities: {
      family: "gpt-4.1",
      limits: {
        max_context_window_tokens: 128000,
        max_output_tokens: 16384,
        max_prompt_tokens: 128000,
        vision: {
          max_prompt_image_size: 3145728,
          max_prompt_images: 1,
          supported_media_types: ["image/jpeg", "image/png", "image/webp", "image/gif"]
        }
      },
      object: "model_capabilities",
      supports: {
        parallel_tool_calls: true,
        streaming: true,
        structured_outputs: true,
        tool_calls: true,
        vision: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "gpt-4.1",
    is_chat_default: true,
    is_chat_fallback: true,
    model_picker_category: "versatile",
    model_picker_enabled: true,
    name: "GPT-4.1",
    object: "model",
    policy: {
      state: "enabled",
      terms: "Enable access to the latest GPT-4.1 model from OpenAI. [Learn more about how GitHub Copilot serves GPT-4.1](https://docs.github.com/en/copilot/using-github-copilot/ai-models/choosing-the-right-ai-model-for-your-task#gpt-41)."
    },
    preview: false,
    vendor: "Azure OpenAI",
    version: "gpt-4.1-2025-04-14"
  },
  {
    billing: {
      is_premium: false,
      multiplier: 0,
      restricted_to: ["pro", "pro_plus", "max", "business", "enterprise", "edu"]
    },
    capabilities: {
      family: "gpt-3.5-turbo",
      limits: {
        max_context_window_tokens: 16384,
        max_output_tokens: 4096,
        max_prompt_tokens: 12288
      },
      object: "model_capabilities",
      supports: {
        streaming: true,
        tool_calls: true
      },
      tokenizer: "cl100k_base",
      type: "chat"
    },
    id: "gpt-3.5-turbo",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_enabled: false,
    name: "GPT 3.5 Turbo",
    object: "model",
    preview: false,
    vendor: "Azure OpenAI",
    version: "gpt-3.5-turbo-0613"
  },
  {
    billing: {
      is_premium: false,
      multiplier: 0
    },
    capabilities: {
      family: "gpt-4o-mini",
      limits: {
        max_context_window_tokens: 128000,
        max_output_tokens: 4096,
        max_prompt_tokens: 12288
      },
      object: "model_capabilities",
      supports: {
        parallel_tool_calls: true,
        streaming: true,
        tool_calls: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "gpt-4o-mini",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_enabled: false,
    name: "GPT-4o mini",
    object: "model",
    preview: false,
    vendor: "Azure OpenAI",
    version: "gpt-4o-mini-2024-07-18"
  },
  {
    billing: {
      is_premium: false,
      multiplier: 0
    },
    capabilities: {
      family: "gpt-4",
      limits: {
        max_context_window_tokens: 32768,
        max_output_tokens: 4096,
        max_prompt_tokens: 32768
      },
      object: "model_capabilities",
      supports: {
        streaming: true,
        tool_calls: true
      },
      tokenizer: "cl100k_base",
      type: "chat"
    },
    id: "gpt-4",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_enabled: false,
    name: "GPT 4",
    object: "model",
    preview: false,
    vendor: "Azure OpenAI",
    version: "gpt-4-0613"
  },
  {
    billing: {
      is_premium: false,
      multiplier: 0
    },
    capabilities: {
      family: "gpt-4o",
      limits: {
        max_context_window_tokens: 128000,
        max_output_tokens: 4096,
        max_prompt_tokens: 64000,
        vision: {
          max_prompt_image_size: 3145728,
          max_prompt_images: 1,
          supported_media_types: ["image/jpeg", "image/png", "image/webp", "image/gif"]
        }
      },
      object: "model_capabilities",
      supports: {
        parallel_tool_calls: true,
        streaming: true,
        tool_calls: true,
        vision: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "gpt-4o",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_category: "versatile",
    model_picker_enabled: true,
    name: "GPT-4o",
    object: "model",
    preview: false,
    vendor: "Azure OpenAI",
    version: "gpt-4o-2024-11-20"
  },
  {
    billing: {
      is_premium: false,
      multiplier: 0
    },
    capabilities: {
      family: "gpt-4o",
      limits: {
        max_context_window_tokens: 128000,
        max_output_tokens: 4096,
        max_prompt_tokens: 64000
      },
      object: "model_capabilities",
      supports: {
        parallel_tool_calls: true,
        streaming: true,
        tool_calls: true
      },
      tokenizer: "o200k_base",
      type: "chat"
    },
    id: "gpt-4-o-preview",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_enabled: false,
    name: "GPT-4o",
    object: "model",
    preview: false,
    vendor: "Azure OpenAI",
    version: "gpt-4o-2024-05-13"
  },
  {
    billing: {
      is_premium: false,
      multiplier: 0
    },
    capabilities: {
      family: "text-embedding-ada-002",
      limits: {
        max_inputs: 512
      },
      object: "model_capabilities",
      supports: {
      },
      tokenizer: "cl100k_base",
      type: "embeddings"
    },
    id: "text-embedding-ada-002",
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_enabled: false,
    name: "Embedding V2 Ada",
    object: "model",
    preview: false,
    vendor: "Azure OpenAI",
    version: "text-embedding-3-small"
  }
];

// Get the list of models used by Kosmos from the full collection
// Returns models in the order defined by KOSMOS_USED_MODEL_IDS
export function getAllKosmosUsedModels(): GhcCopilotModel[] {
  return KOSMOS_USED_MODEL_IDS
    .map(id => GITHUB_COPILOT_MODELS.find(model => model.id === id))
    .filter((model): model is GhcCopilotModel => model !== undefined);
}

// Model categories for UI organization (updated for GhcCopilotModel)
export const MODEL_CATEGORIES = {
  claude: ['claude-sonnet-4', 'claude-sonnet-4.5', 'claude-sonnet-4.6', 'claude-haiku-4.5', 'claude-opus-4.5', 'claude-opus-4.6', 'claude-opus-41'],
  gpt: ['gpt-4.1', 'gpt-5', 'gpt-4o', 'gpt-5.2', 'gpt-5.1-codex-max', 'gpt-5.2-codex', 'gpt-5.3-codex', 'gpt-5.1-codex-mini'],
  gemini: ['gemini-2.5-pro', 'gemini-3-pro-preview', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview'],
  reasoning: ['o3-mini', 'o3', 'o4-mini']
};

// Helper functions for GhcCopilotModel
export function getModelById(modelId: string): GhcCopilotModel | undefined {
  return GITHUB_COPILOT_MODELS.find(model => model.id === modelId);
}

export function getModelsByCategory(category: keyof typeof MODEL_CATEGORIES): GhcCopilotModel[] {
  const modelIds = MODEL_CATEGORIES[category];
  return modelIds.map(id => getModelById(id)).filter(Boolean) as GhcCopilotModel[];
}

export function getAllModels(): GhcCopilotModel[] {
  return GITHUB_COPILOT_MODELS;
}

export function getModelCapabilities(modelId: string) {
  const model = getModelById(modelId);
  if (!model) return null;

  return {
    supportsStreaming: model.capabilities.supports.streaming || false,
    supportsTools: model.capabilities.supports.tool_calls || false,
    supportsImages: model.capabilities.supports.vision || false,
    supportsAudio: false, // Not available in GitHub Copilot models
    supportsVideo: false, // Not available in GitHub Copilot models
    supportsReasoning: model.capabilities.family.includes('o3') || model.capabilities.family.includes('o4'),
    maxContextLength: model.capabilities.limits?.max_context_window_tokens || 0,
    maxOutputLength: model.capabilities.limits?.max_output_tokens || 0,
    supportsTemperature: !model.capabilities.family.includes('o3') && !model.capabilities.family.includes('o4'), // Reasoning models don't support temperature
    supportsAttachments: model.capabilities.supports.vision || false
  };
}

export function isReasoningModel(modelId: string): boolean {
  const model = getModelById(modelId);
  return model ? (model.capabilities.family.includes('o3') || model.capabilities.family.includes('o4')) : false;
}

export function getDefaultModel(): string {
  return 'claude-sonnet-4.6';
}

export function validateModelId(modelId: string): boolean {
  return GITHUB_COPILOT_MODELS.some(model => model.id === modelId);
}

// Backward compatibility functions for GhcModel (deprecated - will be removed)
export function getLegacyModels(): GhcModel[] {
  // Convert GhcCopilotModel to GhcModel format for backward compatibility
  return getAllKosmosUsedModels().map(convertToLegacyModel);
}

function convertToLegacyModel(copilotModel: GhcCopilotModel): GhcModel {
  return {
    id: copilotModel.id,
    name: copilotModel.name,
    attachment: copilotModel.capabilities.supports.vision || false,
    reasoning: copilotModel.capabilities.family.includes('o3') || copilotModel.capabilities.family.includes('o4'),
    temperature: !copilotModel.capabilities.family.includes('o3') && !copilotModel.capabilities.family.includes('o4'),
    tool_call: copilotModel.capabilities.supports.tool_calls || false,
    knowledge: '2024-04', // Default value since not available in GhcCopilotModel
    release_date: '2025-01-01', // Default value
    last_updated: '2025-01-01', // Default value
    modalities: {
      input: copilotModel.capabilities.supports.vision ? ['text', 'image'] : ['text'],
      output: ['text']
    },
    open_weights: false, // All GitHub Copilot models are closed
    limit: {
      context: copilotModel.capabilities.limits?.max_context_window_tokens || 0,
      output: copilotModel.capabilities.limits?.max_output_tokens || 0
    }
  };
}
