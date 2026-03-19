// Base LLM API Settings for custom configuration
export interface LLMApiCustomSettings {
  apiKey: string;
  endpoint: string;
  apiVersion: string;
  deploymentName: string;
}

// Preset model definition
export interface PresetModel {
  id: string;
  name: string;
  deploymentName: string;
  endpoint: string;
  apiKey: string;
  apiVersion: string;
}

// New unified LLM API Settings structure
export interface LLMApiSettings {
  type: 'custom' | 'preset';
  customSettings: LLMApiCustomSettings;
  modelName: string;
}

// Legacy types for backward compatibility
export type ModelSelectionType = 'custom' | 'preset';

export interface ModelSelection {
  type: ModelSelectionType;
  presetModelId?: string; // Used when type is 'preset'
  customSettings?: LLMApiCustomSettings; // Used when type is 'custom'
}

// Legacy types - kept for backward compatibility during transition
export interface LegacyLLMApiSettings {
  apiKey: string;
  endpoint: string;
  apiVersion: string;
  deploymentName: string;
}

export interface PresetLLMApiSettings {
  type: 'preset';
  modelName: string;
}

export type LLMApiSettingsUnion = LegacyLLMApiSettings | PresetLLMApiSettings;

export interface MCPServer {
  name: string;
  transport: 'stdio' | 'sse' | 'StreamableHttp';
  in_use: boolean;
  url: string;
  command: string;
  args: string[];
  /** Environment variables required for server execution */
  env?: { [key: string]: string };
}

export interface UserProfile {
  alias: string;
  createdAt: string;
  updatedAt: string;
  llm_api_settings: LLMApiSettings;
  mcp_servers: MCPServer[];
}

export interface ProfileApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface LLMApiSettingsUpdate {
  type?: 'custom' | 'preset';
  customSettings?: Partial<LLMApiCustomSettings>;
  modelName?: string;
}

export interface MCPServerUpdate {
  name?: string;
  transport?: 'stdio' | 'sse' | 'StreamableHttp';
  in_use?: boolean;
  url?: string;
  command?: string;
  args?: string[];
  env?: { [key: string]: string };
}

export interface MCPServerCreate {
  name: string;
  transport: 'stdio' | 'sse' | 'StreamableHttp';
  in_use: boolean;
  url: string;
  command: string;
  args: string[];
  env?: { [key: string]: string };
}

// New GHC Profile Template Types
export interface GHCUser {
  id: string;
  login: string;
  email: string;
  name: string;
  avatarUrl: string;
  copilotPlan: string;
}

export interface GHCTokens {
  refresh: string;
  access: string;
  expires: number;
}

export interface GHCAuth {
  user: GHCUser;
  tokens: GHCTokens;
  capabilities: string[];
  selectedModel: string;
}

export interface MockAuthSection {
  alias: string;
  llm_api_settings: LLMApiSettings;
  modelName: string;
}

// New GHC Profile structure based on template
export interface GHCProfile {
  version: string;
  createdAt: string;
  updatedAt: string;
  authProvider: 'ghc' | 'mock';
  mockAuth: MockAuthSection;
  ghcAuth?: GHCAuth;
  mcp_servers: MCPServer[];
}

// Legacy profile structure for backward compatibility
export interface LegacyUserProfile {
  alias: string;
  createdAt: string;
  updatedAt: string;
  llm_api_settings: LLMApiSettings;
  mcp_servers: MCPServer[];
}

// Union type for profile data that could be either format
export type ProfileData = GHCProfile | LegacyUserProfile;

// Type guard functions
export function isGHCProfile(profile: any): profile is GHCProfile {
  return profile &&
         typeof profile.version === 'string' &&
         typeof profile.authProvider === 'string' &&
         profile.mockAuth !== undefined;
}

export function isLegacyProfile(profile: any): profile is LegacyUserProfile {
  return profile &&
         typeof profile.alias === 'string' &&
         profile.llm_api_settings !== undefined &&
         profile.mockAuth === undefined &&
         profile.authProvider === undefined;
}

// Voice Input Settings Types

/**
 * Whisper model size options
 */
export type WhisperModelSize = 'tiny' | 'base' | 'small' | 'medium' | 'turbo';

/**
 * Whisper model information
 */
export interface WhisperModelInfo {
  /** Model size identifier */
  size: WhisperModelSize;
  /** Model file name */
  fileName: string;
  /** Model file size in bytes */
  fileSize: number;
  /** Human-readable file size */
  fileSizeDisplay: string;
  /** Download URL */
  downloadUrl: string;
  /** Description */
  description: string;
}

/**
 * Voice Input Settings configuration
 */
export interface VoiceInputSettings {
  /** Whisper model size to use for voice input */
  whisperModel: WhisperModelSize;
  /** Language for speech recognition: 'auto' for auto-detect or specific language code */
  language: string;
  /** Enable GPU acceleration (Vulkan on Windows/Linux, Metal on macOS) */
  useGPU?: boolean;
  /** Enable translation to English (only available for 'small', 'medium', and 'turbo' models) */
  translate?: boolean;
}

/**
 * Default Voice Input Settings
 */
export const DEFAULT_VOICE_INPUT_SETTINGS: VoiceInputSettings = {
  whisperModel: 'base',
  language: 'auto',
  useGPU: false,
  translate: false
};

/**
 * Whisper model definitions with download URLs and metadata
 */
export const WHISPER_MODELS: Record<WhisperModelSize, WhisperModelInfo> = {
  tiny: {
    size: 'tiny',
    fileName: 'ggml-tiny.bin',
    fileSize: 75_000_000,
    fileSizeDisplay: '75 MB',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
    description: 'Fast, good accuracy'
  },
  base: {
    size: 'base',
    fileName: 'ggml-base.bin',
    fileSize: 142_000_000,
    fileSizeDisplay: '142 MB',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    description: 'Balanced (Recommended)'
  },
  small: {
    size: 'small',
    fileName: 'ggml-small-q8_0.bin',
    fileSize: 264_000_000,
    fileSizeDisplay: '264 MB',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q8_0.bin',
    description: 'Better accuracy'
  },
  medium: {
    size: 'medium',
    fileName: 'ggml-medium-q5_0.bin',
    fileSize: 539_000_000,
    fileSizeDisplay: '539 MB',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin',
    description: 'Best accuracy'
  },
  turbo: {
    size: 'turbo',
    fileName: 'ggml-large-v3-turbo-q5_0.bin',
    fileSize: 574_000_000,
    fileSizeDisplay: '574 MB',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
    description: 'Best accuracy'
  }
};

/**
 * Whisper model download status
 */
export interface WhisperModelStatus {
  /** Model size */
  size: WhisperModelSize;
  /** Whether the model is downloaded */
  downloaded: boolean;
  /** Full path to the model file (if downloaded) */
  path?: string;
  /** File size on disk (if downloaded) */
  actualSize?: number;
}

/**
 * Whisper download progress event
 */
export interface WhisperDownloadProgress {
  /** Model being downloaded */
  model: WhisperModelSize;
  /** Bytes downloaded so far */
  downloaded: number;
  /** Total bytes to download */
  total: number;
  /** Progress percentage (0-100) */
  percent: number;
}