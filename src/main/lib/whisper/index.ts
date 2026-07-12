/**
 * Whisper module for offline speech-to-text
 *
 * This module provides:
 * - Model download and management
 * - Audio transcription via @kutalia/whisper-node-addon
 */

export {
  whisperModelManager,
  type WhisperModelStatus,
  type DownloadProgress,
} from './whisperModelManager';

export {
  transcribePCM,
  transcribeFile,
  isWhisperAvailable,
  downloadWhisperAddon,
  type TranscriptionResult,
  type TranscribeOptions,
} from './whisperTranscriptionService';

// Streaming transcription
export {
  startStreamingSession,
  processAudioChunk,
  stopStreamingSession,
  cancelStreamingSession,
  isSessionActive,
  getActiveSessionCount,
  type StreamingTranscribeOptions,
  type StreamingUpdate,
} from './streamingWhisperTranscriber';
