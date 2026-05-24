/**
 * Whisper Transcription Service
 *
 * Provides speech-to-text transcription using @kutalia/whisper-node-addon.
 * This service runs in the main process and handles:
 * - Model loading and management
 * - Audio transcription (file-based and PCM buffer)
 * - GPU acceleration support (Vulkan/Metal)
 *
 * Note: native addon is not distributed with the app installer; it is downloaded on demand from
 *      the npm CDN to userData/native-modules/ on first use, via NativeModuleManager.
 */

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import type { WhisperModelSize } from '../userDataADO/types/profile';
import { whisperModelManager } from './whisperModelManager';
import { nativeModuleManager, NativeModuleNotDownloadedError } from '../nativeModules';
import { createLogger } from '../unifiedLogger';
const logger = createLogger();

// Module cache for the whisper addon
let whisperAddon: { transcribe: (opts: Record<string, unknown>) => Promise<{ transcription: unknown }> } | null = null;

/**
 * Transcription result from Whisper
 */
export interface TranscriptionResult {
  text: string;
  segments?: Array<{
    start: string;
    end: string;
    text: string;
  }>;
}

/**
 * Transcription options
 */
export interface TranscribeOptions {
  /** Language code (e.g., 'en', 'zh', 'auto' for auto-detect) */
  language?: string;
  /** Enable GPU acceleration (Vulkan on Windows/Linux, Metal on macOS) */
  useGPU?: boolean;
  /** Enable Voice Activity Detection */
  enableVAD?: boolean;
  /** Number of threads for CPU inference */
  threads?: number;
  /** Translate to English (only available for 'small' and 'medium' models) */
  translate?: boolean;
}

/**
 * Lazy-load the whisper addon
 *
 * Preferentially loads from the userData cache path managed by NativeModuleManager.
 * If not yet downloaded, throws NativeModuleNotDownloadedError (caller can prompt the user to download).
 */
async function loadWhisperAddon(): Promise<{ transcribe: (opts: Record<string, unknown>) => Promise<{ transcription: unknown }> }> {
  if (whisperAddon) {
    return whisperAddon;
  }

  // 1. Preferentially try loading from the path already downloaded by NativeModuleManager
  if (nativeModuleManager.isAvailable('whisper-addon')) {
    try {
      const mod = nativeModuleManager.requireModule('whisper-addon') as typeof whisperAddon;
      whisperAddon = mod;
      logger.debug('[WhisperTranscription] Whisper addon loaded from userData cache');
      return whisperAddon!;
    } catch (err) {
      logger.warn(`[WhisperTranscription] Failed to load from userData cache: ${err instanceof Error ? err.message : String(err)}`)
      // Fall through to try the built-in path
    }
  }

  // userData cache unavailable — prompt the user to download via the UI
  throw new NativeModuleNotDownloadedError('whisper-addon');
}

/**
 * Transcribe audio from a Float32Array PCM buffer
 *
 * @param pcmData - Audio data as Float32Array (16kHz, mono)
 * @param modelSize - Whisper model size to use
 * @param options - Transcription options
 * @returns Transcription result
 */
export async function transcribePCM(
  pcmData: Float32Array,
  modelSize: WhisperModelSize,
  options: TranscribeOptions = {}
): Promise<TranscriptionResult> {
  const whisper = await loadWhisperAddon();

  // Get model path
  const modelPath = whisperModelManager.getModelPath(modelSize);
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Whisper model not found: ${modelPath}. Please download the model first.`);
  }

  logger.debug(`[WhisperTranscription] Starting transcription with model: ${modelPath}`);
  logger.debug(`[WhisperTranscription] PCM data length: ${pcmData.length} ${'samples'}`);
  logger.debug(`[WhisperTranscription] Language option: ${options.language}`);

  // Determine the actual Whisper language and prompt for Chinese variants
  // zh = Simplified Chinese (use prompt to guide output)
  // zh-Hant = Traditional Chinese (no prompt needed, Whisper default)
  const isSimplifiedChinese = options.language === 'zh';
  const isTraditionalChinese = options.language === 'zh-Hant';
  const whisperLanguage = (isSimplifiedChinese || isTraditionalChinese) ? 'zh' : options.language;

  try {
    // Build options object, only including language if it's defined
    // The addon defaults to 'en' if language is not provided
    const transcribeOptions: any = {
      pcmf32: pcmData,
      model: modelPath,
      use_gpu: options.useGPU ?? false,
      vad: options.enableVAD ?? false,
      n_threads: options.threads ?? 4,
      no_prints: true, // Suppress whisper.cpp console output
      translate: options.translate ?? false, // Translate to English if enabled
    };

    // Only add language if it's a non-empty string (not 'auto' or undefined)
    if (whisperLanguage && whisperLanguage !== 'auto') {
      transcribeOptions.language = whisperLanguage;
    }

    // Add prompt to guide Simplified Chinese output
    if (isSimplifiedChinese) {
      transcribeOptions.prompt = '以下是普通话的句子。';
    }

    logger.debug(`[WhisperTranscription] Transcribe options: ${JSON.stringify({
      ...transcribeOptions,
      pcmf32: `[Float32Array length=${pcmData.length}]`
    })}`);

    const result = await whisper.transcribe(transcribeOptions);

    // Parse the transcription result
    const transcription = result.transcription;
    let text = '';
    const segments: Array<{ start: string; end: string; text: string }> = [];

    if (Array.isArray(transcription)) {
      // transcription is an array of segments
      for (const segment of transcription) {
        if (Array.isArray(segment)) {
          // [start, end, text] format
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
        }
      }
    }

    text = text.trim();
    logger.debug(`[WhisperTranscription] Transcription complete: ${text.substring(0, 100) + '...'}`);

    return { text, segments };
  } catch (error) {
    logger.error(`[WhisperTranscription] Transcription failed: ${error instanceof Error ? error.message : String(error)}`)
    throw error;
  }
}

/**
 * Transcribe audio from a file
 *
 * @param filePath - Path to the audio file (must be 16kHz WAV)
 * @param modelSize - Whisper model size to use
 * @param options - Transcription options
 * @returns Transcription result
 */
export async function transcribeFile(
  filePath: string,
  modelSize: WhisperModelSize,
  options: TranscribeOptions = {}
): Promise<TranscriptionResult> {
  const whisper = await loadWhisperAddon();

  // Get model path
  const modelPath = whisperModelManager.getModelPath(modelSize);
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Whisper model not found: ${modelPath}. Please download the model first.`);
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`Audio file not found: ${filePath}`);
  }

  logger.debug(`[WhisperTranscription] Starting file transcription: ${filePath}`);

  // Determine the actual Whisper language and prompt for Chinese variants
  const isSimplifiedChinese = options.language === 'zh';
  const isTraditionalChinese = options.language === 'zh-Hant';
  const whisperLanguage = (isSimplifiedChinese || isTraditionalChinese) ? 'zh' : options.language;

  try {
    // Build options object, only including language if it's defined
    const transcribeOptions: any = {
      fname_inp: filePath,
      model: modelPath,
      use_gpu: options.useGPU ?? false,
      vad: options.enableVAD ?? false,
      n_threads: options.threads ?? 4,
      no_prints: true,
      translate: options.translate ?? false, // Translate to English if enabled
    };

    // Only add language if it's a non-empty string (not 'auto' or undefined)
    if (whisperLanguage && whisperLanguage !== 'auto') {
      transcribeOptions.language = whisperLanguage;
    }

    // Add prompt to guide Simplified Chinese output
    if (isSimplifiedChinese) {
      transcribeOptions.prompt = '以下是普通话的句子。';
    }

    const result = await whisper.transcribe(transcribeOptions);

    // Parse the transcription result (same as PCM)
    const transcription = result.transcription;
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
        }
      }
    }

    text = text.trim();
    logger.debug(`[WhisperTranscription] File transcription complete: ${text.substring(0, 100) + '...'}`);

    return { text, segments };
  } catch (error) {
    logger.error(`[WhisperTranscription] File transcription failed: ${error instanceof Error ? error.message : String(error)}`)
    throw error;
  }
}

/**
 * Check if Whisper addon is available (downloaded or built-in)
 */
export async function isWhisperAvailable(): Promise<boolean> {
  // Fast path: check NativeModuleManager cache or userData already downloaded
  if (nativeModuleManager.isAvailable('whisper-addon')) return true;

  return false;
}

/**
 * Trigger an on-demand download of the whisper addon.
 * Used for UI-guided downloads when the user first accesses the STT feature.
 */
export async function downloadWhisperAddon(
  onProgress?: (progress: { bytesDownloaded: number; bytesTotal: number; percent: number }) => void,
): Promise<void> {
  await nativeModuleManager.ensureDownloaded('whisper-addon', (p) => {
    onProgress?.({ bytesDownloaded: p.bytesDownloaded, bytesTotal: p.bytesTotal, percent: p.percent });
  });
  // After download completes, clear the module cache so the next loadWhisperAddon call reloads it
  whisperAddon = null;
}

export default {
  transcribePCM,
  transcribeFile,
  isWhisperAvailable,
};
