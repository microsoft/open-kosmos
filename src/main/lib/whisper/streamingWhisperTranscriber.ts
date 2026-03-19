/**
 * Streaming Whisper Transcriber
 *
 * Provides real-time speech-to-text transcription using VAD (Voice Activity Detection).
 * Instead of waiting for the user to stop recording, this service:
 * 1. Accumulates audio chunks
 * 2. Detects silence using VAD
 * 3. Transcribes completed segments automatically
 * 4. Streams interim results back to the renderer
 */

import { BrowserWindow } from 'electron';
import type { WhisperModelSize } from '../userDataADO/types/profile';
import { whisperModelManager } from './whisperModelManager';
import * as fs from 'fs';
import { nativeModuleManager, NativeModuleNotDownloadedError } from '../nativeModules';

// whisper-node-addon is loaded on demand via NativeModuleManager (userData cache)
let whisperAddon: typeof import('@kutalia/whisper-node-addon') | null = null;

/**
 * Streaming session state
 */
interface StreamingSession {
  /** Unique session ID */
  sessionId: string;
  /** Accumulated PCM audio data */
  audioBuffer: Float32Array[];
  /** Total samples in buffer */
  totalSamples: number;
  /** Model size being used */
  modelSize: WhisperModelSize;
  /** Transcription options */
  options: StreamingTranscribeOptions;
  /** Whether session is active */
  isActive: boolean;
  /** Last activity timestamp */
  lastActivityTime: number;
  /** Silence duration tracker (in samples) */
  silenceSamples: number;
  /** Whether we've detected speech in this segment */
  hasSpeech: boolean;
  /** Samples of speech detected in current segment */
  speechSamples: number;
  /** Previous transcription text for deduplication */
  previousText: string;
  /** Browser window to send events to */
  browserWindow: BrowserWindow | null;
  /** Whether a transcription is currently in progress */
  isTranscribing: boolean;
  /** Pending transcription request */
  pendingTranscription: boolean;
}

/**
 * Streaming transcription options
 */
export interface StreamingTranscribeOptions {
  /** Language code (e.g., 'en', 'zh', 'auto' for auto-detect) */
  language?: string;
  /** Enable GPU acceleration */
  useGPU?: boolean;
  /** Number of threads for CPU inference */
  threads?: number;
  /** Translate to English */
  translate?: boolean;
  /** VAD threshold (0.0 to 1.0) - sensitivity for detecting speech */
  vadThreshold?: number;
  /** Silence duration in ms before triggering transcription */
  silenceDuration?: number;
  /** Minimum speech duration in ms before considering transcription */
  minSpeechDuration?: number;
}

/**
 * Streaming update event sent to renderer
 */
export interface StreamingUpdate {
  sessionId: string;
  type: 'interim' | 'final' | 'error' | 'started' | 'stopped';
  text?: string;
  segments?: Array<{ start: string; end: string; text: string }>;
  error?: string;
  /** Audio duration transcribed so far in ms */
  duration?: number;
}

// Constants
const SAMPLE_RATE = 16000; // 16kHz
const SILENCE_THRESHOLD = 0.01; // RMS threshold for silence detection
const SPEECH_THRESHOLD = 0.015; // RMS threshold for detecting actual speech
const DEFAULT_SILENCE_DURATION = 400; // ms of silence to trigger transcription (reduced for faster response)
const DEFAULT_MIN_SPEECH_DURATION = 300; // ms minimum speech before transcription
const MIN_SPEECH_SAMPLES_FOR_TRANSCRIPTION = 4800; // At least 0.3s of actual speech (reduced)
const INTERIM_INTERVAL_MS = 2000; // Send interim results every 2 seconds of speech
const BUFFER_TRIM_INTERVAL = 30000; // Trim buffer every 30 seconds worth of audio

/**
 * Active streaming sessions
 */
const activeSessions = new Map<string, StreamingSession>();

/**
 * Load the whisper addon via NativeModuleManager (userData cache only).
 * Throws NativeModuleNotDownloadedError if the addon has not been downloaded yet.
 */
async function loadWhisperAddon(): Promise<typeof import('@kutalia/whisper-node-addon')> {
  if (whisperAddon) {
    return whisperAddon;
  }

  if (!nativeModuleManager.isAvailable('whisper-addon')) {
    throw new NativeModuleNotDownloadedError('whisper-addon');
  }

  try {
    whisperAddon = nativeModuleManager.requireModule('whisper-addon') as typeof import('@kutalia/whisper-node-addon');
    console.log('[StreamingWhisper] Whisper addon loaded from userData cache');
    return whisperAddon;
  } catch (error) {
    console.error('[StreamingWhisper] Failed to load whisper addon from cache:', error);
    // Re-throw original error so the UI shows the actual failure reason
    throw error;
  }
}

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `streaming_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Calculate RMS (Root Mean Square) of audio samples for silence detection
 */
function calculateRMS(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Combine multiple Float32Arrays into one
 */
function combineAudioBuffers(buffers: Float32Array[]): Float32Array {
  const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0);
  const combined = new Float32Array(totalLength);
  let offset = 0;
  for (const buffer of buffers) {
    combined.set(buffer, offset);
    offset += buffer.length;
  }
  return combined;
}

/**
 * Send update event to renderer
 */
function sendUpdate(session: StreamingSession, update: StreamingUpdate): void {
  if (session.browserWindow && !session.browserWindow.isDestroyed()) {
    session.browserWindow.webContents.send('whisper:streamingUpdate', update);
  }
}

/**
 * Perform transcription on accumulated audio
 */
async function transcribeBuffer(session: StreamingSession, isFinal: boolean): Promise<void> {
  if (session.audioBuffer.length === 0 || session.totalSamples === 0) {
    return;
  }

  // Prevent concurrent transcriptions - they can cause crashes
  if (session.isTranscribing) {
    console.log('[StreamingWhisper] Transcription already in progress, marking as pending');
    session.pendingTranscription = true;
    return;
  }

  session.isTranscribing = true;

  try {
    const whisper = await loadWhisperAddon();
    const modelPath = whisperModelManager.getModelPath(session.modelSize);

    if (!fs.existsSync(modelPath)) {
      sendUpdate(session, {
        sessionId: session.sessionId,
        type: 'error',
        error: `Model not found: ${modelPath}`,
      });
      return;
    }

    // Combine all audio buffers and clear the session buffer
    const pcmData = combineAudioBuffers(session.audioBuffer);
    const durationMs = (pcmData.length / SAMPLE_RATE) * 1000;

    // Clear buffer before transcription to prevent re-processing
    if (isFinal) {
      session.audioBuffer = [];
      session.totalSamples = 0;
      session.hasSpeech = false;
      session.speechSamples = 0;
    }

    console.log(`[StreamingWhisper] Transcribing ${durationMs.toFixed(0)}ms of audio (${isFinal ? 'final' : 'interim'})`);

    // Determine language settings
    const isSimplifiedChinese = session.options.language === 'zh';
    const isTraditionalChinese = session.options.language === 'zh-Hant';
    const whisperLanguage = (isSimplifiedChinese || isTraditionalChinese) ? 'zh' : session.options.language;

    const transcribeOptions: any = {
      pcmf32: pcmData,
      model: modelPath,
      use_gpu: session.options.useGPU ?? false,
      vad: false, // Disable Whisper's internal VAD - we do our own silence detection
      n_threads: session.options.threads ?? 4,
      no_prints: true,
      translate: session.options.translate ?? false,
    };

    // Only add language if specified
    if (whisperLanguage && whisperLanguage !== 'auto') {
      transcribeOptions.language = whisperLanguage;
    }

    // Add prompt for Simplified Chinese
    if (isSimplifiedChinese) {
      transcribeOptions.prompt = 'The following are Mandarin sentences.';
    }

    console.log('[StreamingWhisper] Calling whisper.transcribe...');
    const result = await whisper.transcribe(transcribeOptions);
    console.log('[StreamingWhisper] Transcription returned');

    // Debug: Log the raw result
    console.log('[StreamingWhisper] Raw result:', JSON.stringify(result, null, 2));

    // Parse transcription result - cast to any for flexible handling
    const transcription = (result as any).transcription;
    let text = '';
    const segments: Array<{ start: string; end: string; text: string }> = [];

    if (Array.isArray(transcription)) {
      for (const segment of transcription) {
        if (Array.isArray(segment)) {
          if (segment.length >= 3) {
            segments.push({
              start: String(segment[0]),
              end: String(segment[1]),
              text: String(segment[2]).trim(),
            });
            text += String(segment[2]).trim() + ' ';
          }
        } else if (typeof segment === 'string') {
          text += segment.trim() + ' ';
        } else if (segment && typeof segment === 'object' && 'text' in segment) {
          // Handle object format: { start, end, text }
          const segText = String((segment as any).text || '').trim();
          if (segText) {
            segments.push({
              start: String((segment as any).start || ''),
              end: String((segment as any).end || ''),
              text: segText,
            });
            text += segText + ' ';
          }
        }
      }
    } else if (typeof transcription === 'string') {
      // Direct string result
      text = transcription.trim();
    } else if (transcription && typeof transcription === 'object') {
      // Object with text property
      text = String((transcription as any).text || '').trim();
    }

    // Also check if result has a direct text property
    if (!text && (result as any).text) {
      text = String((result as any).text).trim();
    }

    text = text.trim();

    // Filter out Whisper hallucination artifacts (e.g. [BLANK_AUDIO], (silence), etc.)
    text = text.replace(/\[BLANK_AUDIO\]/gi, '').replace(/\(blank audio\)/gi, '').trim();

    // Only send update if text is not empty
    if (text && text !== session.previousText) {
      session.previousText = isFinal ? '' : text; // Reset on final

      sendUpdate(session, {
        sessionId: session.sessionId,
        type: isFinal ? 'final' : 'interim',
        text,
        segments,
        duration: durationMs,
      });

      console.log(`[StreamingWhisper] ${isFinal ? 'Final' : 'Interim'}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
    } else if (!text) {
      console.log('[StreamingWhisper] No text transcribed');
    }

  } catch (error) {
    console.error('[StreamingWhisper] Transcription error:', error);
    sendUpdate(session, {
      sessionId: session.sessionId,
      type: 'error',
      error: error instanceof Error ? error.message : 'Transcription failed',
    });
  } finally {
    session.isTranscribing = false;

    // Handle pending transcription request
    if (session.pendingTranscription && session.isActive) {
      session.pendingTranscription = false;
      // Use setImmediate to avoid stack overflow
      setImmediate(() => {
        if (session.totalSamples > 0) {
          transcribeBuffer(session, true);
        }
      });
    }
  }
}

/**
 * Start a new streaming transcription session
 */
export async function startStreamingSession(
  modelSize: WhisperModelSize,
  options: StreamingTranscribeOptions,
  browserWindow: BrowserWindow | null
): Promise<string> {
  // Ensure whisper addon is loaded
  await loadWhisperAddon();

  // Verify model exists
  const modelPath = whisperModelManager.getModelPath(modelSize);
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Whisper model not found: ${modelPath}. Please download the model first.`);
  }

  const sessionId = generateSessionId();
  const session: StreamingSession = {
    sessionId,
    audioBuffer: [],
    totalSamples: 0,
    modelSize,
    options,
    isActive: true,
    lastActivityTime: Date.now(),
    silenceSamples: 0,
    hasSpeech: false,
    speechSamples: 0,
    previousText: '',
    browserWindow,
    isTranscribing: false,
    pendingTranscription: false,
  };

  activeSessions.set(sessionId, session);

  console.log(`[StreamingWhisper] Started session ${sessionId} with model ${modelSize}`);

  sendUpdate(session, {
    sessionId,
    type: 'started',
  });

  return sessionId;
}

/**
 * Process an audio chunk for a streaming session
 */
export async function processAudioChunk(
  sessionId: string,
  pcmChunk: Float32Array
): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (!session || !session.isActive) {
    console.warn(`[StreamingWhisper] Session not found or inactive: ${sessionId}`);
    return;
  }

  // Update activity time
  session.lastActivityTime = Date.now();

  // Add chunk to buffer
  session.audioBuffer.push(pcmChunk);
  session.totalSamples += pcmChunk.length;

  // Calculate RMS to detect silence/speech
  const rms = calculateRMS(pcmChunk);
  const isSilent = rms < SILENCE_THRESHOLD;
  const isSpeech = rms >= SPEECH_THRESHOLD;

  const silenceDuration = session.options.silenceDuration ?? DEFAULT_SILENCE_DURATION;
  const minSpeechDuration = session.options.minSpeechDuration ?? DEFAULT_MIN_SPEECH_DURATION;
  const silenceSamplesThreshold = (silenceDuration / 1000) * SAMPLE_RATE;
  const minSpeechSamples = (minSpeechDuration / 1000) * SAMPLE_RATE;

  // Track speech
  if (isSpeech) {
    session.hasSpeech = true;
    session.speechSamples += pcmChunk.length;
    session.silenceSamples = 0; // Reset silence when speech detected
  } else if (isSilent) {
    session.silenceSamples += pcmChunk.length;
  }

  // Debug logging occasionally (every 4 seconds instead of 2)
  if (session.totalSamples % (SAMPLE_RATE * 4) < pcmChunk.length) {
    console.log(`[StreamingWhisper] Buffer: ${session.totalSamples} samples, Speech: ${session.speechSamples}, Silence: ${session.silenceSamples}, RMS: ${rms.toFixed(4)}`);
  }

  // Check if we should trigger transcription:
  // 1. We have enough silence after speech
  // 2. We have detected actual speech (not just noise)
  // 3. We have enough speech samples
  if (isSilent &&
      session.silenceSamples >= silenceSamplesThreshold &&
      session.hasSpeech &&
      session.speechSamples >= MIN_SPEECH_SAMPLES_FOR_TRANSCRIPTION) {
    console.log(`[StreamingWhisper] Silence after speech (${session.speechSamples} samples), transcribing`);
    await transcribeBuffer(session, true);
    // Reset speech tracking for next segment
    session.silenceSamples = 0;
    session.hasSpeech = false;
    session.speechSamples = 0;
  }

  // Periodically transcribe for interim results while speaking continuously
  const interimIntervalSamples = (INTERIM_INTERVAL_MS / 1000) * SAMPLE_RATE;
  if (session.speechSamples >= interimIntervalSamples && session.hasSpeech && !session.isTranscribing) {
    console.log(`[StreamingWhisper] Interim after ${session.speechSamples} speech samples`);
    await transcribeBuffer(session, false);
  }

  // Trim buffer if it gets too large (prevent memory issues)
  const maxBufferSamples = BUFFER_TRIM_INTERVAL / 1000 * SAMPLE_RATE;
  if (session.totalSamples > maxBufferSamples * 1.5) {
    console.log(`[StreamingWhisper] Trimming buffer, was ${session.totalSamples} samples`);
    // Keep only the last portion of audio
    const combined = combineAudioBuffers(session.audioBuffer);
    const keepFrom = combined.length - maxBufferSamples;
    session.audioBuffer = [combined.slice(keepFrom)];
    session.totalSamples = session.audioBuffer[0].length;
  }
}

/**
 * Stop a streaming session and perform final transcription
 */
export async function stopStreamingSession(sessionId: string): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (!session) {
    console.warn(`[StreamingWhisper] Session not found: ${sessionId}`);
    return;
  }

  session.isActive = false;

  // Perform final transcription if there's remaining audio
  if (session.totalSamples > 0) {
    console.log(`[StreamingWhisper] Stopping session, transcribing remaining ${session.totalSamples} samples`);
    await transcribeBuffer(session, true);
  }

  sendUpdate(session, {
    sessionId,
    type: 'stopped',
  });

  // Clean up
  activeSessions.delete(sessionId);
  console.log(`[StreamingWhisper] Session ${sessionId} stopped and cleaned up`);
}

/**
 * Cancel a streaming session without final transcription
 */
export function cancelStreamingSession(sessionId: string): void {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.isActive = false;
    sendUpdate(session, {
      sessionId,
      type: 'stopped',
    });
    activeSessions.delete(sessionId);
    console.log(`[StreamingWhisper] Session ${sessionId} cancelled`);
  }
}

/**
 * Check if a session is active
 */
export function isSessionActive(sessionId: string): boolean {
  const session = activeSessions.get(sessionId);
  return session?.isActive ?? false;
}

/**
 * Get active session count
 */
export function getActiveSessionCount(): number {
  return activeSessions.size;
}

export default {
  startStreamingSession,
  processAudioChunk,
  stopStreamingSession,
  cancelStreamingSession,
  isSessionActive,
  getActiveSessionCount,
};
