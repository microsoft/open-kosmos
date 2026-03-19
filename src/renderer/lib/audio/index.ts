/**
 * Audio utilities module
 *
 * Contains speech-to-text functionality including:
 * - Web Speech API (Method 1 - native browser API)
 * - Audio recording utilities for Whisper integration
 * - Future: OpenAI Whisper local integration (Method 3)
 *
 * For Whisper implementation guide, see: docs/whisper-stt-implementation.md
 */

// Web Speech API (Method 1 - easiest, but limited in Electron)
export {
  useSpeechRecognition,
  type UseSpeechRecognitionOptions,
  type UseSpeechRecognitionReturn,
  type SpeechRecognitionStatus,
  type SpeechRecognitionError,
} from './useSpeechRecognition';

// Audio recording utilities (for Whisper integration)
export {
  useAudioRecorder,
  convertToWav,
  type AudioRecorderOptions,
  type AudioRecorderState,
  type UseAudioRecorderReturn,
} from './useAudioRecorder';

// Streaming audio recording (for real-time transcription)
export {
  useStreamingAudioRecorder,
  type StreamingAudioRecorderOptions,
  type StreamingAudioRecorderState,
  type UseStreamingAudioRecorderReturn,
} from './useStreamingAudioRecorder';

// Whisper types (Method 3 - offline, high accuracy)
export {
  type WhisperConfig,
  type WhisperSegment,
  type WhisperWord,
  type WhisperResult,
  type WhisperServiceStatus,
  type WhisperService,
} from './whisperTypes';

