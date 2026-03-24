/**
 * Feature Flag Manager (Main Process)
 * 
 * Serves as the single source of truth for Feature Flags
 * 
 * Features:
 * - Define default values for feature flags in the backend (supports static values and dynamic logic)
 * - Parse command line arguments to override default values (--enable-features, --disable-features)
 * - Provide read-only API for main process and frontend usage
 * 
 * Command line argument format:
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
import { BRAND_NAME } from '@shared/constants/branding';

class FeatureFlagManager {
  private static instance: FeatureFlagManager;
  private flags: FeatureFlagsMap;
  private initialized: boolean = false;
  private context: FeatureFlagContext;

  private constructor() {
    this.flags = {} as FeatureFlagsMap;
    // Initialize context (using temporary values, will be updated during initialize)
    this.context = {
      isDev: false,
      brandName: BRAND_NAME || 'openkosmos',
      platform: process.platform,
      arch: process.arch,
    };
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): FeatureFlagManager {
    if (!FeatureFlagManager.instance) {
      FeatureFlagManager.instance = new FeatureFlagManager();
    }
    return FeatureFlagManager.instance;
  }

  /**
   * Initialize Feature Flag Manager
   * Should be called at application startup
   */
  public initialize(): void {
    if (this.initialized) {
      console.log('[FeatureFlags] Already initialized, skipping...');
      return;
    }

    console.log('[FeatureFlags] Initializing feature flag manager...');

    // Detect development environment
    this.context.isDev = process.env.NODE_ENV === 'development' || 
                         process.argv.includes('--dev');

    // Initialize all flags with default values using context
    this.initializeDefaults();

    // Parse command line arguments (will override default values)
    this.parseCommandLineArgs();

    this.initialized = true;
    console.log('[FeatureFlags] Initialization complete');
    this.logCurrentState();
  }

  /**
   * Initialize all flags to default values (computed based on context)
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
   * Parse command line arguments
   */
  private parseCommandLineArgs(): void {
    const args = process.argv;
    console.log('[FeatureFlags] Parsing command line args:', args.join(' '));

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
   * Set flag from command line
   */
  private setFlagFromCli(name: FeatureFlagName, enabled: boolean): void {
    const config = getFeatureFlagConfig(name);
    
    if (!config) {
      console.warn(`[FeatureFlags] Unknown feature flag from CLI: ${name}`);
      return;
    }

    this.flags[name] = {
      name,
      enabled,
      source: 'cli',
    };
    console.log(`[FeatureFlags] Set ${name}=${enabled} from CLI`);
  }

  /**
   * Check if a feature flag is enabled
   */
  public isEnabled(name: FeatureFlagName): boolean {
    const flag = this.flags[name];
    if (!flag) {
      console.warn(`[FeatureFlags] Unknown feature flag: ${name}`);
      return false;
    }

    return flag.enabled;
  }

  /**
   * Get simplified value map of all flags (for frontend sync)
   */
  public getAllFlagsValues(): FeatureFlagsValues {
    const values: Record<string, boolean> = {};
    
    for (const [name, state] of Object.entries(this.flags)) {
      values[name] = state.enabled;
    }
    
    return values as FeatureFlagsValues;
  }

  /**
   * Output current state to log
   */
  private logCurrentState(): void {
    console.log('[FeatureFlags] Current state:');
    console.log(`  Context: isDev=${this.context.isDev}, brandName=${this.context.brandName}, platform=${this.context.platform}`);
    for (const [name, state] of Object.entries(this.flags)) {
      if (state.source !== 'default' || state.enabled) {
        console.log(`  - ${name}: ${state.enabled} (source: ${state.source})`);
      }
    }
  }

  /**
   * Get whether it is a development environment
   */
  public get isDevMode(): boolean {
    return this.context.isDev;
  }

  /**
   * Get current context
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
