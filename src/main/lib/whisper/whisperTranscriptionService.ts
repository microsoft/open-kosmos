/**
 * Whisper Transcription Service
 *
 * Provides speech-to-text transcription using @kutalia/whisper-node-addon.
 * This service runs in the main process and handles:
 * - Model loading and management
 * - Audio transcription (file-based and PCM buffer)
 * - GPU acceleration support (Vulkan/Metal)
 *
 * Note: The native addon is not distributed with the app installer. On first use,
 *       it is downloaded on demand from the npm CDN to the userData/native-modules/ directory
 *       via NativeModuleManager.
 */

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import type { WhisperModelSize } from '../userDataADO/types/profile';
import { whisperModelManager } from './whisperModelManager';
import { nativeModuleManager, NativeModuleNotDownloadedError } from '../nativeModules';

// Whisper addon module cache
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
 * Lazily load whisper addon
 *
 * Preferentially loads from NativeModuleManager's userData cache path.
 * If not yet downloaded, throws NativeModuleNotDownloadedError (caller can guide user to download).
 */
async function loadWhisperAddon(): Promise<{ transcribe: (opts: Record<string, unknown>) => Promise<{ transcription: unknown }> }> {
  if (whisperAddon) {
    return whisperAddon;
  }

  // 1. First try loading from NativeModuleManager's downloaded path
  if (nativeModuleManager.isAvailable('whisper-addon')) {
    try {
      const mod = nativeModuleManager.requireModule('whisper-addon') as typeof whisperAddon;
      whisperAddon = mod;
      console.log('[WhisperTranscription] Whisper addon loaded from userData cache');
      return whisperAddon!;
    } catch (err) {
      console.warn('[WhisperTranscription] Failed to load from userData cache:', err);
      // Continue trying built-in path
    }
  }

  // userData cache unavailable, prompt user to download via UI
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

  console.log('[WhisperTranscription] Starting transcription with model:', modelPath);
  console.log('[WhisperTranscription] PCM data length:', pcmData.length, 'samples');
  console.log('[WhisperTranscription] Language option:', options.language);

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
      transcribeOptions.prompt = 'The following are Mandarin sentences.';
    }

    console.log('[WhisperTranscription] Transcribe options:', JSON.stringify({
      ...transcribeOptions,
      pcmf32: `[Float32Array length=${pcmData.length}]`
    }));

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
    console.log('[WhisperTranscription] Transcription complete:', text.substring(0, 100) + '...');

    return { text, segments };
  } catch (error) {
    console.error('[WhisperTranscription] Transcription failed:', error);
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

  console.log('[WhisperTranscription] Starting file transcription:', filePath);

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
      transcribeOptions.prompt = 'The following are Mandarin sentences.';
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
    console.log('[WhisperTranscription] File transcription complete:', text.substring(0, 100) + '...');

    return { text, segments };
  } catch (error) {
    console.error('[WhisperTranscription] File transcription failed:', error);
    throw error;
  }
}

/**
 * Check if Whisper addon is available (downloaded or built-in)
 */
export async function isWhisperAvailable(): Promise<boolean> {
  // Fast path: check NativeModuleManager cache or userData download
  if (nativeModuleManager.isAvailable('whisper-addon')) return true;

  return false;
}

/**
 * Trigger on-demand download of the whisper addon.
 * Used for UI-guided user download on first STT feature use.
 */
export async function downloadWhisperAddon(
  onProgress?: (progress: { bytesDownloaded: number; bytesTotal: number; percent: number }) => void,
): Promise<void> {
  await nativeModuleManager.ensureDownloaded('whisper-addon', (p) => {
    onProgress?.({ bytesDownloaded: p.bytesDownloaded, bytesTotal: p.bytesTotal, percent: p.percent });
  });
  // Clear module cache after download, will reload on next loadWhisperAddon call
  whisperAddon = null;
}

export default {
  transcribePCM,
  transcribeFile,
  isWhisperAvailable,
};
