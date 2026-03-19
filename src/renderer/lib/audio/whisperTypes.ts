/**
 * Type definitions for OpenAI Whisper STT integration
 *
 * For implementation guide, see: docs/whisper-stt-implementation.md
 */

export interface WhisperConfig {
  /** Path to the Whisper model file */
  modelPath: string;
  /** Language code (e.g., 'en', 'zh', 'auto' for auto-detect) */
  language?: string;
  /** Whether to translate to English */
  translate?: boolean;
  /** Number of threads for CPU inference */
  threads?: number;
  /** Whether to include word-level timestamps */
  wordTimestamps?: boolean;
}

export interface WhisperSegment {
  /** Start time in milliseconds */
  start: number;
  /** End time in milliseconds */
  end: number;
  /** Transcribed text */
  text: string;
  /** Confidence score (0-1) */
  confidence?: number;
  /** Word-level details (if enabled) */
  words?: WhisperWord[];
}

export interface WhisperWord {
  /** Start time in milliseconds */
  start: number;
  /** End time in milliseconds */
  end: number;
  /** The word */
  word: string;
  /** Confidence score (0-1) */
  confidence?: number;
}

export interface WhisperResult {
  /** Full transcription text */
  text: string;
  /** Detected or specified language */
  language: string;
  /** Segments with timestamps */
  segments: WhisperSegment[];
  /** Total processing time in milliseconds */
  processingTime: number;
}

export interface WhisperServiceStatus {
  /** Whether the service is initialized */
  initialized: boolean;
  /** Whether a model is loaded */
  modelLoaded: boolean;
  /** Currently loaded model name */
  currentModel?: string;
  /** Whether transcription is in progress */
  isProcessing: boolean;
}

export interface WhisperService {
  /** Initialize the Whisper service */
  initialize(config: WhisperConfig): Promise<void>;
  /** Transcribe an audio file */
  transcribe(audioPath: string): Promise<WhisperResult>;
  /** Transcribe an audio buffer */
  transcribeBuffer(audioBuffer: ArrayBuffer): Promise<WhisperResult>;
  /** Get current service status */
  getStatus(): WhisperServiceStatus;
  /** Unload the model and free resources */
  unload(): Promise<void>;
}
