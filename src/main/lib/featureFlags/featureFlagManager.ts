/**
 * Feature Flag Manager (Main Process)
 *
 * Acts as the single source of truth for Feature Flags
 *
 * Features:
 * - Define default values for feature flags in the backend (supports static values and dynamic logic)
 * - Parse command-line arguments to override default values (--enable-features, --disable-features)
 * - Provide a read-only API for use by the main process and the frontend
 *
 * Command-line argument format:
 * - Windows: app.exe --enable-features=flag1,flag2 --disable-features=flag3
 * - macOS:   app --enable-features=flag1,flag2 --disable-features=flag3
 */

import {
  FeatureFlagName,
  FeatureFlagState,
  FeatureFlagsMap,
  FeatureFlagsValues,
  FeatureFlagContext,
} from './types';
import {
  FEATURE_FLAG_DEFINITIONS,
  getFeatureFlagConfig,
  resolveDefaultValue,
} from './featureFlagDefinitions';
import { createLogger } from '../unifiedLogger';
const logger = createLogger();

class FeatureFlagManager {
  private static instance: FeatureFlagManager;
  private flags: FeatureFlagsMap;
  private initialized: boolean = false;
  private context: FeatureFlagContext;

  private constructor() {
    this.flags = {} as FeatureFlagsMap;
    // Initialize context (using temporary values, will be updated in initialize)
    this.context = {
      isDev: false,
      brandName: 'openkosmos',
      platform: process.platform,
      arch: process.arch,
    };
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): FeatureFlagManager {
    if (!FeatureFlagManager.instance) {
      FeatureFlagManager.instance = new FeatureFlagManager();
    }
    return FeatureFlagManager.instance;
  }

  /**
   * Initialize the Feature Flag manager
   * Should be called at app startup
   */
  public initialize(): void {
    if (this.initialized) {
      logger.debug('[FeatureFlags] Already initialized, skipping...');
      return;
    }

    logger.debug('[FeatureFlags] Initializing feature flag manager...');

    // Detect development environment
    this.context.isDev = process.env.NODE_ENV === 'development' ||
                         process.argv.includes('--dev');

    // Initialize default values for all flags using the context
    this.initializeDefaults();

    // Parse command-line arguments (will override defaults)
    this.parseCommandLineArgs();

    this.initialized = true;
    logger.debug('[FeatureFlags] Initialization complete');
    this.logCurrentState();
  }

  /**
   * Initialize all flags to their default values (computed based on context)
   */
  private initializeDefaults(): void {
    for (const config of FEATURE_FLAG_DEFINITIONS) {
      const defaultValue = resolveDefaultValue(config.defaultValue, this.context);
      this.flags[config.name] = {
        name: config.name,
        enabled: defaultValue,
        source: 'default',
      };
    }
  }

  /**
   * Parse command-line arguments
   */
  private parseCommandLineArgs(): void {
    const args = process.argv;
    logger.debug(`[FeatureFlags] Parsing command line args: ${args.join(' ')}`);

    for (const arg of args) {
      // Parse --enable-features=flag1,flag2
      if (arg.startsWith('--enable-features=')) {
        const flagsStr = arg.substring('--enable-features='.length);
        const flagNames = flagsStr.split(',').map(s => s.trim()).filter(Boolean);

        for (const flagName of flagNames) {
          this.setFlagFromCli(flagName as FeatureFlagName, true);
        }
      }

      // Parse --disable-features=flag1,flag2
      if (arg.startsWith('--disable-features=')) {
        const flagsStr = arg.substring('--disable-features='.length);
        const flagNames = flagsStr.split(',').map(s => s.trim()).filter(Boolean);

        for (const flagName of flagNames) {
          this.setFlagFromCli(flagName as FeatureFlagName, false);
        }
      }
    }
  }

  /**
   * Set a flag from the command line
   */
  private setFlagFromCli(name: FeatureFlagName, enabled: boolean): void {
    const config = getFeatureFlagConfig(name);

    if (!config) {
      logger.warn(`[FeatureFlags] Unknown feature flag from CLI: ${name}`);
      return;
    }

    this.flags[name] = {
      name,
      enabled,
      source: 'cli',
    };
    logger.debug(`[FeatureFlags] Set ${name}=${enabled} from CLI`);
  }

  /**
   * Check whether a feature flag is enabled
   */
  public isEnabled(name: FeatureFlagName): boolean {
    const flag = this.flags[name];
    if (!flag) {
      logger.warn(`[FeatureFlags] Unknown feature flag: ${name}`);
      return false;
    }

    return flag.enabled;
  }

  /**
   * Get a simplified value map of all flags (for frontend synchronization)
   */
  public getAllFlagsValues(): FeatureFlagsValues {
    const values: Record<string, boolean> = {};

    for (const [name, state] of Object.entries(this.flags)) {
      values[name] = state.enabled;
    }

    return values as FeatureFlagsValues;
  }

  /**
   * Output current state to the log
   */
  private logCurrentState(): void {
    logger.debug('[FeatureFlags] Current state:');
    logger.debug(`  Context: isDev=${this.context.isDev}, brandName=${this.context.brandName}, platform=${this.context.platform}`);
    for (const [name, state] of Object.entries(this.flags)) {
      if (state.source !== 'default' || state.enabled) {
        logger.debug(`  - ${name}: ${state.enabled} (source: ${state.source})`);
      }
    }
  }

  /**
   * Get whether the current environment is development mode
   */
  public get isDevMode(): boolean {
    return this.context.isDev;
  }

  /**
   * Get the current context
   */
  public get currentContext(): FeatureFlagContext {
    return { ...this.context };
  }
}

// Export singleton instance
export const featureFlagManager = FeatureFlagManager.getInstance();

// Export convenience functions
export function isFeatureEnabled(name: FeatureFlagName): boolean {
  return featureFlagManager.isEnabled(name);
}

export function getAllFeatureFlags(): FeatureFlagsValues {
  return featureFlagManager.getAllFlagsValues();
}
