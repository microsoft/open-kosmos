/**
 * Whisper Model Manager
 *
 * Manages Whisper model downloads, storage, and lifecycle for offline STT.
 * Models are stored in: {userData}/assets/whisper-models/
 */

import { app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import {
  WhisperModelSize,
  WhisperModelInfo,
  WHISPER_MODELS,
} from '../userDataADO/types/profile';

export interface WhisperModelStatus {
  size: WhisperModelSize;
  downloaded: boolean;
  path?: string;
  actualSize?: number;
}

export interface DownloadProgress {
  model: WhisperModelSize;
  downloaded: number;
  total: number;
  percent: number;
}

/**
 * Singleton manager for Whisper model operations
 */
class WhisperModelManager {
  private static instance: WhisperModelManager;
  private modelsDir: string;
  private activeDownloads: Map<WhisperModelSize, AbortController> = new Map();

  private constructor() {
    this.modelsDir = path.join(app.getPath('userData'), 'assets', 'whisper-models');
    this.ensureModelsDir();
  }

  static getInstance(): WhisperModelManager {
    if (!WhisperModelManager.instance) {
      WhisperModelManager.instance = new WhisperModelManager();
    }
    return WhisperModelManager.instance;
  }

  /**
   * Ensure the models directory exists
   */
  private ensureModelsDir(): void {
    if (!fs.existsSync(this.modelsDir)) {
      fs.mkdirSync(this.modelsDir, { recursive: true });
      console.log('[WhisperModelManager] Created models directory:', this.modelsDir);
    }
  }

  /**
   * Get the path to a model file
   */
  getModelPath(size: WhisperModelSize): string {
    const modelInfo = WHISPER_MODELS[size];
    return path.join(this.modelsDir, modelInfo.fileName);
  }

  /**
   * Check if a model is downloaded
   */
  isModelDownloaded(size: WhisperModelSize): boolean {
    const modelPath = this.getModelPath(size);
    return fs.existsSync(modelPath);
  }

  /**
   * Get status of a specific model
   */
  getModelStatus(size: WhisperModelSize): WhisperModelStatus {
    const modelPath = this.getModelPath(size);
    const downloaded = fs.existsSync(modelPath);

    const status: WhisperModelStatus = {
      size,
      downloaded,
    };

    if (downloaded) {
      status.path = modelPath;
      try {
        const stats = fs.statSync(modelPath);
        status.actualSize = stats.size;
      } catch (err) {
        console.error('[WhisperModelManager] Error getting file stats:', err);
      }
    }

    return status;
  }

  /**
   * Get status of all models
   */
  getAllModelStatus(): WhisperModelStatus[] {
    const sizes: WhisperModelSize[] = ['tiny', 'base', 'small', 'medium', 'turbo'];
    return sizes.map(size => this.getModelStatus(size));
  }

  /**
   * Download a model with progress reporting
   */
  async downloadModel(
    size: WhisperModelSize,
    onProgress?: (progress: DownloadProgress) => void,
    window?: BrowserWindow
  ): Promise<void> {
    const modelInfo = WHISPER_MODELS[size];
    const modelPath = this.getModelPath(size);
    const tempPath = modelPath + '.tmp';

    // Check if already downloading
    if (this.activeDownloads.has(size)) {
      throw new Error(`Model ${size} is already being downloaded`);
    }

    // Check if already downloaded
    if (this.isModelDownloaded(size)) {
      console.log(`[WhisperModelManager] Model ${size} is already downloaded`);
      return;
    }

    console.log(`[WhisperModelManager] Starting download of ${size} model from ${modelInfo.downloadUrl}`);

    const abortController = new AbortController();
    this.activeDownloads.set(size, abortController);

    try {
      await this.downloadFile(
        modelInfo.downloadUrl,
        tempPath,
        (downloaded, total) => {
          const progress: DownloadProgress = {
            model: size,
            downloaded,
            total,
            percent: total > 0 ? Math.round((downloaded / total) * 100) : 0,
          };
          onProgress?.(progress);

          // Also send to window if provided
          if (window && !window.isDestroyed()) {
            window.webContents.send('whisper:downloadProgress', progress);
          }
        },
        abortController.signal
      );

      // Rename temp file to final path
      fs.renameSync(tempPath, modelPath);
      console.log(`[WhisperModelManager] Model ${size} downloaded successfully to ${modelPath}`);

      // Notify completion
      if (window && !window.isDestroyed()) {
        window.webContents.send('whisper:downloadComplete', { model: size, path: modelPath });
      }
    } catch (err) {
      // Clean up temp file on error
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }

      if ((err as Error).name === 'AbortError') {
        console.log(`[WhisperModelManager] Download of ${size} model was cancelled`);
        if (window && !window.isDestroyed()) {
          window.webContents.send('whisper:downloadCancelled', { model: size });
        }
      } else {
        console.error(`[WhisperModelManager] Error downloading ${size} model:`, err);
        if (window && !window.isDestroyed()) {
          window.webContents.send('whisper:downloadError', {
            model: size,
            error: (err as Error).message,
          });
        }
        throw err;
      }
    } finally {
      this.activeDownloads.delete(size);
    }
  }

  /**
   * Cancel an active download
   */
  cancelDownload(size: WhisperModelSize): boolean {
    const controller = this.activeDownloads.get(size);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  /**
   * Delete a downloaded model
   */
  deleteModel(size: WhisperModelSize): boolean {
    const modelPath = this.getModelPath(size);

    if (!fs.existsSync(modelPath)) {
      console.log(`[WhisperModelManager] Model ${size} does not exist`);
      return false;
    }

    try {
      fs.unlinkSync(modelPath);
      console.log(`[WhisperModelManager] Deleted model ${size} from ${modelPath}`);
      return true;
    } catch (err) {
      console.error(`[WhisperModelManager] Error deleting model ${size}:`, err);
      throw err;
    }
  }

  /**
   * Get model info
   */
  getModelInfo(size: WhisperModelSize): WhisperModelInfo {
    return WHISPER_MODELS[size];
  }

  /**
   * Get all model info
   */
  getAllModelInfo(): WhisperModelInfo[] {
    const sizes: WhisperModelSize[] = ['tiny', 'base', 'small', 'medium', 'turbo'];
    return sizes.map(size => WHISPER_MODELS[size]);
  }

  /**
   * Download a file with progress tracking
   */
  private downloadFile(
    url: string,
    destPath: string,
    onProgress: (downloaded: number, total: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;

      const request = protocol.get(url, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            console.log(`[WhisperModelManager] Following redirect to ${redirectUrl}`);
            this.downloadFile(redirectUrl, destPath, onProgress, signal)
              .then(resolve)
              .catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'] || '0', 10);
        let downloadedSize = 0;

        const file = fs.createWriteStream(destPath);

        // Handle abort signal
        if (signal) {
          signal.addEventListener('abort', () => {
            request.destroy();
            file.close();
            const error = new Error('Download aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }

        response.on('data', (chunk: Buffer) => {
          downloadedSize += chunk.length;
          onProgress(downloadedSize, totalSize);
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });

        file.on('error', (err) => {
          file.close();
          fs.unlink(destPath, () => {}); // Delete the file on error
          reject(err);
        });
      });

      request.on('error', (err) => {
        reject(err);
      });

      // Handle abort signal
      if (signal) {
        signal.addEventListener('abort', () => {
          request.destroy();
        });
      }
    });
  }

  /**
   * Check if any download is in progress
   */
  isDownloading(): boolean {
    return this.activeDownloads.size > 0;
  }

  /**
   * Get list of models currently being downloaded
   */
  getActiveDownloads(): WhisperModelSize[] {
    return Array.from(this.activeDownloads.keys());
  }
}

export const whisperModelManager = WhisperModelManager.getInstance();
export default whisperModelManager;
