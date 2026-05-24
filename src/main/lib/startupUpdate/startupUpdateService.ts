/**
 * Startup Update Service
 *
 * Checks for and installs updates during application startup (after FRE is completed).
 *
 * Flow:
 *   step1: Refresh GitHub Copilot models from remote API
 *   step2: Complete
 */

import { createLogger } from '../unifiedLogger';
import { isFeatureEnabled } from '../featureFlags';
import { profileCacheManager } from '../userDataADO/profileCacheManager';

const logger = createLogger();

export type StartupUpdateStep =
  | 'check-models'
  | 'complete';

export interface StartupUpdateProgress {
  step: StartupUpdateStep;
  message: string;
  progress: number; // 0-100
  error?: string;
}

export interface StartupUpdateResult {
  success: boolean;
  hasUpdates: boolean;
  errors: string[];
}






import { ghcModelsManager } from "../llm/ghcModelsManager";

/**
 * Built-in skills that must be installed if not present.
 * These are checked during startup update and auto-installed.
 */

/**
 * Startup Update Service - checks and installs updates at startup
 */
export class StartupUpdateService {
  private alias: string;
  private progressCallback: (progress: StartupUpdateProgress) => void;

  // Items that need update (populated during check steps)

  constructor(alias: string, progressCallback: (progress: StartupUpdateProgress) => void) {
    this.alias = alias;
    this.progressCallback = progressCallback;
  }

  /**
   * Run the full startup update check and install process
   */
  async run(): Promise<StartupUpdateResult> {
    const result: StartupUpdateResult = {
      success: true,
      hasUpdates: false,
      errors: [],
    };

    const startTime = Date.now();
    logger.info('[StartupUpdate] Starting startup update check...', 'StartupUpdateService');

    try {
      // Step 0: Refresh GitHub Copilot models from remote API
      await this.refreshModels();

      // Complete
      this.progressCallback({
        step: 'complete',
        message: 'Everything is up to date!',
        progress: 100,
      });

      const duration = Date.now() - startTime;
      logger.info(`[StartupUpdate] Completed in ${duration}ms`, 'StartupUpdateService');

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[StartupUpdate] Failed: ${errorMsg}`, 'StartupUpdateService');
      result.success = false;
      result.errors.push(errorMsg);

      this.progressCallback({
        step: 'complete',
        message: 'Update check failed',
        progress: 100,
        error: errorMsg,
      });
    }

    return result;
  }

  // ==================== Step 0: Refresh Models from Remote ====================

  private async refreshModels(): Promise<void> {
    this.progressCallback({
      step: 'check-models',
      message: 'Refreshing model list from remote...',
      progress: 2,
    });

    try {

      // Ensure initialized first (loads from local file)
      await ghcModelsManager.initialize(this.alias);

      // Then refresh from remote API to get latest model data
      // refreshFromRemote() automatically notifies renderers on success
      const refreshed = await ghcModelsManager.refreshFromRemote();

      if (refreshed) {
        logger.info('[StartupUpdate] Models refreshed from remote successfully', 'StartupUpdateService');
      } else {
        logger.info('[StartupUpdate] Models refresh skipped (no changes or token unavailable)', 'StartupUpdateService');
      }

      this.progressCallback({
        step: 'check-models',
        message: refreshed ? 'Model list updated' : 'Models are up to date',
        progress: 4,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`[StartupUpdate] Models refresh failed (non-fatal): ${errorMsg}`, 'StartupUpdateService');
      // Non-fatal: continue with other checks even if model refresh fails
    }
  }

}
