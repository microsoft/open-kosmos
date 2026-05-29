/**
 * Feature Flag type definitions
 */

/**
 * All known Feature Flag names
 * Naming convention: kosmosFeatureXXXXX
 * Add new feature flags here
 */
export type FeatureFlagName =
  | 'kosmosFeatureScreenshot'         // Screenshot capture feature
  | 'browserControl'                  // Browser Control / Chrome Extension feature
  | 'kosmosUseGit'                    // Git integration feature
  | 'kosmosFeatureScheduler'          // Cron-based scheduled task system
  | 'kosmosFeatureSubAgent'           // Sub-Agent system
  | 'kosmosFeatureSubAgentAutoWake'   // Auto-wake parent on background result ready
  | 'kosmosFeatureRemoteChannel'      // Remote Channel / Remote Control feature
  | 'kosmosPathPortability'           // Cross-OS path conversion for profile sync
  | 'kosmosFeatureBuddy'              // Buddy companion widget
  | 'kosmosFeatureCodingAgent'       // Foreground coding agent (Claude Code CLI)
  | 'kosmosFeatureExternalAgent'    // External Agent via WebSocket
  | 'kosmosFeatureDoctor'            // Doctor (in-app self-diagnosis) entry in UserMenu
  | 'kosmosFeatureToolSearch'        // Deferred tool loading for large tool sets
  | 'kosmosFeaturePlugins'           // Plugin management feature
  ;

/**
 * Context used for dynamically computing default values
 */
export interface FeatureFlagContext {
  /** Whether this is a development environment */
  isDev: boolean;
  /** Current brand name */
  brandName: string;
  /** Platform (darwin, win32, linux) */
  platform: NodeJS.Platform;
  /** CPU architecture (arm64, x64, ia32) */
  arch: NodeJS.Architecture;
}

/**
 * Default value type: can be a boolean, or a function that computes based on context
 */
export type FeatureFlagDefaultValue = boolean | ((ctx: FeatureFlagContext) => boolean);

/**
 * Feature Flag configuration
 */
export interface FeatureFlagConfig {
  /** Flag name */
  name: FeatureFlagName;
  /** Description */
  description: string;
  /**
   * Default value: can be a static boolean, or a function that dynamically computes based on context
   * @example
   * // Static value
   * defaultValue: false
   *
   * // Dynamic logic
   * defaultValue: (ctx) => ctx.isDev
   */
  defaultValue: FeatureFlagDefaultValue;
}

/**
 * Feature Flag state
 */
export interface FeatureFlagState {
  /** Flag name */
  name: FeatureFlagName;
  /** Current value */
  enabled: boolean;
  /** Source: default or cli (command line) */
  source: 'default' | 'cli';
}

/**
 * State map for all Feature Flags
 */
export type FeatureFlagsMap = Record<FeatureFlagName, FeatureFlagState>;

/**
 * Simplified Feature Flags value map
 */
export type FeatureFlagsValues = Record<FeatureFlagName, boolean>;
