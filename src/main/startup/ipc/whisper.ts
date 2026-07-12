import { BrowserWindow, ipcMain } from 'electron';

import { getAppCacheManager, getAdvancedLogger } from '../lazy';
import type { Context } from './shared';

export default function(ctx: Context) {

  // ===============================
  // Whisper speech recognition related IPC handlers
  // ===============================

  // Get all Whisper model statuses
  ipcMain.handle('whisper:getAllModelStatus', async () => {
    try {
      const { whisperModelManager } = await import('../../lib/whisper');
      const statuses = whisperModelManager.getAllModelStatus();
      return { success: true, data: statuses };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get single model status
  ipcMain.handle('whisper:getModelStatus', async (event, size: string) => {
    try {
      const { whisperModelManager } = await import('../../lib/whisper');
      const status = whisperModelManager.getModelStatus(size as any);
      return { success: true, data: status };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get all model info
  ipcMain.handle('whisper:getAllModelInfo', async () => {
    try {
      const { whisperModelManager } = await import('../../lib/whisper');
      const info = whisperModelManager.getAllModelInfo();
      return { success: true, data: info };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Download model
  ipcMain.handle('whisper:downloadModel', async (event, size: string) => {
    try {
      const { whisperModelManager } = await import('../../lib/whisper');

      // Find the window that initiated the request
      const win = BrowserWindow.fromWebContents(event.sender);

      await whisperModelManager.downloadModel(
        size as any,
        undefined, // onProgress callback (we use IPC events instead)
        win || undefined
      );

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Cancel model download
  ipcMain.handle('whisper:cancelDownload', async (event, size: string) => {
    try {
      const { whisperModelManager } = await import('../../lib/whisper');
      const cancelled = whisperModelManager.cancelDownload(size as any);
      return { success: true, data: cancelled };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Delete model
  ipcMain.handle('whisper:deleteModel', async (event, size: string) => {
    try {
      const { whisperModelManager } = await import('../../lib/whisper');
      const deleted = whisperModelManager.deleteModel(size as any);
      return { success: true, data: deleted };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get model path
  ipcMain.handle('whisper:getModelPath', async (event, size: string) => {
    try {
      const { whisperModelManager } = await import('../../lib/whisper');
      const modelPath = whisperModelManager.getModelPath(size as any);
      return { success: true, data: modelPath };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Check if there is an ongoing download
  ipcMain.handle('whisper:isDownloading', async () => {
    try {
      const { whisperModelManager } = await import('../../lib/whisper');
      const isDownloading = whisperModelManager.isDownloading();
      const activeDownloads = whisperModelManager.getActiveDownloads();
      return { success: true, data: { isDownloading, activeDownloads } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Whisper transcription
  ipcMain.handle('whisper:transcribe', async (event, data: { pcmData: number[]; modelSize: string; options?: any }) => {
    try {
      const { transcribePCM } = await import('../../lib/whisper');

      // Convert the number array back to Float32Array
      const pcmFloat32 = new Float32Array(data.pcmData);

      const result = await transcribePCM(
        pcmFloat32,
        data.modelSize as any,
        {
          language: data.options?.language,
          useGPU: data.options?.useGPU ?? false,
          enableVAD: data.options?.enableVAD ?? false,
          threads: data.options?.threads ?? 4,
          translate: data.options?.translate ?? false,
        }
      );

      return { success: true, data: result };
    } catch (error) {
      getAdvancedLogger().error('[Main] Whisper transcription error:', 'whisper', { error });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Check if Whisper is available
  ipcMain.handle('whisper:isAvailable', async () => {
    try {
      const { isWhisperAvailable } = await import('../../lib/whisper');
      const available = await isWhisperAvailable();
      return { success: true, data: available };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // ===============================
  // Streaming Whisper Transcription
  // ===============================

  // Start a streaming transcription session
  ipcMain.handle('whisper:startStreaming', async (event, data: {
    modelSize: string;
    options?: {
      language?: string;
      useGPU?: boolean;
      threads?: number;
      translate?: boolean;
      vadThreshold?: number;
      silenceDuration?: number;
      minSpeechDuration?: number;
    };
  }) => {
    try {
      const { startStreamingSession } = await import('../../lib/whisper');
      const browserWindow = BrowserWindow.fromWebContents(event.sender);
      const sessionId = await startStreamingSession(
        data.modelSize as any,
        data.options || {},
        browserWindow
      );
      return { success: true, data: { sessionId } };
    } catch (error) {
      getAdvancedLogger().error('[Main] Failed to start streaming session:', 'whisper', { error });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Process an audio chunk for streaming transcription
  ipcMain.handle('whisper:processChunk', async (event, data: {
    sessionId: string;
    pcmData: number[];
  }) => {
    try {
      const { processAudioChunk } = await import('../../lib/whisper');
      const pcmFloat32 = new Float32Array(data.pcmData);
      await processAudioChunk(data.sessionId, pcmFloat32);
      return { success: true };
    } catch (error) {
      getAdvancedLogger().error('[Main] Failed to process audio chunk:', 'whisper', { error });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Stop streaming session and get final transcription
  ipcMain.handle('whisper:stopStreaming', async (event, sessionId: string) => {
    try {
      const { stopStreamingSession } = await import('../../lib/whisper');
      await stopStreamingSession(sessionId);
      return { success: true };
    } catch (error) {
      getAdvancedLogger().error('[Main] Failed to stop streaming session:', 'whisper', { error });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Cancel streaming session without final transcription
  ipcMain.handle('whisper:cancelStreaming', async (event, sessionId: string) => {
    try {
      const { cancelStreamingSession } = await import('../../lib/whisper');
      cancelStreamingSession(sessionId);
      return { success: true };
    } catch (error) {
      getAdvancedLogger().error('[Main] Failed to cancel streaming session:', 'whisper', { error });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Check if a streaming session is active
  ipcMain.handle('whisper:isStreamingActive', async (event, sessionId: string) => {
    try {
      const { isSessionActive } = await import('../../lib/whisper');
      const active = isSessionActive(sessionId);
      return { success: true, data: active };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get/update Voice Input settings — data source: AppConfig.voiceInput (app.json, global config)
  ipcMain.handle('voiceInput:getSettings', async () => {
    try {
      const manager = await getAppCacheManager();
      const vc = manager.getConfig().voiceInput;
      // Map AppConfig.voiceInput → legacy VoiceInputSettings shape for UI backward compat
      return {
        success: true,
        data: {
          whisperModel: vc?.whisperModelSelected || 'base',
          language: vc?.recognitionLanguage || 'auto',
          useGPU: vc?.gpuAcceleration ?? false,
          translate: false,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('voiceInput:updateSettings', async (event, settings: any) => {
    try {
      const manager = await getAppCacheManager();
      await manager.updateConfig({
        voiceInput: {
          ...(settings.whisperModel !== undefined && { whisperModelSelected: settings.whisperModel }),
          ...(settings.language !== undefined && { recognitionLanguage: settings.language }),
          ...(settings.useGPU !== undefined && { gpuAcceleration: settings.useGPU }),
        },
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
